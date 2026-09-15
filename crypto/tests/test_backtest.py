"""End-to-end: the backtester drives the same pipeline live would."""

from __future__ import annotations

import asyncio

import pytest

from tradesys.research.backtest import Backtester
from tradesys.research.registry import RegistryRequired, TrialRegistry
from tests.test_same_code_path import build_events, build_pipeline


def test_backtest_runs_and_registers_its_trial():
    pipeline, adapter, _ = build_pipeline()
    registry = TrialRegistry()
    bt = Backtester(pipeline, adapter, registry, strategy_name="funding_carry",
                    parameters=pipeline.strategies[0].parameters())

    result = asyncio.run(bt.run(build_events(), "2024-01-01", "2024-02-01"))

    assert result.events == 90
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
        pipeline, adapter, _ = build_pipeline()
        bt = Backtester(pipeline, adapter, registry, strategy_name="funding_carry")
        asyncio.run(bt.run(events))
    assert registry.count("funding_carry") == 3


def test_a_crashed_backtest_is_still_a_trial():
    registry = TrialRegistry()
    pipeline, adapter, _ = build_pipeline()
    bt = Backtester(pipeline, adapter, registry, strategy_name="funding_carry")

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
    pipeline, adapter, _ = build_pipeline()
    bt = Backtester(pipeline, adapter, TrialRegistry(), strategy_name="funding_carry")
    result = asyncio.run(bt.run(build_events()))
    assert len(result.equity_curve) == result.events
    assert all(e > 0 for e in result.equity_curve)


def test_the_audit_log_records_the_session(tmp_path):
    """Given the log, the research environment can reproduce every decision."""
    from tradesys.layers.l7_observability.audit import AuditLog

    pipeline, adapter, _ = build_pipeline()
    pipeline.audit = AuditLog(tmp_path / "audit.jsonl")
    bt = Backtester(pipeline, adapter, TrialRegistry(), strategy_name="funding_carry")
    asyncio.run(bt.run(build_events()))

    assert pipeline.audit.verify()
    kinds = {rec["kind"] for rec in pipeline.audit.read()}
    assert {"signal", "risk_decision", "order"} <= kinds


def test_fallback_limits_match_the_repository_file():
    """An installed package has no risk/limits.yaml on disk.

    The fallback must carry the same values, or a demo run behaves differently
    from a repository run and the demonstration stops demonstrating anything.
    """
    from tradesys.demo import _FALLBACK_LIMITS, default_limits
    from tradesys.layers.l5_risk.limits import LimitRegister
    from tests.conftest import LIMITS_PATH

    from_file = LimitRegister.from_yaml(LIMITS_PATH)
    from_fallback = LimitRegister.from_mapping(_FALLBACK_LIMITS)
    assert from_file.snapshot() == from_fallback.snapshot()
    assert default_limits().snapshot() == from_file.snapshot()
