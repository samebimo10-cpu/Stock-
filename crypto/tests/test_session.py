"""The trading session, metrics and the chaos runner."""

from __future__ import annotations

import asyncio

import pytest

from tradesys.chaos import SCENARIOS, run_all
from tradesys.core.events import Position
from tradesys.core.types import dec
from tradesys.demo import PERP_VENUE, build_cycling_events, build_pipeline
from tradesys.layers.l5_risk.killswitch import SwitchState, Trigger
from tradesys.layers.l6_execution.startup import StartupGateFailed
from tradesys.layers.l7_observability.alerts import Severity
from tradesys.layers.l7_observability.metrics import (
    Counter, Gauge, Histogram, MetricRegistry, SLO_TARGETS, SloEvaluator,
)
from tradesys.session import SessionConfig, SessionState, TradingSession

START = 1_700_000_000_000_000_000


def session(**overrides):
    pipeline, adapters, _ = build_pipeline()
    clock = {"now": START}
    config = SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                           heartbeat_interval_ns=3600 * 10**9,
                           strategy_settle_ns=0)
    for key, value in overrides.items():
        setattr(config, key, value)
    s = TradingSession(pipeline, adapters, config=config, clock=lambda: clock["now"])
    return s, adapters, clock


# ------------------------------------------------------------- metrics


def test_a_counter_cannot_decrease():
    c = Counter("c")
    c.inc(3)
    with pytest.raises(ValueError, match="cannot decrease"):
        c.inc(-1)
    assert c.value == 3


def test_a_histogram_window_is_bounded():
    """An unbounded list of every latency sample is a memory leak with a graph."""
    h = Histogram("h", window=10)
    for i in range(100):
        h.observe(float(i))
    assert len(h._samples) == 10
    assert h.count == 100


def test_percentiles_are_nearest_rank():
    h = Histogram("h")
    for v in range(1, 101):
        h.observe(float(v))
    assert h.p50 == 50.0
    assert h.p99 == 99.0


def test_prometheus_rendering():
    r = MetricRegistry()
    r.counter("orders_total", "orders sent").inc(4)
    r.gauge("equity").set(100.5)
    r.histogram("latency_ms").observe(1.0)
    text = r.render_prometheus()
    assert "# TYPE orders_total counter" in text
    assert "orders_total 4.0" in text
    assert 'latency_ms{quantile="0.99"}' in text


# ------------------------------------------------------- the alert rule


def test_the_same_breach_pages_only_when_money_is_at_risk():
    """A P1 that fires without money at risk is a defect in the alert."""
    r = MetricRegistry()
    r.gauge("clock_drift_ms").set(80.0)
    evaluator = SloEvaluator(r)

    quiet = evaluator.evaluate(money_at_risk=False)
    live = evaluator.evaluate(money_at_risk=True)
    assert [b.severity for b in quiet] == [Severity.P2]
    assert [b.severity for b in live] == [Severity.P1]


def test_slow_order_acks_never_page():
    """Slow acks lose edge; they do not lose money."""
    target = next(t for t in SLO_TARGETS if t.name == "order_ack_latency_p99")
    assert target.live_severity == Severity.P2


def test_an_unmeasured_indicator_is_not_a_breach():
    assert SloEvaluator(MetricRegistry()).evaluate(money_at_risk=True) == []


def test_breaches_route_through_the_alert_router():
    from tradesys.layers.l7_observability.alerts import AlertRouter

    r = MetricRegistry()
    r.gauge("clock_drift_ms").set(200.0)
    router = AlertRouter()
    SloEvaluator(r).raise_all(router, money_at_risk=True)
    assert [a.name for a in router.pages()] == ["clock_drift"]


# ------------------------------------------------------------- startup


def test_the_session_starts_and_runs():
    s, adapters, clock = session()
    asyncio.run(s.start())
    assert s.state == SessionState.RUNNING
    assert "reconciliation_clean" in s.startup_report
    assert "clock_drift" in s.startup_report


def test_the_dead_man_is_armed_before_any_order():
    s, _, _ = session()
    asyncio.run(s.start())
    assert s.pipeline.risk.killswitch.deadman_last_beat is not None


def test_startup_refuses_when_the_venue_holds_an_unknown_position():
    """Failure mode 6: restart, do not know about open positions, open more."""
    s, adapters, _ = session()
    adapters[PERP_VENUE].faults.hidden_positions = [
        Position(PERP_VENUE, "BTCUSDT", dec("3"), dec("60000"), dec("60000"))
    ]
    with pytest.raises(StartupGateFailed):
        asyncio.run(s.start())


