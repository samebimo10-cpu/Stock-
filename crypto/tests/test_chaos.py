"""Chaos scenarios (SPEC section 14.3).

Each of the failure modes in SPEC section 8.5, injected, with the expected
behaviour asserted. These are the failures that are invisible in a backtest
because the backtest has no listenKey, no clock and no partial fills unless it
was deliberately built to have them.
"""

from __future__ import annotations

import asyncio

import pytest

from tradesys.core.errors import (
    AuthFailed, InsufficientBalance, IpBanned, RateLimited, UnknownState,
)
from tradesys.core.events import OrderIntent, OrderStatus, Position, RiskDecision
from tradesys.core.types import dec
from tradesys.layers.l6_execution.reconcile import DiscrepancyClass, Reconciler

NOW = 1_700_000_000_000_000_000


def make_intent(coid="ts_a", qty="0.5"):
    return OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                       client_order_id=coid, venue="sim", symbol="BTCUSDT",
                       side="buy", quantity=dec(qty), order_type="market",
                       strategy_id="s")


def approve(intent):
    return RiskDecision(correlation_id="c", emitted_at=NOW, source="l5_risk",
                        intent_id=intent.client_order_id, approved=True,
                        adjusted_quantity=intent.quantity)


# --------- failure mode 1: double position from a dropped response ---------


def test_dropped_response_does_not_cause_a_second_order(executor, adapter):
    """The venue accepted it. We were told nothing. We must not send again.

    This is the scenario behind failure mode 1: network timeout, retry, two
    fills. The order goes to QUERY, and QUERY refuses to place anything.
    """
    adapter.faults.drop_response_after_accept = True
    intent = make_intent()
    result = asyncio.run(executor.submit(intent, approve(intent)))

    assert not result.accepted
    assert result.unknown
    assert result.machine.status == OrderStatus.QUERY
    assert not result.machine.may_place_new_order

    # The venue really did fill it.
    assert len(adapter.fills) == 1

    # Resubmitting the same intent is refused rather than doubling the position.
    again = asyncio.run(executor.submit(intent, approve(intent)))
    assert not again.accepted
    assert len(adapter.fills) == 1


def test_query_resolves_from_the_venue(executor, adapter):
    adapter.faults.drop_response_after_accept = True
    intent = make_intent()
    asyncio.run(executor.submit(intent, approve(intent)))
    machine = asyncio.run(executor.resolve_unknown(intent.client_order_id))
    assert machine.status == OrderStatus.FILLED
    assert machine.filled == dec("0.5")


def test_timeout_without_acceptance_resolves_to_rejected(executor, adapter):
    """Not every unknown is a fill. QUERY must be able to conclude either way."""
    adapter.faults.timeout_without_accept = True
    intent = make_intent()
    result = asyncio.run(executor.submit(intent, approve(intent)))
    assert result.unknown
    machine = asyncio.run(executor.resolve_unknown(intent.client_order_id))
    assert machine.status == OrderStatus.REJECTED
    assert adapter.fills == []


def test_duplicate_client_order_id_is_refused_by_the_venue(adapter):
    """Idempotency, as the venue enforces it."""
    intent = make_intent()
    asyncio.run(adapter.place(intent))
    with pytest.raises(Exception):
        asyncio.run(adapter.place(intent))


# ------------------ failure mode 2: state desync -------------------------


def test_missing_local_position_halts_and_is_never_adopted():
    """Finding a position you cannot explain is a reason to stop, not to manage it."""
    rec = Reconciler("sim")
    remote = [Position("sim", "ETHUSDT", dec("3"), dec("3000"), dec("3000"))]
    report = rec.reconcile({}, remote, {}, [], dec("100000"), NOW)

    assert not report.clean
    kinds = [d["kind"] for d in report.discrepancies]
    assert DiscrepancyClass.MISSING_LOCAL in kinds
    assert rec.halting_discrepancies(report)
    assert report.discrepancies[0]["severity"] == "P1"


