"""The venue adapter interface and the rounding that belongs inside it."""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from typing import AsyncIterator, List, Optional, Protocol, runtime_checkable

from ..core.errors import FilterViolation
from ..core.events import (
    Balance,
    BookSnapshot,
    ExchangeInfo,
    FeeSchedule,
    MarketEvent,
    OrderIntent,
    OrderState,
    Position,
    SymbolFilter,
)
from ..core.types import Decimal as Dec, Nanos, floor_to, round_price_conservative

__all__ = [
    "VenueAdapter",
    "FilterRounder",
    "RateLimitState",
    "OrderAck",
    "CancelAck",
]


@dataclass(frozen=True)
class OrderAck:
    client_order_id: str
    venue_order_id: str
    accepted_at: Nanos


@dataclass(frozen=True)
class CancelAck:
    client_order_id: str
    cancelled_at: Nanos


@dataclass(frozen=True)
class RateLimitState:
    """Two independent budgets. Being inside one says nothing about the other."""

    used_weight: int
    weight_limit: int
    orders_used: int = 0
    orders_limit: int = 0

    @property
    def weight_fraction(self) -> float:
        return self.used_weight / self.weight_limit if self.weight_limit else 0.0

    @property
    def should_throttle(self) -> bool:
        """SPEC section 8.2: back off proactively at 70% of budget."""
        return self.weight_fraction > 0.70

    @property
    def should_halt_non_critical(self) -> bool:
        """At 90%, market-data resync and polling yield to order traffic."""
        return self.weight_fraction > 0.90


@runtime_checkable
class VenueAdapter(Protocol):
    """Implemented by ``binance``, ``okx``, ``bybit`` and ``sim``.

    The simulator implementing this same interface is what makes SPEC section
    3.2 rule 2 - same code path for backtest, paper and live - true rather
    than aspirational.
    """

    name: str

    # -- reference -------------------------------------------------------
    async def reference_data(self) -> ExchangeInfo: ...
    async def fee_schedule(self) -> FeeSchedule: ...

    # -- market data -----------------------------------------------------
    def subscribe_book(self, symbols: List[str]) -> AsyncIterator[MarketEvent]: ...
    def subscribe_trades(self, symbols: List[str]) -> AsyncIterator[MarketEvent]: ...
    def subscribe_funding(self, symbols: List[str]) -> AsyncIterator[MarketEvent]: ...
    async def book_snapshot(self, symbol: str, depth: int) -> BookSnapshot: ...

    # -- trading ---------------------------------------------------------
    async def place(self, intent: OrderIntent) -> OrderAck: ...
    async def cancel(self, client_order_id: str, symbol: str) -> CancelAck: ...
    #: Mandatory. An adapter that cannot resolve an unknown order state cannot
    #: implement QUERY, and is therefore unsafe regardless of what else it
    #: does well.
    async def query_order(self, client_order_id: str, symbol: str) -> OrderState: ...

    # -- truth -----------------------------------------------------------
    async def positions(self) -> List[Position]: ...
    async def balances(self) -> List[Balance]: ...
    async def open_orders(self) -> List[OrderState]: ...

    # -- health ----------------------------------------------------------
    async def server_time(self) -> Nanos: ...
    def rate_limit_state(self) -> RateLimitState: ...


class FilterRounder:
    """Applies venue symbol filters. Lives inside the adapter, by design.

    SPEC section 17.4 and Annex E section 3. Risk approved a quantity; rounding
    *up* would breach the number it approved, so quantity always rounds down
    and a limit price never becomes more aggressive than the strategy asked
    for.
    """

    def __init__(self, filters: SymbolFilter) -> None:
        self.f = filters

    def round_quantity(self, quantity: Dec) -> Dec:
        return floor_to(quantity, self.f.step_size)

    def round_price(self, price: Dec, side: str) -> Dec:
        return round_price_conservative(price, self.f.tick_size, side)

    def validate(self, quantity: Dec, price: Optional[Dec], last_price: Optional[Dec] = None) -> None:
        """Raise :class:`FilterViolation` for anything the venue would reject.

        Called *after* rounding, because rounding down can drop an order below
        ``MIN_NOTIONAL`` - and that rejection looks like a balance problem if
        you do not check for it here.
        """
        f = self.f
        if quantity <= 0:
            raise FilterViolation(f"{f.symbol}: quantity {quantity} is not positive")
        if quantity < f.min_qty:
            raise FilterViolation(f"{f.symbol}: quantity {quantity} below min_qty {f.min_qty}")
        if f.max_qty is not None and quantity > f.max_qty:
            raise FilterViolation(f"{f.symbol}: quantity {quantity} above max_qty {f.max_qty}")
        if quantity % f.step_size != 0:
            raise FilterViolation(f"{f.symbol}: quantity {quantity} not a multiple of {f.step_size}")
        if price is not None:
            if price <= 0:
                raise FilterViolation(f"{f.symbol}: price {price} is not positive")
            if price % f.tick_size != 0:
                raise FilterViolation(f"{f.symbol}: price {price} not a multiple of {f.tick_size}")
            notional = quantity * price
            if notional < f.min_notional:
                raise FilterViolation(
                    f"{f.symbol}: notional {notional} below min_notional {f.min_notional} "
                    "(rounding down can cause this - check after rounding, not before)"
                )
            if last_price is not None:
                if f.percent_price_up is not None and price > last_price * f.percent_price_up:
                    raise FilterViolation(f"{f.symbol}: price {price} above PERCENT_PRICE_BY_SIDE band")
                if f.percent_price_down is not None and price < last_price * f.percent_price_down:
                    raise FilterViolation(f"{f.symbol}: price {price} below PERCENT_PRICE_BY_SIDE band")

    def prepare(self, quantity: Dec, price: Optional[Dec], side: str,
                last_price: Optional[Dec] = None) -> "tuple[Dec, Optional[Dec]]":
        """Round then validate. The only supported way to build order numbers."""
        q = self.round_quantity(quantity)
        p = self.round_price(price, side) if price is not None else None
        self.validate(q, p, last_price)
        return q, p
