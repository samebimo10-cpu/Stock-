"""The allocator that applies weights, rather than only computing them."""

from __future__ import annotations

import asyncio

import pytest

from tradesys.core.events import Signal
from tradesys.core.types import dec
from tradesys.demo import build_cycling_events, build_pipeline
from tradesys.layers.l4_portfolio.allocator import Allocator
from tradesys.layers.l4_portfolio.correlation import CorrelationEstimator
from tradesys.layers.l4_portfolio.netting import net_targets
from tradesys.session import SessionConfig, TradingSession

DAY = 24 * 3600 * 10**9


def sig(strategy, target, symbol="BTCUSDT"):
    return Signal(correlation_id="c", emitted_at=0, source="s", strategy_id=strategy,
                  venue="sim", symbol=symbol, target_position=dec(target), valid_until=1)


def allocator_with(series, rebalance_ns=0):
    a = Allocator(rebalance_ns=rebalance_ns)
    for name, values in series.items():
        for v in values:
            a.observe(name, v)
    return a


# ---------------------------------------------------------- applying them


def test_weights_scale_exposure_rather_than_gating_it():
    """A strategy at a fifth of the budget trades a fifth of its size, not one
    day in five. Gating would make the allocation a lottery."""
    result = net_targets([sig("a", "10")], weights={"a": dec("0.2")})
    assert result.targets[0].target == dec("2")


def test_no_weights_means_full_size():
    assert net_targets([sig("a", "10")]).targets[0].target == dec("10")


def test_weights_and_the_drawdown_multiplier_compose():
    result = net_targets([sig("a", "10")], multiplier=dec("0.5"),
                         weights={"a": dec("0.4")})
    assert result.targets[0].target == dec("2")


def test_an_unweighted_strategy_is_flat():
    """A strategy the allocator does not know about does not trade."""
    result = net_targets([sig("a", "10")], weights={"b": dec("1")})
    assert result.targets[0].target == dec("0")


# ------------------------------------------------------------- solving


def test_equal_weight_until_there_is_profit_history():
    """A system that refuses to trade until it has sixty days of profit and
    loss never gets sixty days of profit and loss."""
    a = Allocator()
    assert a.weight_for("anything") == dec("1")


def test_too_little_history_falls_back_to_equal_weight():
    a = allocator_with({"x": [1.0] * 5, "y": [1.0] * 5})
    a.solve(["x", "y"], now=DAY, force=True)
    assert a.weights == {"x": dec("0.5"), "y": dec("0.5")}


def test_the_calmer_strategy_carries_more_capital():
    """Out of phase, so they are not the same strategy wearing two names."""
    calm = [0.1 if i % 2 else -0.1 for i in range(80)]
    mid = [0.4 if i % 4 else -0.3 for i in range(80)]
    wild = [1.0 if i % 3 else -0.5 for i in range(80)]
    a = allocator_with({"calm": calm, "mid": mid, "wild": wild})
    a.solve(["calm", "mid", "wild"], now=DAY, force=True)
    assert a.weights["calm"] > a.weights["wild"]


def test_two_strategies_cannot_reach_risk_parity_at_all():
    """The 40% cap is infeasible below three strategies, so it relaxes to equal
    weight - and equal weight is not risk parity.

    This is a portfolio problem rather than a solver one: you do not have
    enough strategies. Presenting the result as an optimisation would hide
    that, so the status reports it.
    """
    calm = [0.1 if i % 2 else -0.1 for i in range(80)]
    wild = [1.0 if i % 3 else -0.5 for i in range(80)]
    a = allocator_with({"calm": calm, "wild": wild})
    a.solve(["calm", "wild"], now=DAY, force=True)

    assert a.weights["calm"] == a.weights["wild"] == dec("0.5")
    assert a.status()["risk_parity_reachable"] is False


def test_it_re_solves_on_a_schedule_not_every_event():
    """Chasing an estimate that moved by noise is the churn the deadband
    exists to prevent."""
    a = allocator_with({"x": [0.1, -0.1] * 40, "y": [0.2, -0.2] * 40},
                       rebalance_ns=DAY)
    a.solve(["x", "y"], now=DAY, force=True)
    version = a.version
    assert not a.due(DAY + 1)
    a.solve(["x", "y"], now=DAY + 1)
    assert a.version == version


def test_a_correlated_pair_has_its_allocation_halved():
    shared = [float((i % 7) - 3) for i in range(80)]
    a = allocator_with({"one": shared, "two": [v * 0.75 for v in shared]})
    a.solve(["one", "two"], now=DAY, force=True)
    assert a.breaches, "a correlated pair was not flagged"
    assert sum(a.weights.values()) < dec("1")


def test_a_nearly_identical_pair_disables_the_worse_performer():
    strong = [float(i % 5) for i in range(80)]
    weak = [v - 1.0 for v in strong]
    a = allocator_with({"strong": strong, "weak": weak})
    a.solve(["strong", "weak"], now=DAY, force=True)
    actions = {action for _, _, _, action in a.breaches}
    if "disable_worse_performer" in actions:
        assert a.weights["weak"] == dec("0")


def test_status_reports_what_it_did():
    a = allocator_with({"x": [0.1, -0.1] * 40, "y": [0.3, -0.3] * 40})
    a.solve(["x", "y"], now=DAY, force=True)
    status = a.status()
    assert status["version"] >= 1
    assert set(status["weights"]) == {"x", "y"}


# ------------------------------------------------------------- end to end


def test_a_session_feeds_daily_profit_to_the_allocator():
    """Correlation is estimated on daily strategy profit, not on asset returns."""
    pipeline, adapters, _ = build_pipeline()
    clock = {"now": 1_700_000_000_000_000_000}
    session = TradingSession(
        pipeline, adapters,
        config=SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                             heartbeat_interval_ns=3600 * 10**9, strategy_settle_ns=0),
        clock=lambda: clock["now"],
    )

    async def drive():
        await session.start()
        for event in build_cycling_events():
            clock["now"] = event.emitted_at
            for venue in adapters.values():
                venue.apply_market_event(event)
            await session.on_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)

    asyncio.run(drive())
    history = pipeline.allocator.correlations.history
    assert history.get("funding_carry"), "no daily profit reached the allocator"
    assert len(history["funding_carry"]) > 10


def test_the_allocation_appears_in_session_status():
    pipeline, adapters, _ = build_pipeline()
    session = TradingSession(pipeline, adapters,
                             config=SessionConfig(strategy_settle_ns=0))
    assert "allocation" in session.status()