def test_an_operator_can_acknowledge_a_startup_discrepancy():
    """Deliberately not automatable. Auto-resolving means trading while blind."""
    s, adapters, _ = session()
    adapters[PERP_VENUE].faults.hidden_positions = [
        Position(PERP_VENUE, "BTCUSDT", dec("3"), dec("60000"), dec("60000"))
    ]
    asyncio.run(s.start(operator="sam"))
    assert s.state == SessionState.RUNNING


def test_startup_refuses_on_clock_drift():
    s, adapters, _ = session()
    adapters[PERP_VENUE].faults.clock_skew_ns = 500_000_000      # 500ms
    with pytest.raises(StartupGateFailed, match="clock_drift"):
        asyncio.run(s.start())


# ----------------------------------------------------------- reconciling


def test_reconciliation_runs_on_its_own_cadence():
    """A quiet market is exactly when a position mismatch goes unnoticed."""
    s, adapters, clock = session(reconcile_interval_ns=10)
    asyncio.run(s.start())
    before = s.metrics.snapshot()["reconciliation_cycles"]
    clock["now"] += 1000
    asyncio.run(s.tick())
    assert s.metrics.snapshot()["reconciliation_cycles"] > before


def test_an_unexplained_position_engages_the_kill_switch():
    s, adapters, clock = session()
    asyncio.run(s.start())
    adapters[PERP_VENUE].faults.hidden_positions = [
        Position(PERP_VENUE, "ETHUSDT", dec("5"), dec("3000"), dec("3000"))
    ]
    clean, problems = asyncio.run(s.reconcile(force=True))
    assert not clean and problems
    assert Trigger.MISSING_LOCAL in s.pipeline.risk.killswitch.engaged
    assert not s.pipeline.executor.reconciliation_clean


# --------------------------------------------------------------- halting


def test_the_manual_kill_flattens_and_disables_every_strategy():
    """One command. Every operator has it. Tested weekly in production."""
    s, adapters, clock = session()
    asyncio.run(s.start())
    asyncio.run(s.manual_kill("sam"))

    assert s.state == SessionState.HALTED
    assert all(not st.health.enabled for st in s.pipeline.strategies)
    assert s.pipeline.risk.killswitch.must_flatten
    assert [a.name for a in s.alerts.pages()] == ["flatten"]


def test_the_kill_switch_state_is_published_immediately():
    """A dashboard that learns at the next tick is misread during an incident."""
    s, _, _ = session()
    asyncio.run(s.start())
    asyncio.run(s.manual_kill("sam"))
    assert s.metrics.snapshot()["kill_switch_engaged"] == 1.0


def test_a_halted_session_stops_processing_events():
    s, adapters, clock = session()
    events = build_cycling_events()
    asyncio.run(s.start())
    asyncio.run(s.on_event(events[0]))
    before = s.metrics.snapshot()["events_processed"]

    asyncio.run(s.manual_kill("sam"))
    asyncio.run(s.on_event(events[1]))
    assert s.metrics.snapshot()["events_processed"] == before


# ------------------------------------------------------------- end to end


def test_a_full_session_ends_flat_and_clean():
    s, adapters, clock = session()

    async def drive():
        await s.start()
        for event in build_cycling_events():
            clock["now"] = event.emitted_at
            for venue in adapters.values():
                venue.apply_market_event(event)
            await s.on_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    s.pipeline.on_fill(fill)

    asyncio.run(drive())
    status = s.status()
    assert status["state"] == SessionState.RUNNING
    assert status["open_positions"] == 0
    assert status["reconciliation_clean"]
    assert not s.alerts.pages(), [str(a) for a in s.alerts.pages()]
    assert s.metrics.snapshot()["reconciliation_cycles"] > 0


# ------------------------------------------------------------- chaos


def test_every_chaos_scenario_passes():
    results = run_all()
    failures = [str(r) for r in results if not r.passed]
    assert not failures, "\n".join(failures)


def test_every_failure_mode_has_a_scenario():
    """The ten failure modes of SPEC section 8.5 are all represented."""
    covered = {s.failure_mode for s in SCENARIOS}
    for mode in ("double position", "state desync", "stale balance", "clock drift",
                 "partial-fill orphan", "infinite loop", "risk service death"):
        assert mode in covered, f"no chaos scenario covers {mode}"


def test_every_scenario_states_its_guarantee():
    """So a failure reads as a broken guarantee, not as a stack trace."""
    for scenario in SCENARIOS:
        assert scenario.guarantee and len(scenario.guarantee) > 20
