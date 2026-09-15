"""The executor: risk decision in, venue call out, state machine maintained.

Every order in the system passes through :meth:`Executor.submit`. That is not
convenience - it is where SPEC section 3.2 rule 1 becomes structural. The
executor is the only component holding a venue handle, and it refuses to act
without a :class:`RiskDecision` that says yes.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, List, Mapping, Optional, Sequence

from ...adapters.base import FilterRounder, VenueAdapter
from ...core.errors import (
    CancelRejected,
    FilterViolation,
    InsufficientBalance,
    OrderNotFound,
    RateLimited,
    UnknownState,
    VenueError,
)
from ...core.events import (
    Fill,
    OrderIntent,
    OrderState,
    OrderStatus,
    RiskDecision,
    SymbolFilter,
)
from ...core.ids import client_order_id
from ...core.types import Decimal as Dec, Nanos, dec, now_ns
from .fsm import OrderMachine

__all__ = ["Executor", "ExecutionResult"]


@dataclass
class ExecutionResult:
    accepted: bool
    machine: Optional[OrderMachine] = None
    reason: str = ""
    #: True when the order's fate is unknown and the system must poll. Never
    #: a reason to send anything.
    unknown: bool = False


class Executor:
    """Owns the venue handle and every order machine."""

    def __init__(self, adapter: VenueAdapter, filters: Optional[Mapping[str, SymbolFilter]] = None,
                 clock=now_ns) -> None:
        self.adapter = adapter
        self.filters: Dict[str, SymbolFilter] = dict(filters or {})
        self.clock = clock
        self.machines: Dict[str, OrderMachine] = {}
        self._intent_sequence: Dict[str, int] = {}
        self.reconciliation_clean = True
        #: Set when reconciliation finds an unknown position. Blocks everything.
        self.halted_reason: Optional[str] = None

    # -- intent construction ---------------------------------------------

    def build_intent(self, *, strategy_id: str, venue: str, symbol: str, side: str,
                     quantity: Dec, correlation_id: str, price: Optional[Dec] = None,
                     order_type: str = "limit", time_in_force: str = "GTC",
                     post_only: bool = False, reduce_only: bool = False,
                     last_price: Optional[Dec] = None) -> OrderIntent:
        """Round through the venue filters, then build the intent.

        Rounding happens here, inside the adapter boundary, and downward for
        quantity. Risk approves the rounded number, so nothing downstream can
        round it back up past what was approved.
        """
        key = f"{strategy_id}:{symbol}"
        seq = self._intent_sequence.get(key, 0)
        self._intent_sequence[key] = seq + 1
        coid = client_order_id(strategy_id, symbol, seq)

        f = self.filters.get(symbol)
        if f is not None:
            quantity, price = FilterRounder(f).prepare(quantity, price, side, last_price)

        return OrderIntent(
            correlation_id=correlation_id,
            emitted_at=self.clock(),
            source="l6_execution",
            client_order_id=coid,
            venue=venue,
            symbol=symbol,
            side=side,
            quantity=quantity,
            order_type=order_type,
            price=price,
            time_in_force=time_in_force,
            post_only=post_only,
            reduce_only=reduce_only,
            strategy_id=strategy_id,
        )

    # -- submission -------------------------------------------------------

    async def submit(self, intent: OrderIntent, decision: Optional[RiskDecision]) -> ExecutionResult:
        """Send an order, but only against an explicit approval.

        ``decision is None`` is the timeout case, and it is a reject. Absence
        of an approval is never an approval.
        """
        now = self.clock()

        if self.halted_reason:
            return ExecutionResult(False, reason=f"execution halted: {self.halted_reason}")

        if decision is None:
            return ExecutionResult(
                False,
                reason="no risk decision (timeout); absence of an approval is not an approval",
            )
        if not decision.approved:
            return ExecutionResult(False, reason=f"risk rejected: {decision.rejected_by}")
        if decision.intent_id != intent.client_order_id:
            return ExecutionResult(False, reason="risk decision does not match this intent")

        quantity = decision.adjusted_quantity if decision.adjusted_quantity is not None else intent.quantity
        if quantity > intent.quantity:
            # Should be impossible; the risk service asserts it too. Refusing
            # here as well costs nothing and closes the path entirely.
            return ExecutionResult(False, reason="risk returned a larger quantity than requested")
        if quantity <= 0:
            return ExecutionResult(False, reason="risk reduced the order to zero")

        existing = self.machines.get(intent.client_order_id)
        if existing is not None and not existing.may_place_new_order:
            return ExecutionResult(
                False, machine=existing,
                reason=f"order {intent.client_order_id} is {existing.status}; "
                       "it may still exist at the venue",
                unknown=existing.status == OrderStatus.QUERY,
            )

        from dataclasses import replace as _replace
        sized = _replace(intent, quantity=quantity) if quantity != intent.quantity else intent

        machine = OrderMachine(sized, entered_state_at=now)
        self.machines[sized.client_order_id] = machine
        machine.on_sent(now)

        try:
            ack = await self.adapter.place(sized)
        except UnknownState as e:
            # The request went out. The order may exist. This is the whole
            # reason QUERY is a state.
            machine.on_unknown(self.clock(), str(e))
            return ExecutionResult(False, machine=machine, reason=str(e), unknown=True)
        except (FilterViolation, InsufficientBalance, OrderNotFound) as e:
            machine.on_reject(self.clock(), str(e))
            return ExecutionResult(False, machine=machine, reason=str(e))
        except RateLimited as e:
            machine.on_reject(self.clock(), str(e))
            return ExecutionResult(False, machine=machine, reason=str(e))
        except VenueError as e:
            # Anything unclassified is treated as unknown, not as failed.
            # Assuming failure is how a filled order gets sent twice.
            machine.on_unknown(self.clock(), str(e))
            return ExecutionResult(False, machine=machine, reason=str(e), unknown=True)

        machine.on_ack(ack.venue_order_id, self.clock())
        return ExecutionResult(True, machine=machine)

    # -- resolution -------------------------------------------------------

    async def resolve_unknown(self, client_order_id_: str) -> OrderMachine:
        """Poll a QUERY order until the venue answers. Never sends anything."""
        machine = self.machines[client_order_id_]
        if machine.status != OrderStatus.QUERY:
            return machine
        try:
            state = await self.adapter.query_order(client_order_id_, machine.intent.symbol)
        except OrderNotFound:
            machine.on_not_found(self.clock())
            return machine
        except VenueError:
            machine.on_unknown(self.clock(), "query failed; still unknown")
            return machine
        machine.on_query_result(state, self.clock())
        return machine

    async def cancel(self, client_order_id_: str) -> bool:
        machine = self.machines.get(client_order_id_)
        if machine is None or machine.is_terminal:
            return False
        try:
            await self.adapter.cancel(client_order_id_, machine.intent.symbol)
        except CancelRejected:
            # It may already have filled. Ask, do not assume.
            await self.resolve_unknown_or_query(machine)
            return False
        except OrderNotFound:
            machine.on_not_found(self.clock())
            return False
        machine.on_cancel_ack(self.clock())
        return True

    async def resolve_unknown_or_query(self, machine: OrderMachine) -> OrderMachine:
        if machine.status != OrderStatus.QUERY:
            machine.on_unknown(self.clock(), "cancel rejected; state unclear")
        return await self.resolve_unknown(machine.intent.client_order_id)

    # -- fills -------------------------------------------------------------

    def on_fill(self, fill: Fill) -> Optional[OrderMachine]:
        machine = self.machines.get(fill.client_order_id)
        if machine is None:
            return None
        machine.on_fill(fill.quantity, fill.local_recv_ts or self.clock())
        return machine

    # -- housekeeping ------------------------------------------------------

    def timed_out_orders(self, now: Optional[Nanos] = None) -> List[OrderMachine]:
        t = now if now is not None else self.clock()
        return [m for m in self.machines.values() if m.timed_out(t)]

    def unresolved_queries(self, now: Optional[Nanos] = None) -> List[OrderMachine]:
        t = now if now is not None else self.clock()
        return [m for m in self.machines.values() if m.query_needs_alert(t)]

    def open_machines(self) -> List[OrderMachine]:
        return [m for m in self.machines.values() if not m.is_terminal]

    def halt(self, reason: str) -> None:
        self.halted_reason = reason
