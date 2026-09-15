"""Deterministic simulator adapter.

Two jobs:

1. **Backtesting.** It implements the same :class:`~tradesys.adapters.base.VenueAdapter`
   interface as the live adapters, which is what makes SPEC section 3.2 rule 2
   - same code path for backtest, paper and live - a property rather than an
   intention.
2. **Chaos testing.** :class:`FaultInjector` reproduces the failures of SPEC
   section 8.5 on demand. The important one is
   ``drop_response_after_accept``: the venue accepts the order and the caller
   sees a timeout. A system that resends double-fills; a system that uses the
   QUERY state does not. That difference is the whole point of the state.

No wall-clock time and no randomness beyond a seeded generator, so a run is
reproducible from its inputs.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from decimal import Decimal
from typing import AsyncIterator, Dict, List, Optional, Tuple

from ..core.errors import (
    AuthFailed,
    CancelRejected,
    FilterViolation,
    InsufficientBalance,
    IpBanned,
    OrderNotFound,
    RateLimited,
    UnknownState,
    VenueDown,
)
from ..core.events import (
    Balance,
    BookSnapshot,
    ExchangeInfo,
    FeeSchedule,
    Fill,
    MarketEvent,
    OrderIntent,
    OrderState,
    OrderStatus,
    Position,
    SymbolFilter,
)
from ..core.ids import new_correlation_id
from ..core.types import Decimal as Dec, dec, Nanos
from ..costs import CostModel, market_impact_bps
from .base import CancelAck, FilterRounder, OrderAck, RateLimitState

__all__ = ["SimAdapter", "FaultInjector", "SimBook"]


@dataclass
class FaultInjector:
    """Failure injection for the chaos suite (SPEC section 14.3).

    Each flag is consumed once unless a ``_persistent`` variant is set, so a
    test can inject exactly one failure and then observe recovery.
    """

    #: The venue accepts the order; the caller sees a timeout. This is the
    #: scenario behind failure mode 1 - retry here and you fill twice.
    drop_response_after_accept: bool = False
    #: Raise UnknownState *without* accepting. QUERY must resolve to REJECTED.
    timeout_without_accept: bool = False
    reject_next: Optional[str] = None       # "filter" | "balance" | "auth" | "down"
    rate_limit_next: bool = False
    ip_ban_next: bool = False
    #: Fill only this fraction of the next order, leaving the rest resting.
    partial_fill_fraction: Optional[Decimal] = None
    #: Silently stop delivering user-data events, as an expired listenKey does.
    user_stream_silent: bool = False
    #: Added to every reported server time, in nanoseconds.
    clock_skew_ns: int = 0
    #: Positions the venue holds that we were never told about.
    hidden_positions: List[Position] = field(default_factory=list)

    def _take(self, name: str) -> bool:
        if getattr(self, name):
            setattr(self, name, False if isinstance(getattr(self, name), bool) else None)
            return True
        return False


@dataclass
class SimBook:
    """A price-level book. Bids descend, asks ascend."""

    bids: Tuple[Tuple[Dec, Dec], ...] = ()
    asks: Tuple[Tuple[Dec, Dec], ...] = ()
    last_update_id: int = 0

    @property
    def best_bid(self) -> Optional[Dec]:
        return self.bids[0][0] if self.bids else None

    @property
    def best_ask(self) -> Optional[Dec]:
        return self.asks[0][0] if self.asks else None

    @property
    def mid(self) -> Optional[Dec]:
        if self.best_bid is None or self.best_ask is None:
            return None
        return (self.best_bid + self.best_ask) / 2

    def walk(self, side: str, quantity: Dec) -> Optional[Tuple[Dec, Dec]]:
        """Walk depth for a taker order. Returns (filled_qty, avg_price).

        Returns ``None`` when the book cannot fill the whole quantity. That
        ``None`` must propagate: a backtester that fills the remainder at the
        last level's price is modelling infinite liquidity at exactly the
        moment the strategy needs the truth (Annex B section 2).
        """
        levels = self.asks if side == "buy" else self.bids
        filled = dec(0)
        cost = dec(0)
        for price, qty in levels:
            take = min(qty, quantity - filled)
            cost += take * price
            filled += take
            if filled >= quantity:
                return filled, cost / filled
        return None


def _crosses(book: "SimBook", intent: OrderIntent) -> bool:
    """Would this limit order execute immediately against the book?"""
    if intent.price is None:
        return False
    if intent.side == "buy":
        return book.best_ask is not None and book.best_ask <= intent.price
    return book.best_bid is not None and book.best_bid >= intent.price


@dataclass
class _RestingOrder:
    intent: OrderIntent
    venue_order_id: str
    filled: Dec = dec(0)
    status: str = OrderStatus.ACKED
    #: Size resting at our price when we joined. For a maker strategy this is
    #: the whole game: we are behind it and it fills first.
    queue_ahead: Dec = dec(0)
    #: Volume that has traded through our level since we joined.
    volume_seen: Dec = dec(0)
    #: When the order actually reaches the matching engine. Until then it is
    #: in flight and cannot fill.
    active_at: Nanos = 0
    #: A crossing order that has not yet arrived. It executes against the book
    #: as it stands on arrival, not as it stood when we decided.
    pending_taker: bool = False


class SimAdapter:
    """In-memory venue. Drive it with :meth:`set_book` and :meth:`step`."""

    name = "sim"

    def __init__(
        self,
        filters: Optional[Dict[str, SymbolFilter]] = None,
        fees: Optional[FeeSchedule] = None,
        faults: Optional[FaultInjector] = None,
        start_ns: Nanos = 1_700_000_000_000_000_000,
        seed: int = 7,
        cost_model: Optional[CostModel] = None,
        model_queue: bool = True,
        order_latency_ns: int = 0,
        fill_latency_ns: int = 0,
        daily_volume: Optional[Dict[str, Dec]] = None,
        daily_vol_bps: Dec = dec(0),
    ) -> None:
        self.filters: Dict[str, SymbolFilter] = filters or {}
        self.fees = fees or FeeSchedule(
            venue="sim", maker_rate=dec("0.0002"), taker_rate=dec("0.0005"), tier="0"
        )
        self.faults = faults or FaultInjector()
        self.now: Nanos = start_ns
        self._rng = random.Random(seed)
        self.books: Dict[str, SimBook] = {}
        self._orders: Dict[str, _RestingOrder] = {}
        self._seen_client_ids: set = set()
        self.fills: List[Fill] = []
        self._positions: Dict[Tuple[str, str], Position] = {}
        self._balances: Dict[str, Balance] = {}
        self._next_venue_id = 1
        self._weight_used = 0
        self._weight_limit = 6000
        self.cost_model = cost_model
        #: Model queue position for resting orders. The default is True and
        #: deliberately pessimistic: a maker backtest that fills whenever the
        #: price touches your level overstates fill rates by a factor of two to
        #: five, always in the favourable direction, because you fill on every
        #: touch that goes your way and on none of the queue positions that
        #: never reached you (Annex B section 5.2).
        self.model_queue = model_queue
        #: Order-to-exchange delay. Zero by default because latency is a
        #: property of a deployment rather than of a simulator - but a backtest
        #: left at zero is not modelling reality, and SPEC section 11.1 lists
        #: latency as a required component of an honest cost model. Set it from
        #: the measured distribution, not from an assumption.
        self.order_latency_ns = order_latency_ns
        #: Fill-to-system delay. Affects when we learn, not when it happened.
        self.fill_latency_ns = fill_latency_ns
        self.daily_volume: Dict[str, Dec] = dict(daily_volume or {})
        self.daily_vol_bps = daily_vol_bps
        #: Impact and adverse selection charged this run, for the cost report.
        self.modelled_costs: Dict[str, Dec] = {"impact": dec(0), "adverse_selection": dec(0)}

    # -- driving the simulation -----------------------------------------

    def set_book(self, symbol: str, bids, asks, update_id: Optional[int] = None) -> None:
        b = tuple((dec(p), dec(q)) for p, q in bids)
        a = tuple((dec(p), dec(q)) for p, q in asks)
        prev = self.books.get(symbol)
        uid = update_id if update_id is not None else ((prev.last_update_id + 1) if prev else 1)
        self.books[symbol] = SimBook(bids=b, asks=a, last_update_id=uid)

    def set_balance(self, asset: str, free: str | Decimal) -> None:
        self._balances[asset] = Balance(venue=self.name, asset=asset, free=dec(free))

    def apply_market_event(self, event) -> None:
        """Keep the simulated venue's book in step with the replayed data.

        Without this the adapter evaluates fills against whatever book it was
        seeded with, while the strategy reasons about the replayed one. The two
        drift apart silently and every maker fill decision is made against a
        stale price - which looks like a strategy result and is a wiring bug.

        Trades are forwarded to :meth:`observe_trade` so resting orders advance
        in the queue, so a caller can drive the whole simulation with this one
        method.

        It also advances the simulated clock to the event's timestamp. The
        venue's clock comes from the data it is fed, and without that every
        fill carries the same timestamp and nothing that depends on elapsed
        time - latency, order ageing, funding intervals - can work at all.
        """
        if event.exchange_ts:
            self.now = max(self.now, event.exchange_ts)
        if event.kind == "book_snapshot":
            snap = event.payload
            self.set_book(event.symbol, snap.bids, snap.asks, snap.last_update_id)
        elif event.kind == "book_delta":
            self._apply_delta(event.symbol, event.payload)
        elif event.kind == "trade":
            self.observe_trade(event.symbol, event.payload.price,
                               event.payload.quantity, event.payload.aggressor_side)

    def _apply_delta(self, symbol: str, delta) -> None:
        book = self.books.get(symbol)
        bids = dict(book.bids) if book else {}
        asks = dict(book.asks) if book else {}
        for price, qty in delta.bids:
            bids.pop(price, None) if qty == 0 else bids.__setitem__(price, qty)
        for price, qty in delta.asks:
            asks.pop(price, None) if qty == 0 else asks.__setitem__(price, qty)
        self.set_book(
            symbol,
            sorted(bids.items(), key=lambda kv: kv[0], reverse=True),
            sorted(asks.items(), key=lambda kv: kv[0]),
            delta.final_update_id,
        )

    def observe_trade(self, symbol: str, price: Dec, quantity: Dec,
                      aggressor_side: str) -> None:
        """Feed a public trade, so resting orders can advance in the queue.

        A resting buy only advances when a seller crosses into it at or below
        our price. Without this the simulator has no idea whether anyone
        actually traded where we are quoting, and filling on a price touch
        alone is the fiction Annex B section 5.2 warns about.
        """
        price = dec(price)
        quantity = dec(quantity)
        for ro in self._orders.values():
            if ro.status in OrderStatus.TERMINAL or ro.intent.symbol != symbol:
                continue
            if ro.intent.price is None:
                continue
            hits_us = (
                (ro.intent.side == "buy" and aggressor_side == "sell" and price <= ro.intent.price)
                or (ro.intent.side == "sell" and aggressor_side == "buy" and price >= ro.intent.price)
            )
            if hits_us:
                ro.volume_seen += quantity

    def advance(self, ns: int) -> None:
        self.now += ns

    def step(self) -> List[Fill]:
        """Match resting limit orders against the current book."""
        produced: List[Fill] = []
        for coid, ro in list(self._orders.items()):
            if ro.status in OrderStatus.TERMINAL:
                continue
            if self.now < ro.active_at:
                continue                    # still in flight
            book = self.books.get(ro.intent.symbol)
            if book is None:
                continue

            if ro.pending_taker:
                ro.pending_taker = False
                walked = book.walk(ro.intent.side, ro.intent.quantity - ro.filled)
                if walked is None:
                    ro.status = OrderStatus.REJECTED
                    continue
                produced.append(self._fill(ro, walked[0], walked[1], maker=False))
                continue

            if ro.intent.price is None:
                continue
            crosses = (
                (ro.intent.side == "buy" and book.best_ask is not None and book.best_ask <= ro.intent.price)
                or (ro.intent.side == "sell" and book.best_bid is not None and book.best_bid >= ro.intent.price)
            )
            if not crosses:
                continue

            remaining = ro.intent.quantity - ro.filled
            if not self.model_queue:
                produced.append(self._fill(ro, remaining, ro.intent.price, maker=True))
                continue

            # We are behind whatever was resting when we joined. Only volume
            # beyond that queue can reach us.
            reaches_us = ro.volume_seen - ro.queue_ahead
            if reaches_us <= 0:
                continue
            fillable = min(remaining, reaches_us)
            if fillable <= 0:
                continue
            ro.queue_ahead += fillable      # consumed, so it cannot fill twice
            produced.append(self._fill(ro, fillable, ro.intent.price, maker=True))
        return produced

    # -- internals -------------------------------------------------------

    def _fill(self, ro: _RestingOrder, qty: Dec, price: Dec, maker: bool) -> Fill:
        rate = self.fees.maker_rate if maker else self.fees.taker_rate
        fee = qty * price * rate
        price = self._apply_costs(ro, qty, price, maker)
        fill = Fill(
            correlation_id=ro.intent.correlation_id,
            emitted_at=self.now,
            source="sim",
            client_order_id=ro.intent.client_order_id,
            venue_order_id=ro.venue_order_id,
            venue=self.name,
            symbol=ro.intent.symbol,
            side=ro.intent.side,
            quantity=qty,
            price=price,
            fee=fee,
            is_maker=maker,
            strategy_id=ro.intent.strategy_id,
            exchange_ts=self.now,
            local_recv_ts=self.now + self.fill_latency_ns,
        )
        ro.filled += qty
        ro.status = OrderStatus.FILLED if ro.filled >= ro.intent.quantity else OrderStatus.PARTIAL
        self._apply_position(fill)
        self.fills.append(fill)
        return fill

    def _apply_costs(self, ro: _RestingOrder, qty: Dec, price: Dec, maker: bool) -> Dec:
        """Worsen the execution price by modelled impact and adverse selection.

        Both are charged as price, not as a separate line item, because that is
        how they are actually experienced: the fill happens somewhere worse
        than the quote said. Charging them as a fee would leave the position's
        entry price flattering and the profit and loss correct only in total.
        """
        if self.cost_model is None:
            return price

        worse = dec(0)
        symbol = ro.intent.symbol

        if not maker:
            volume = self.daily_volume.get(symbol)
            if volume and volume > 0:
                bps = market_impact_bps(qty, volume, self.daily_vol_bps,
                                        self.cost_model.impact_y)
                worse += price * bps / dec(10_000)
                self.modelled_costs["impact"] += worse * qty
        else:
            # Maker fills are not random: you are filled preferentially when
            # the price is about to move against you.
            adverse = price * self.cost_model.adverse_selection_bps / dec(10_000)
            worse += adverse
            self.modelled_costs["adverse_selection"] += adverse * qty

        return price + worse if ro.intent.side == "buy" else price - worse

    def _apply_position(self, fill: Fill) -> None:
        key = (self.name, fill.symbol)
        cur = self._positions.get(key)
        signed = fill.signed_quantity
        if cur is None:
            self._positions[key] = Position(self.name, fill.symbol, signed, fill.price)
            return
        new_qty = cur.quantity + signed
        if new_qty == 0:
            self._positions.pop(key, None)
            return
        if (cur.quantity > 0) == (signed > 0):
            notional = cur.quantity * cur.avg_entry_price + signed * fill.price
            avg = notional / new_qty
        else:
            avg = cur.avg_entry_price
        self._positions[key] = Position(self.name, fill.symbol, new_qty, avg)

    @staticmethod
    def _queue_ahead(book: Optional[SimBook], intent: OrderIntent) -> Dec:
        """Size already resting at our price when we join it."""
        if book is None or intent.price is None:
            return dec(0)
        levels = book.bids if intent.side == "buy" else book.asks
        return sum((q for p, q in levels if p == intent.price), dec(0))

    def _check_faults(self, accepted_callback=None):
        f = self.faults
        if f._take("ip_ban_next"):
            raise IpBanned("simulated IP ban", venue_code=418)
        if f._take("rate_limit_next"):
            raise RateLimited("simulated rate limit", venue_code=429, retry_after_s=1.0)
        if f.reject_next:
            kind, f.reject_next = f.reject_next, None
            if kind == "filter":
                raise FilterViolation("simulated filter violation", venue_code=-1013)
            if kind == "balance":
                raise InsufficientBalance("simulated stale balance", venue_code=-2010)
            if kind == "auth":
                raise AuthFailed("simulated auth failure", venue_code=-2015)
            if kind == "down":
                raise VenueDown("simulated venue maintenance", venue_code=503)
        if f._take("timeout_without_accept"):
            raise UnknownState("simulated timeout, order NOT accepted", venue_code=-1007)

    # -- VenueAdapter ----------------------------------------------------

    async def reference_data(self) -> ExchangeInfo:
        self._weight_used += 10
        return ExchangeInfo(venue=self.name, filters=dict(self.filters), fetched_at=self.now)

    async def fee_schedule(self) -> FeeSchedule:
        return self.fees

    async def book_snapshot(self, symbol: str, depth: int = 100) -> BookSnapshot:
        self._weight_used += 5
        b = self.books.get(symbol, SimBook())
        return BookSnapshot(bids=b.bids[:depth], asks=b.asks[:depth], last_update_id=b.last_update_id)

    async def subscribe_book(self, symbols: List[str]) -> AsyncIterator[MarketEvent]:
        for s in symbols:
            b = self.books.get(s, SimBook())
            yield MarketEvent(
                correlation_id=new_correlation_id(self.now),
                emitted_at=self.now,
                source="sim",
                venue=self.name,
                symbol=s,
                kind="book_snapshot",
                exchange_ts=self.now,
                local_recv_ts=self.now,
                sequence=b.last_update_id,
                payload=BookSnapshot(b.bids, b.asks, b.last_update_id),
            )

    async def subscribe_trades(self, symbols: List[str]) -> AsyncIterator[MarketEvent]:
        if False:  # pragma: no cover - the sim produces trades via step()
            yield

    async def subscribe_funding(self, symbols: List[str]) -> AsyncIterator[MarketEvent]:
        if False:  # pragma: no cover
            yield

    async def place(self, intent: OrderIntent) -> OrderAck:
        self._weight_used += 1
        self._check_faults()

        # Idempotency, as the venue enforces it (SPEC section 9.3). A repeat of
        # a client order ID is refused, which is what makes a deterministic ID
        # a defence rather than a label.
        if intent.client_order_id in self._seen_client_ids:
            raise FilterViolation(
                f"duplicate client order id {intent.client_order_id}", venue_code=-2010
            )

        if intent.symbol in self.filters:
            FilterRounder(self.filters[intent.symbol]).validate(intent.quantity, intent.price)

        self._seen_client_ids.add(intent.client_order_id)
        vid = f"sim-{self._next_venue_id}"
        self._next_venue_id += 1
        book = self.books.get(intent.symbol)
        ro = _RestingOrder(intent=intent, venue_order_id=vid,
                           queue_ahead=self._queue_ahead(book, intent),
                           active_at=self.now + self.order_latency_ns)
        self._orders[intent.client_order_id] = ro

        if self.order_latency_ns > 0 and book is not None:
            # The order has not arrived yet. A crossing order executes against
            # the book as it stands on arrival, which is the whole cost of
            # latency: the price you decided on is not the price you get.
            ro.pending_taker = bool(
                intent.order_type == "market"
                or (intent.order_type in ("limit", "limit_maker")
                    and not intent.post_only and _crosses(book, intent))
            )
            if self.faults._take("drop_response_after_accept"):
                raise UnknownState(
                    "simulated timeout AFTER the venue accepted the order", venue_code=-1007
                )
            return OrderAck(intent.client_order_id, vid, self.now)

        if intent.order_type == "market" and book is not None:
            walked = book.walk(intent.side, intent.quantity)
            if walked is None:
                ro.status = OrderStatus.REJECTED
                raise InsufficientBalance("book cannot fill the requested size", venue_code=-2010)
            qty, avg = walked
            frac = self.faults.partial_fill_fraction
            if frac is not None:
                self.faults.partial_fill_fraction = None
                qty = qty * frac
            self._fill(ro, qty, avg, maker=False)
        elif intent.order_type in ("limit", "limit_maker") and book is not None:
            crosses = (
                (intent.side == "buy" and book.best_ask is not None and book.best_ask <= (intent.price or 0))
                or (intent.side == "sell" and book.best_bid is not None and book.best_bid >= (intent.price or 0))
            )
            if crosses and not intent.post_only:
                walked = book.walk(intent.side, intent.quantity)
                if walked is not None:
                    self._fill(ro, walked[0], walked[1], maker=False)

        # The dangerous case, injected LAST so the order really is accepted:
        # the venue has it, the caller is told nothing.
        if self.faults._take("drop_response_after_accept"):
            raise UnknownState(
                "simulated timeout AFTER the venue accepted the order", venue_code=-1007
            )
        return OrderAck(intent.client_order_id, vid, self.now)

    async def cancel(self, client_order_id: str, symbol: str = "") -> CancelAck:
        self._weight_used += 1
        self._check_faults()
        ro = self._orders.get(client_order_id)
        if ro is None:
            raise OrderNotFound(f"no such order {client_order_id}", venue_code=-2013)
        if ro.status in OrderStatus.TERMINAL:
            raise CancelRejected(
                f"order {client_order_id} is {ro.status}; query it, it may have filled",
                venue_code=-2011,
            )
        ro.status = OrderStatus.CANCELLED
        return CancelAck(client_order_id, self.now)

    async def query_order(self, client_order_id: str, symbol: str = "") -> OrderState:
        """Truthful even when :meth:`place` raised. That is the point of QUERY."""
        self._weight_used += 2
        ro = self._orders.get(client_order_id)
        if ro is None:
            raise OrderNotFound(f"no such order {client_order_id}", venue_code=-2013)
        return OrderState(
            correlation_id=ro.intent.correlation_id,
            emitted_at=self.now,
            source="sim",
            client_order_id=client_order_id,
            venue_order_id=ro.venue_order_id,
            venue=self.name,
            symbol=ro.intent.symbol,
            side=ro.intent.side,
            status=ro.status,
            quantity=ro.intent.quantity,
            filled_quantity=ro.filled,
            price=ro.intent.price,
            strategy_id=ro.intent.strategy_id,
            entered_state_at=self.now,
        )

    async def positions(self) -> List[Position]:
        self._weight_used += 5
        return list(self._positions.values()) + list(self.faults.hidden_positions)

    async def balances(self) -> List[Balance]:
        self._weight_used += 5
        return list(self._balances.values())

    async def open_orders(self) -> List[OrderState]:
        self._weight_used += 3
        out = []
        for coid, ro in self._orders.items():
            if ro.status in OrderStatus.TERMINAL:
                continue
            out.append(await self.query_order(coid))
        return out

    async def server_time(self) -> Nanos:
        return self.now + self.faults.clock_skew_ns

    def rate_limit_state(self) -> RateLimitState:
        return RateLimitState(self._weight_used, self._weight_limit)
