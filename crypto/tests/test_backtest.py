"""End-to-end: the backtester drives the same pipeline live would."""

from __future__ import annotations

import asyncio

import pytest

from tradesys.research.backtest import Backtester
from tradesys.research.registry import RegistryRequired, TrialRegistry
from tradesys.demo import PERP_VENUE, build_events, build_pipeline


def test_backtest_runs_and_registers_its_trial():
    pipeline, adapters, _ = build_pipeline()
    registry = TrialRegistry()
    bt = Backtester(pipeline, adapters, registry, strategy_name="funding_carry",
                    parameters=pipeline.strategies[0].parameters())

    events = build_events()
    result = asyncio.run(bt.run(events, "2024-01-01", "2024-02-01"))

    assert result.events == len(events)
    assert result.signals >= 1
    assert registry.count("funding_carry") == 1
    trial = registry.get(result.trial_id)
    assert trial.outcome == "complete"
    assert trial.data_start == "2024-01-01"


def test_every_run_increments_the_trial_count():
    """Deflated Sharpe uses this number, so it must count every run."""
    registry = TrialRegistry()
    events = build_events()
    for _ in range(3):
        pipeline, adapters, _ = build_pipeline()
        bt = Backtester(pipeline, adapters, registry, strategy_name="funding_carry")
        asyncio.run(bt.run(events))
    assert registry.count("funding_carry") == 3


def test_a_crashed_backtest_is_still_a_trial():
    registry = TrialRegistry()
    pipeline, adapters, _ = build_pipeline()
    bt = Backtester(pipeline, adapters, registry, strategy_name="funding_carry")

    class Exploding(list):
        def __iter__(self):
            raise RuntimeError("bad data")

    with pytest.raises(RuntimeError):
        asyncio.run(bt.run(Exploding()))
    assert registry.count("funding_carry") == 1
    assert registry.get(1).outcome == "error"


def test_no_registry_means_no_backtest():
    with pytest.raises(RegistryRequired, match="true trial count"):
        Backtester(pipeline=None, adapter=None, registry=None)


def test_equity_curve_is_produced():
    pipeline, adapters, _ = build_pipeline()
    bt = Backtester(pipeline, adapters, TrialRegistry(), strategy_name="funding_carry")
    result = asyncio.run(bt.run(build_events()))
    assert len(result.equity_curve) == result.events
    assert all(e > 0 for e in result.equity_curve)


def test_the_audit_log_records_the_session(tmp_path):
    """Given the log, the research environment can reproduce every decision."""
    from tradesys.layers.l7_observability.audit import AuditLog

    pipeline, adapters, _ = build_pipeline()
    pipeline.audit = AuditLog(tmp_path / "audit.jsonl")
    bt = Backtester(pipeline, adapters, TrialRegistry(), strategy_name="funding_carry")
    asyncio.run(bt.run(build_events()))

    assert pipeline.audit.verify()
    kinds = {rec["kind"] for rec in pipeline.audit.read()}
    assert {"signal", "risk_decision", "order"} <= kinds


def test_the_built_in_limits_cannot_drift_from_the_repository_file():
    """An installed package has no risk/limits.yaml on disk.

    Two copies of a limit register that disagree is the failure the fallback
    would otherwise introduce: it starts, it looks right, and it enforces
    something nobody agreed to. This test is what makes the fallback safe
    rather than merely convenient.
    """
    from tradesys.config import BUILT_IN_LIMITS, load_limits
    from tradesys.layers.l5_risk.limits import LimitRegister
    from tests.conftest import LIMITS_PATH

    from_file = LimitRegister.from_yaml(LIMITS_PATH)
    built_in = LimitRegister.from_mapping(BUILT_IN_LIMITS)
    assert from_file.snapshot() == built_in.snapshot()
    assert from_file.equity_definition == built_in.equity_definition
    assert load_limits().snapshot() == from_file.snapshot()


# ------------------------------------------------------- the cost model


def test_the_backtest_applies_the_cost_model():
    """A backtest without an honest cost model is a random number generator."""
    from tradesys.demo import build_events, build_pipeline

    pipeline, adapters, _ = build_pipeline(with_costs=True)
    bt = Backtester(pipeline, adapters, TrialRegistry(), "funding_carry")
    result = asyncio.run(bt.run(build_events()))

    assert result.fills >= 1, "no fills, so the cost model was never exercised"
    assert result.books is not None
    assert result.books.total_fees() > 0
    assert result.modelled_costs["adverse_selection"] > 0


