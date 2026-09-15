"""Leg groups and the unwinder (SPEC section 2.1, failure mode 10 of 8.5).

The specification is blunt about the ordering here: *specify the unwinder
before the detector*. A multi-leg strategy that fills one leg and not the other
is holding naked exposure it never asked for, and the cost of getting out of it
routinely exceeds the profit the trade was chasing.

So this module exists before any multi-leg strategy does, and the rule it
enforces is narrow and absolute:

    **A leg group that cannot complete is flattened, not completed.**

Chasing the missing leg is the tempting response and the wrong one. The price
moved, which is why the leg did not fill; paying up to complete the trade turns
a small loss into the trade you would never have entered deliberately. Unwinds
are ``reduce_only`` so they can never open exposure, which also lets them
execute during a kill-switch flatten - the one state where you most need them.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from ...core.events import OrderStatus
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["LegGroup", "LegState", "GroupStatus", "Unwinder", "UnwindOrder",
           "DEFAULT_COMPLETION_TIMEOUT_NS"]

#: How long a group may sit incomplete before it is unwound. Short, because
#: every second of naked exposure is risk nobody sized for.
#:
#: **The timeout must exceed the cadence of the data driving the system.** A
#: 30-second timeout against hourly bars expires every group before its legs
#: can possibly fill, so every trade is abandoned and nothing ever completes.
#: That failure is silent - it looks like a strategy that does not trade - so
#: :meth:`Unwinder.open` refuses a timeout it can see is too short.
DEFAULT_COMPLETION_TIMEOUT_NS = 30_000_000_000        # 30 seconds


class GroupStatus:
    PENDING = "PENDING"        # nothing terminal yet
    COMPLETE = "COMPLETE"      # every leg filled
    #: Some legs filled, others cannot. This is the state that costs money.
    BROKEN = "BROKEN"
    UNWINDING = "UNWINDING"
    UNWOUND = "UNWOUND"
    ABANDONED = "ABANDONED"    # nothing filled; nothing to unwind


@dataclass
class LegState:
    client_order_id: str
    venue: str
    symbol: str
    side: str
    quantity: Dec
    filled: Dec = dec(0)
    status: str = OrderStatus.INTENT

    @property
    def is_terminal(self) -> bool:
        return self.status in OrderStatus.TERMINAL

    @property
    def signed_filled(self) -> Dec:
        return self.filled if self.side == "buy" else -self.filled

    @property
    def unfilled(self) -> Dec:
        return self.quantity - self.filled


@dataclass
class UnwindOrder:
    """A reduce-only order that flattens what a broken group left behind."""

    venue: str
    symbol: str
    side: str
    quantity: Dec
    reason: str
    leg_group: str

    def __str__(self) -> str:
        return (f"unwind {self.side} {self.quantity} {self.symbol} on {self.venue} "
                f"({self.reason})")


@dataclass
class LegGroup:
    """One multi-leg trade, tracked as a unit."""

    group_id: str
    strategy_id: str
    opened_at: Nanos
    legs: Dict[str, LegState] = field(default_factory=dict)
    timeout_ns: int = DEFAULT_COMPLETION_TIMEOUT_NS
    status: str = GroupStatus.PENDING
    unwound_at: Optional[Nanos] = None

    # -- construction ----------------------------------------------------

    def add_leg(self, leg: LegState) -> None:
        self.legs[leg.client_order_id] = leg

    def on_fill(self, client_order_id: str, quantity: Dec) -> None:
        leg = self.legs.get(client_order_id)
        if leg is None:
            return
        leg.filled += quantity
        if leg.filled >= leg.quantity:
            leg.status = OrderStatus.FILLED

    def on_status(self, client_order_id: str, status: str) -> None:
        leg = self.legs.get(client_order_id)
        if leg is not None:
            leg.status = status

    # -- reading ---------------------------------------------------------

    @property
    def filled_legs(self) -> List[LegState]:
        return [leg for leg in self.legs.values() if leg.filled > 0]

    @property
    def unfilled_legs(self) -> List[LegState]:
        return [leg for leg in self.legs.values() if leg.filled < leg.quantity]

    @property
    def all_filled(self) -> bool:
        return bool(self.legs) and all(leg.filled >= leg.quantity for leg in self.legs.values())

    @property
    def nothing_filled(self) -> bool:
        return all(leg.filled == 0 for leg in self.legs.values())

    def evaluate(self, now: Nanos) -> str:
        """Classify the group. Pure - it decides, it does not act."""
        if self.status in (GroupStatus.UNWINDING, GroupStatus.UNWOUND):
            return self.status
        if self.all_filled:
            self.status = GroupStatus.COMPLETE
            return self.status

        expired = (now - self.opened_at) >= self.timeout_ns
        dead = all(leg.is_terminal for leg in self.unfilled_legs) and self.unfilled_legs

        if not (expired or dead):
            self.status = GroupStatus.PENDING
            return self.status

        if self.nothing_filled:
            # Nothing to unwind. Cancel what is left and walk away.
            self.status = GroupStatus.ABANDONED
        else:
            self.status = GroupStatus.BROKEN
        return self.status

    def unwind_orders(self, reason: str = "") -> List[UnwindOrder]:
        """Reduce-only orders that flatten every leg that did fill.

        The other legs are cancelled rather than chased. Deliberately: the
        missing leg did not fill because the price moved, and paying up to
        complete the trade turns a small loss into a position nobody sized.
        """
        detail = reason or "leg group could not complete within its timeout"
        orders: List[UnwindOrder] = []
        for leg in self.filled_legs:
            if leg.filled <= 0:
                continue
            orders.append(UnwindOrder(
                venue=leg.venue, symbol=leg.symbol,
                side="sell" if leg.side == "buy" else "buy",
                quantity=leg.filled, reason=detail, leg_group=self.group_id,
            ))
        return orders

    def orders_to_cancel(self) -> List[str]:
        return [leg.client_order_id for leg in self.unfilled_legs if not leg.is_terminal]

    @property
    def naked_exposure(self) -> Dict[Tuple[str, str], Dec]:
        """Signed exposure the group is carrying, per instrument.

        For a hedged pair that completed, this nets to something small. For a
        broken one it is the number that matters.
        """
        out: Dict[Tuple[str, str], Dec] = {}
        for leg in self.legs.values():
            key = (leg.venue, leg.symbol)
            out[key] = out.get(key, dec(0)) + leg.signed_filled
        return {k: v for k, v in out.items() if v != 0}


class Unwinder:
    """Tracks open leg groups and says which need flattening."""

    def __init__(self, timeout_ns: int = DEFAULT_COMPLETION_TIMEOUT_NS) -> None:
        self.timeout_ns = timeout_ns
        self.groups: Dict[str, LegGroup] = {}
        #: Groups that broke and were unwound. Counted, because a strategy
        #: whose groups keep breaking is a strategy whose legs do not fill
        #: together, and that is a design problem rather than bad luck.
        self.broken_count = 0
        self.completed_count = 0
        self.observed_cadence_ns = 0

    def observe_cadence(self, gap_ns: int) -> None:
        """Record the interval between events driving the system.

        Used only to catch a timeout shorter than the cadence, which would
        expire every group before its legs could fill.
        """
        if gap_ns > 0:
            self.observed_cadence_ns = max(self.observed_cadence_ns, gap_ns)

    def timeout_is_workable(self) -> bool:
        """False when the timeout cannot outlast one event gap."""
        return self.observed_cadence_ns == 0 or self.timeout_ns > self.observed_cadence_ns

    def open(self, group_id: str, strategy_id: str, at: Nanos,
             timeout_ns: Optional[int] = None) -> LegGroup:
        timeout = timeout_ns if timeout_ns is not None else self.timeout_ns
        if self.observed_cadence_ns and timeout <= self.observed_cadence_ns:
            raise ValueError(
                f"leg timeout {timeout}ns is not longer than the observed event "
                f"cadence {self.observed_cadence_ns}ns. Every group would expire "
                "before its legs could fill, and the symptom is a strategy that "
                "appears not to trade."
            )
        group = LegGroup(group_id=group_id, strategy_id=strategy_id, opened_at=at,
                         timeout_ns=timeout)
        self.groups[group_id] = group
        return group

    def group_for_order(self, client_order_id: str) -> Optional[LegGroup]:
        for group in self.groups.values():
            if client_order_id in group.legs:
                return group
        return None

    def on_fill(self, client_order_id: str, quantity: Dec) -> Optional[LegGroup]:
        group = self.group_for_order(client_order_id)
        if group is not None:
            group.on_fill(client_order_id, quantity)
        return group

    def on_status(self, client_order_id: str, status: str) -> Optional[LegGroup]:
        group = self.group_for_order(client_order_id)
        if group is not None:
            group.on_status(client_order_id, status)
        return group

    def due_for_unwind(self, now: Nanos) -> List[LegGroup]:
        """Groups that are broken and have not been unwound yet."""
        due = []
        for group in list(self.groups.values()):
            status = group.evaluate(now)
            if status == GroupStatus.BROKEN:
                due.append(group)
            elif status == GroupStatus.COMPLETE:
                self.completed_count += 1
                self.groups.pop(group.group_id, None)
            elif status == GroupStatus.ABANDONED:
                self.groups.pop(group.group_id, None)
        return due

    def mark_unwinding(self, group: LegGroup, at: Nanos) -> None:
        group.status = GroupStatus.UNWINDING
        group.unwound_at = at
        self.broken_count += 1

    def mark_unwound(self, group_id: str) -> None:
        group = self.groups.pop(group_id, None)
        if group is not None:
            group.status = GroupStatus.UNWOUND

    @property
    def open_groups(self) -> int:
        return len(self.groups)

    def break_rate(self) -> Optional[float]:
        """Fraction of groups that could not complete.

        Worth watching on its own: a rising break rate means the legs are no
        longer filling together, which usually precedes the edge disappearing.
        """
        total = self.broken_count + self.completed_count
        return self.broken_count / total if total else None
