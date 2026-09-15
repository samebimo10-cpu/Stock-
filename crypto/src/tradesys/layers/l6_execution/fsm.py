"""Order lifecycle state machine (SPEC section 9.2, Annex A section 4.3).

v1.0 of the specification requires "a full state machine with timeout handling
at every state" and lists no states. This is that table.

``QUERY`` is the state most often missing in real systems, and its absence is
what turns a request timeout into a double fill. It is deliberately a trap:
an order whose state is unknown may never cause another order. There is no
transition out of ``QUERY`` except resolution by the venue.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import Dict, List, Optional, Set, Tuple

from ...core.events import OrderIntent, OrderState, OrderStatus
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["TRANSITIONS", "TIMEOUTS", "IllegalTransition", "OrderMachine"]

S = OrderStatus

#: Legal transitions. Anything not here raises.
TRANSITIONS: Dict[str, Set[str]] = {
    S.INTENT:    {S.PENDING, S.REJECTED},
    S.PENDING:   {S.ACKED, S.REJECTED, S.QUERY, S.FILLED, S.PARTIAL},
    S.ACKED:     {S.PARTIAL, S.FILLED, S.CANCELLED, S.QUERY},
    S.PARTIAL:   {S.FILLED, S.CANCELLED, S.QUERY},
    # QUERY resolves to a real state or stays put. It never returns to PENDING,
    # because returning to PENDING is how a system talks itself into resending.
    S.QUERY:     {S.ACKED, S.PARTIAL, S.FILLED, S.CANCELLED, S.REJECTED},
    S.FILLED:    set(),
    S.CANCELLED: set(),
    S.REJECTED:  set(),
}

#: Seconds in each state before the expiry action fires. ``None`` means no
#: timeout - QUERY polls forever by design.
TIMEOUTS: Dict[str, Optional[float]] = {
    S.INTENT: 2.0,
    S.PENDING: 5.0,
    S.ACKED: None,       # bounded instead by the signal's valid_until
    S.PARTIAL: None,     # bounded by strategy policy
    S.QUERY: None,       # poll forever; alert after 30s
}

#: How long an unresolved QUERY may go unremarked before it is a P1.
QUERY_ALERT_AFTER_S = 30.0


class IllegalTransition(AssertionError):
    """A transition not in :data:`TRANSITIONS`. Always a defect, never a market event."""


@dataclass
class OrderMachine:
    """One order's lifecycle.

    Holds no venue handle. It decides *what should happen*; the executor does
    it. That split is what lets the whole table be unit-tested with no venue
    at all.
    """

    intent: OrderIntent
    status: str = S.INTENT
    filled: Dec = dec(0)
    venue_order_id: Optional[str] = None
    entered_state_at: Nanos = 0
    history: List[Tuple[str, Nanos, str]] = field(default_factory=list)
    query_attempts: int = 0
    reason: Optional[str] = None

    def __post_init__(self) -> None:
        if not self.history:
            self.history.append((self.status, self.entered_state_at, "created"))

    # -- transitions -----------------------------------------------------

    def transition(self, to: str, at: Nanos, reason: str = "") -> None:
        allowed = TRANSITIONS.get(self.status, set())
        if to not in allowed:
            raise IllegalTransition(
                f"{self.intent.client_order_id}: {self.status} -> {to} is not a legal "
                f"transition (legal: {sorted(allowed) or 'none, terminal'})"
            )
        self.status = to
        self.entered_state_at = at
        self.history.append((to, at, reason))
        if to != S.QUERY:
            self.query_attempts = 0
        if reason:
            self.reason = reason

    # -- events ----------------------------------------------------------

    def on_sent(self, at: Nanos) -> None:
        self.transition(S.PENDING, at, "sent to venue")

    def on_ack(self, venue_order_id: str, at: Nanos) -> None:
        self.venue_order_id = venue_order_id
        if self.status != S.ACKED:
            self.transition(S.ACKED, at, "venue ack")

    def on_reject(self, at: Nanos, reason: str) -> None:
        self.transition(S.REJECTED, at, reason)

    def on_unknown(self, at: Nanos, reason: str) -> None:
        """A timeout after the request went out. The only safe landing is QUERY."""
        if self.status == S.QUERY:
            self.query_attempts += 1
            return
        self.transition(S.QUERY, at, reason)

    def on_fill(self, quantity: Dec, at: Nanos) -> None:
        self.filled += quantity
        if self.filled >= self.intent.quantity:
            self.transition(S.FILLED, at, "fully filled")
        else:
            if self.status != S.PARTIAL:
                self.transition(S.PARTIAL, at, "partial fill")

    def on_cancel_ack(self, at: Nanos) -> None:
        self.transition(S.CANCELLED, at, "cancel ack")

    def on_query_result(self, state: OrderState, at: Nanos) -> None:
        """Resolve QUERY from the venue's own answer. The venue is truth."""
        self.venue_order_id = state.venue_order_id or self.venue_order_id
        self.filled = state.filled_quantity
        if state.status == S.QUERY:
            self.query_attempts += 1
            return
        if state.status == self.status:
            return
        self.transition(state.status, at, "resolved by venue query")

    def on_not_found(self, at: Nanos) -> None:
        """The venue has never heard of this order. Terminal, with an audit note."""
        self.transition(S.REJECTED, at, "venue reports no such order")

    # -- reading ---------------------------------------------------------

    @property
    def remaining(self) -> Dec:
        return self.intent.quantity - self.filled

    @property
    def is_terminal(self) -> bool:
        return self.status in S.TERMINAL

    @property
    def may_place_new_order(self) -> bool:
        """False whenever this order could still exist at the venue.

        The single most important predicate in the module. A system that
        answers True here while in QUERY will double-fill, and no amount of
        care elsewhere prevents it.
        """
        return self.status not in (S.QUERY, S.PENDING, S.ACKED, S.PARTIAL)

    def timed_out(self, now: Nanos) -> bool:
        limit = TIMEOUTS.get(self.status)
        if limit is None:
            return False
        return (now - self.entered_state_at) / 1e9 > limit

    def query_needs_alert(self, now: Nanos) -> bool:
        return (
            self.status == S.QUERY
            and (now - self.entered_state_at) / 1e9 > QUERY_ALERT_AFTER_S
        )

    def to_state(self, correlation_id: str = "", at: Nanos = 0) -> OrderState:
        return OrderState(
            correlation_id=correlation_id or self.intent.correlation_id,
            emitted_at=at or self.entered_state_at,
            source="l6_execution",
            client_order_id=self.intent.client_order_id,
            venue_order_id=self.venue_order_id,
            venue=self.intent.venue,
            symbol=self.intent.symbol,
            side=self.intent.side,
            status=self.status,
            quantity=self.intent.quantity,
            filled_quantity=self.filled,
            price=self.intent.price,
            strategy_id=self.intent.strategy_id,
            entered_state_at=self.entered_state_at,
            reason=self.reason,
        )
