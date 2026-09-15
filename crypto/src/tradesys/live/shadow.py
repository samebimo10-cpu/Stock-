"""Shadow mode: the full system runs, orders are recorded, nothing is sent.

SPEC section 17.5 step 3. The value of the step is that *everything else* is
real - real feeds, real latency, real book depth, real risk decisions, real
reconciliation cadence - so the only thing still untested when it ends is the
venue's reaction to an order. Anything weaker (a simulator fed by recorded
data, say) leaves more than that untested and takes just as long.

The wrapper delegates every read to the real venue and intercepts only the two
methods that change the account. That asymmetry is the whole design: a shadow
mode that also fakes the balances is a backtest with a network connection.

It is a deliberate non-goal to fill shadow orders. Filling them requires a
model of the queue, which is the thing being measured, and a shadow mode that
reports fills invites exactly the comparison it cannot honestly support. What
it reports instead is what was sent, when, and at what price against what
touch - which is enough to answer "would this have been at the front of the
book" afterwards, from the archive.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, List, Optional

from ..adapters.base import CancelAck, OrderAck, RateLimitState
from ..core.events import (
    Balance, BookSnapshot, ExchangeInfo, FeeSchedule, OrderIntent, OrderState, Position,
)
from ..core.types import Nanos

__all__ = ["ShadowVenue", "ShadowOrder"]


@dataclass(frozen=True)
class ShadowOrder:
    client_order_id: str
    symbol: str
    side: str
    quantity: str
    price: Optional[str]
    order_type: str
    at: Nanos
    cancelled: bool = False


class ShadowVenue:
    """Wraps a real adapter. Reads pass through; writes are recorded.

    Implements the same protocol as any other venue, so nothing above it knows
    the difference - which is the property that makes the shadow run evidence
    about the live system rather than about a different one.
    """

    #: The **inner venue's** name, unchanged. Tempting to prefix it so a shadow
    #: run is obvious in the log, and wrong: positions, fills and reconcilers
    #: are all keyed by venue name, so renaming the venue here splits the books
    #: between "binance-spot" and "shadow:binance-spot" and reconciliation then
    #: compares two different accounts and finds them both empty. The mode is
    #: recorded once, on the session, where it belongs.
    name: str = ""

    #: What the log should say about this venue. Read by the runner, not used
    #: as a key by anything.
    mode: str = "shadow"

    def __init__(self, inner: Any, clock=None) -> None:
        self._inner = inner
        self.name = getattr(inner, "name", "venue")
        self._clock = clock
        self.orders: List[ShadowOrder] = []
        self._by_id: dict = {}

    # -- reads: the real venue, untouched --------------------------------

    async def reference_data(self) -> ExchangeInfo:
        return await self._inner.reference_data()

    async def fee_schedule(self) -> FeeSchedule:
        return await self._inner.fee_schedule()

    async def book_snapshot(self, symbol: str, depth: int = 100) -> BookSnapshot:
        return await self._inner.book_snapshot(symbol, depth)

    async def balances(self) -> List[Balance]:
        return await self._inner.balances()

    async def server_time(self) -> Nanos:
        return await self._inner.server_time()

    def rate_limit_state(self) -> RateLimitState:
        return self._inner.rate_limit_state()

    # -- writes: recorded, never sent ------------------------------------

    def _now(self) -> Nanos:
        return self._clock() if self._clock else 0

    async def place(self, intent: OrderIntent) -> OrderAck:
        order = ShadowOrder(
            client_order_id=intent.client_order_id, symbol=intent.symbol,
            side=intent.side, quantity=format(intent.quantity, "f"),
            price=format(intent.price, "f") if intent.price is not None else None,
            order_type=intent.order_type, at=self._now(),
        )
        self.orders.append(order)
        self._by_id[intent.client_order_id] = order
        return OrderAck(intent.client_order_id, f"shadow-{len(self.orders)}", self._now())

    async def cancel(self, client_order_id: str, symbol: str = "") -> CancelAck:
        order = self._by_id.get(client_order_id)
        if order is not None:
            replaced = ShadowOrder(**{**order.__dict__, "cancelled": True})
            self._by_id[client_order_id] = replaced
            self.orders[self.orders.index(order)] = replaced
        return CancelAck(client_order_id, self._now())

    async def query_order(self, client_order_id: str, symbol: str = "") -> OrderState:
        raise NotImplementedError(
            "shadow mode has no venue-side order state to query; a QUERY here "
            "means the order FSM reached a state it should not have in shadow"
        )

    # -- truth: the real account, which shadow orders never touched ------

    async def positions(self) -> List[Position]:
        return await self._inner.positions()

    async def open_orders(self) -> List[OrderState]:
        """The real venue's open orders - which must be none of ours.

        Returning our own shadow orders here would make reconciliation agree
        with itself and stop being a check. Returning the venue's real list
        means a shadow run *does* fail reconciliation if anything actually
        reaches the venue, which is the alarm worth having.
        """
        return await self._inner.open_orders()