def test_costless_and_costed_runs_differ():
    """The comparison must be able to show a difference, or it proves nothing."""
    from tradesys.demo import build_events, build_pipeline

    events = build_events()
    outcomes = {}
    for with_costs in (False, True):
        pipeline, adapters, _ = build_pipeline(with_costs=with_costs)
        bt = Backtester(pipeline, adapters, TrialRegistry(), "funding_carry")
        outcomes[with_costs] = asyncio.run(bt.run(events)).equity_curve[-1]
    assert outcomes[True] < outcomes[False]


def test_the_review_heuristic_runs_and_can_fail():
    """If costs do not cut returns by 30%, the model is wrong, not the strategy."""
    from tradesys.demo import build_events, build_pipeline
    from tradesys.research.backtest import cost_impact

    registry = TrialRegistry()
    impact = asyncio.run(cost_impact(
        lambda with_costs: build_pipeline(with_costs=with_costs),
        build_events(), registry, "funding_carry",
    ))
    assert impact.cut > 0
    assert isinstance(impact.passes, bool)
    assert registry.count() == 2          # both runs are trials


def test_maker_fills_need_volume_at_their_level():
    """Filling on a price touch overstates maker fill rates by two to five times."""
    from tradesys.adapters.sim import SimAdapter
    from tradesys.core.events import OrderIntent, SymbolFilter
    from tradesys.core.types import dec

    filters = {"BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10"))}
    adapter = SimAdapter(filters=filters, model_queue=True)
    adapter.set_book("BTCUSDT", [("60000", "5")], [("60001", "5")])

    intent = OrderIntent(correlation_id="c", emitted_at=0, source="t",
                         client_order_id="ts_m", venue="sim", symbol="BTCUSDT",
                         side="sell", quantity=dec("1"), order_type="limit",
                         price=dec("60001"), post_only=True, strategy_id="s")
    asyncio.run(adapter.place(intent))

    adapter.set_book("BTCUSDT", [("60001", "5")], [("60002", "5")])   # our level is crossed
    assert adapter.step() == [], "filled with no volume traded at our level"

    # Five units rest ahead of us; the first five do not reach us.
    adapter.observe_trade("BTCUSDT", dec("60001"), dec("5"), "buy")
    assert adapter.step() == []
    adapter.observe_trade("BTCUSDT", dec("60001"), dec("2"), "buy")
    fills = adapter.step()
    assert len(fills) == 1 and fills[0].quantity == dec("1")


def test_queue_modelling_is_on_by_default():
    """The pessimistic behaviour is the default, not an opt-in."""
    from tradesys.adapters.sim import SimAdapter

    assert SimAdapter().model_queue is True


def test_funding_accrues_to_the_books_during_a_backtest():
    from tradesys.demo import build_events, build_pipeline

    pipeline, adapters, _ = build_pipeline()
    bt = Backtester(pipeline, adapters, TrialRegistry(), "funding_carry")
    result = asyncio.run(bt.run(build_events()))
    led = result.books.strategies.get("funding_carry")
    assert led is not None
    assert led.funding != 0, "a carry strategy that never accrues funding is not carrying"


def test_the_ledger_closes_after_a_backtest():
    from tradesys.demo import build_events, build_pipeline

    pipeline, adapters, _ = build_pipeline()
    bt = Backtester(pipeline, adapters, TrialRegistry(), "funding_carry")
    result = asyncio.run(bt.run(build_events()))
    assert result.books.reconciles(), (
        f"ledger off by {result.books.reconciliation_error()}"
    )


def test_the_simulated_venue_tracks_the_replayed_book():
    """Otherwise fills are decided against a stale price, which looks like a result."""
    from tradesys.demo import build_events, build_pipeline

    pipeline, adapters, _ = build_pipeline()
    events = build_events()
    bt = Backtester(pipeline, adapters, TrialRegistry(), "funding_carry")
    asyncio.run(bt.run(events))

    last_snapshot = [e for e in events
                     if e.kind == "book_snapshot" and e.venue == PERP_VENUE][-1]
    assert adapters[PERP_VENUE].books["BTCUSDT"].best_bid == last_snapshot.payload.bids[0][0]
