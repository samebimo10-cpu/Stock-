"""Order lifecycle, idempotency, and the rule that a timeout is not a rejection."""

from __future__ import annotations

import asyncio

import pytest

from tradesys.core.errors import UnknownState
from tradesys.core.events import OrderIntent, OrderStatus, RiskDecision
from tradesys.core.types import dec
from tradesys.layers.l6_execution.fsm import (
    IllegalTransition, OrderMachine, TIMEOUTS, TRANSITIONS,
)
from tradesys.layers.l6_execution.startup import StartupGate, StartupGateFailed

NOW = 1_700_000_000_000_000_000


def make_intent(coid="ts_a", qty="1"):
    return OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                       client_order_id=coid, venue="sim", symbol="BTCUSDT",
                       side="buy", quantity=dec(qty), order_type="limit",
                       price=dec("60000"), strategy_id="s")


def approve(intent, qty=None):
    return RiskDecision(correlation_id="c", emitted_at=NOW, source="l5_risk",
                        intent_id=intent.client_order_id, approved=True,
                        adjusted_quantity=qty or intent.quantity)


# ------------------------------------------------------------------- FSM


def test_query_is_a_trap_state():
    """An order whose state is unknown may never cause another order.

    This is the single most important predicate in the execution layer. A
    system that answers True here while in QUERY will double-fill.
    """
    m = OrderMachine(make_intent(), entered_state_at=NOW)
    m.on_sent(NOW)
    m.on_unknown(NOW + 1, "-1007 timeout")
    assert m.status == OrderStatus.QUERY
    assert not m.may_place_new_order


def test_query_cannot_return_to_pending():
    """Returning to PENDING is how a system talks itself into resending."""
    m = OrderMachine(make_intent(), entered_state_at=NOW)
    m.on_sent(NOW)
    m.on_unknown(NOW + 1, "timeout")
    with pytest.raises(IllegalTransition):
        m.transition(OrderStatus.PENDING, NOW + 2)


def test_query_has_no_timeout():
    """QUERY polls forever by design; it alerts rather than giving up."""
    assert TIMEOUTS[OrderStatus.QUERY] is None
    m = OrderMachine(make_intent(), entered_state_at=NOW)
    m.on_sent(NOW)
    m.on_unknown(NOW, "timeout")
    assert not m.timed_out(NOW + 10**12)
    assert m.query_needs_alert(NOW + 31 * 10**9)


def test_terminal_states_are_terminal():
    for terminal in (OrderStatus.FILLED, OrderStatus.CANCELLED, OrderStatus.REJECTED):
        assert TRANSITIONS[terminal] == set()


def test_pending_times_out_into_query():
    m = OrderMachine(make_intent(), entered_state_at=NOW)
    m.on_sent(NOW)
    assert m.timed_out(NOW + 6 * 10**9)


# -------------------------------------------------------------- executor


def test_timeout_is_a_reject(executor):
    """Absence of an approval is never an approval."""
    intent = make_intent()
    result = asyncio.run(executor.submit(intent, None))
    assert not result.accepted
    assert "absence of an approval is not an approval" in result.reason


def test_rejected_decision_stops_the_order(executor):
    intent = make_intent()
    decision = RiskDecision(correlation_id="c", emitted_at=NOW, source="l5_risk",
                            intent_id=intent.client_order_id, approved=False,
                            rejected_by="7_per_trade_risk")
    result = asyncio.run(executor.submit(intent, decision))
    assert not result.accepted and "7_per_trade_risk" in result.reason


def test_decision_for_a_different_intent_is_refused(executor):
    intent = make_intent()
    decision = approve(make_intent(coid="ts_other"))
    result = asyncio.run(executor.submit(intent, decision))
    assert not result.accepted and "does not match" in result.reason


def test_risk_cannot_enlarge_via_the_executor(executor):
    """Belt and braces: the service asserts it, and the executor refuses it."""
    intent = make_intent(qty="1")
    decision = approve(intent, qty=dec("5"))
    result = asyncio.run(executor.submit(intent, decision))
    assert not result.accepted and "larger quantity" in result.reason


def test_risk_may_reduce(executor):
    intent = make_intent(qty="1")
    result = asyncio.run(executor.submit(intent, approve(intent, qty=dec("0.5"))))
    assert result.accepted
    assert result.machine.intent.quantity == dec("0.5")


def test_intent_quantities_are_rounded_down_by_the_adapter(executor):
    intent = executor.build_intent(
        strategy_id="s", venue="sim", symbol="BTCUSDT", side="buy",
        quantity=dec("0.123456789"), correlation_id="c", price=dec("60000.987"),
    )
    assert intent.quantity == dec("0.12345")        # step 0.00001, rounded down
    assert intent.price == dec("60000.98")          # tick 0.01, buy rounds down


def test_client_order_ids_are_sequential_and_deterministic(executor):
    from tradesys.core.ids import client_order_id

    a = executor.build_intent(strategy_id="s", venue="sim", symbol="BTCUSDT",
                              side="buy", quantity=dec("0.01"), correlation_id="c",
                              price=dec("60000"))
    b = executor.build_intent(strategy_id="s", venue="sim", symbol="BTCUSDT",
                              side="buy", quantity=dec("0.01"), correlation_id="c",
                              price=dec("60000"))
    assert a.client_order_id == client_order_id("s", "BTCUSDT", 0)
    assert b.client_order_id == client_order_id("s", "BTCUSDT", 1)


# --------------------------------------------------------- startup gate


def test_startup_gate_blocks_on_a_failed_check():
    gate = StartupGate().add("clock_drift", lambda: False, detail="drift 400ms")
    with pytest.raises(StartupGateFailed, match="clock_drift"):
        gate.run()


def test_a_check_that_throws_has_failed():
    def explode():
        raise ConnectionError("venue unreachable")

    gate = StartupGate().add("venue_reachable", explode)
    with pytest.raises(StartupGateFailed):
        gate.run()


def test_discrepancy_requires_a_human():
    """Step 5 of SPEC section 9.5, deliberately not automatable."""
    gate = StartupGate().add("reconcile", lambda: True)
    gate.needs_acknowledgement = True
    with pytest.raises(StartupGateFailed, match="acknowledge"):
        gate.run()
    gate.acknowledge("operator-a")
    assert gate.run()
    assert gate.may_enable_strategies