def test_material_quantity_mismatch_halts():
    rec = Reconciler("sim")
    local = {("sim", "BTCUSDT"): Position("sim", "BTCUSDT", dec("1"), dec("60000"), dec("60000"))}
    remote = [Position("sim", "BTCUSDT", dec("0.5"), dec("60000"), dec("60000"))]
    report = rec.reconcile(local, remote, {}, [], dec("100000"), NOW)
    assert not report.clean
    assert report.discrepancies[0]["kind"] == DiscrepancyClass.QTY_MISMATCH
    assert report.discrepancies[0]["severity"] == "P1"


def test_immaterial_price_mismatch_does_not_halt():
    rec = Reconciler("sim")
    local = {("sim", "BTCUSDT"): Position("sim", "BTCUSDT", dec("1"), dec("60000"), dec("60000"))}
    remote = [Position("sim", "BTCUSDT", dec("1"), dec("60001"), dec("60000"))]
    report = rec.reconcile(local, remote, {}, [], dec("100000"), NOW)
    assert report.discrepancies[0]["kind"] == DiscrepancyClass.PRICE_MISMATCH
    assert not rec.halting_discrepancies(report)


def test_clean_cycles_are_still_reported():
    """Their absence is what tells you reconciliation stopped running."""
    rec = Reconciler("sim")
    report = rec.reconcile({}, [], {}, [], dec("100000"), NOW)
    assert report.clean
    assert rec.last_report is report


def test_three_failed_cycles_trigger_a_halt():
    rec = Reconciler("sim")
    assert not rec.on_cycle_failed()
    assert not rec.on_cycle_failed()
    assert rec.on_cycle_failed()


# ------------------ failure mode 8: stale balance ------------------------


def test_insufficient_balance_is_not_retried(executor, adapter):
    """-2010 is usually stale local state, so it triggers reconciliation."""
    adapter.faults.reject_next = "balance"
    intent = make_intent()
    result = asyncio.run(executor.submit(intent, approve(intent)))
    assert not result.accepted
    assert not result.unknown                      # terminal, not a poll loop
    assert result.machine.status == OrderStatus.REJECTED


# ------------------ failure mode 9: clock drift --------------------------


def test_clock_skew_is_visible_to_the_caller(adapter):
    adapter.faults.clock_skew_ns = 200 * 1_000_000      # 200ms
    skewed = asyncio.run(adapter.server_time())
    assert abs(skewed - adapter.now) == 200 * 1_000_000


# ------------------ failure mode 10: partial fill ------------------------


def test_partial_fill_leaves_the_order_open(executor, adapter):
    adapter.faults.partial_fill_fraction = dec("0.4")
    intent = make_intent(qty="1")
    result = asyncio.run(executor.submit(intent, approve(intent)))
    assert result.accepted
    state = asyncio.run(adapter.query_order(intent.client_order_id))
    assert state.status == OrderStatus.PARTIAL
    assert state.filled_quantity < intent.quantity


# ------------------ rate limits and bans ---------------------------------


def test_rate_limit_is_surfaced_not_swallowed(adapter):
    adapter.faults.rate_limit_next = True
    with pytest.raises(RateLimited):
        asyncio.run(adapter.place(make_intent()))


def test_ip_ban_is_distinct_from_a_rate_limit(adapter):
    """418 means the limiter already failed. Waiting it out is the only option."""
    adapter.faults.ip_ban_next = True
    with pytest.raises(IpBanned):
        asyncio.run(adapter.place(make_intent()))


def test_auth_failure_halts_rather_than_retrying(executor, adapter):
    adapter.faults.reject_next = "auth"
    intent = make_intent()
    result = asyncio.run(executor.submit(intent, approve(intent)))
    assert not result.accepted


# ------------------ book cannot fill -------------------------------------


def test_unfillable_size_does_not_silently_partial(adapter):
    """A book that cannot fill must say so, not fill at the last level."""
    adapter.set_book("BTCUSDT", [("60000", "0.1")], [("60001", "0.1")])
    with pytest.raises(InsufficientBalance):
        asyncio.run(adapter.place(make_intent(coid="ts_big", qty="100")))
