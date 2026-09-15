"""The validation harness (SPEC section 11.2, Annex C section 8).

A fake runner is used for most of these, so the PASS and FAIL branches are
exercised on curves chosen to trigger them. Testing the protocol only against
the demo strategy would leave every branch except INCONCLUSIVE uncovered,
which is exactly the coverage gap a harness like this must not have.
"""

from __future__ import annotations

import random
from dataclasses import dataclass, field
from typing import Any, List, Mapping, Optional, Sequence

import pytest

from tradesys.core.types import dec
from tradesys.research.harness import (
    DSR_GATE, MIN_TRADES_FOR_A_VERDICT, Check, HoldoutSpent, HoldoutStore,
    ValidationHarness, ValidationReport, Verdict,
)
from tradesys.research.registry import TrialRegistry


@dataclass
class FakeResult:
    equity_curve: List[float]
    fills: int
    books: Any = None


def runner_from(curve_for):
    """Build a runner whose result depends on the slice it is given."""
    def run(events, parameters=None, cost_multiple=1.0):
        return curve_for(list(events), parameters or {}, cost_multiple)
    return run


def growing(n=200, drift=0.002, seed=5, trades=None):
    rng = random.Random(seed)
    curve = [100.0]
    for _ in range(n):
        curve.append(curve[-1] * (1 + drift + rng.gauss(0, 0.004)))
    return FakeResult(curve, trades if trades is not None else n)


def flat(n=200):
    return FakeResult([100.0] * (n + 1), 0)


def harness(run, registry=None, strategy="demo"):
    return ValidationHarness(registry or TrialRegistry(), run, strategy, code_hash="h")


EVENTS = list(range(400))


# --------------------------------------------------------------- honesty


def test_too_few_trades_is_inconclusive_not_a_verdict():
    """A strategy with four trades does not have a Sharpe ratio."""
    h = harness(runner_from(lambda e, p, c: FakeResult([100.0, 101.0, 102.0], 4)))
    report = h.run(EVENTS)
    sample = next(c for c in report.checks if c.name == "sample_size")
    assert sample.verdict == Verdict.INCONCLUSIVE
    assert "not evidence" in sample.detail


def test_inconclusive_does_not_pass():
    """An absence of evidence must not read as evidence."""
    report = harness(runner_from(lambda e, p, c: flat())).run(EVENTS)
    assert not report.passes
    assert report.inconclusive


def test_a_report_with_no_checks_does_not_pass():
    assert not ValidationReport("s", "h", ("", ""), 0, 0).passes


def test_the_report_distinguishes_failed_from_unmeasurable():
    report = harness(runner_from(lambda e, p, c: flat())).run(EVENTS)
    rendered = report.render()
    assert "INCONCLUSIVE" in rendered
    assert "RESULT:" in rendered


# ------------------------------------------------------------- the gates


def test_a_backtest_with_no_losing_period_fails():
    """The rule that generalises where a Sharpe ceiling does not."""
    h = harness(runner_from(lambda e, p, c: FakeResult(
        [100.0 * (1.01 ** i) for i in range(60)], 60)))
    report = h.run(EVENTS)
    check = next(c for c in report.checks if c.name == "contains_a_losing_period")
    assert check.verdict == Verdict.FAIL
    assert "fitted to the sample" in check.detail


def test_a_realistic_curve_has_losing_periods():
    report = harness(runner_from(lambda e, p, c: growing())).run(EVENTS)
    check = next(c for c in report.checks if c.name == "contains_a_losing_period")
    assert check.verdict == Verdict.PASS


def test_purged_cv_confirms_the_split_does_not_leak():
    report = harness(runner_from(lambda e, p, c: growing())).run(EVENTS)
    check = next(c for c in report.checks if c.name == "purged_cv")
    assert check.verdict == Verdict.PASS
    assert check.value == 0


def test_expectancy_needs_the_lower_bound_above_zero():
    """A point estimate above zero with a lower bound below it is not an edge."""
    noisy = [100.0]
    for i in range(120):
        noisy.append(noisy[-1] * (1.05 if i % 2 else 0.9525))
    h = harness(runner_from(lambda e, p, c: FakeResult(noisy, 120)))
    check = next(c for c in h.run(EVENTS).checks if c.name == "expectancy")
    assert check.verdict in (Verdict.PASS, Verdict.FAIL)
    assert "lower bound above zero" in check.detail


def test_cost_sensitivity_uses_the_stressed_run():
    """A strategy that dies at 1.5x costs is one fee-tier change from dead."""
    seen = {}

    def run(events, parameters=None, cost_multiple=1.0):
        seen["multiple"] = max(seen.get("multiple", 0), cost_multiple)
        return growing(drift=0.002 if cost_multiple == 1.0 else -0.002)

    check = next(c for c in harness(run).run(EVENTS).checks if c.name == "cost_sensitivity")
    assert seen["multiple"] == 1.5
    assert check.verdict == Verdict.FAIL


def test_cost_sensitivity_passes_when_the_edge_survives():
    check = next(c for c in harness(runner_from(lambda e, p, c: growing())).run(EVENTS).checks
                 if c.name == "cost_sensitivity")
    assert check.verdict == Verdict.PASS


def test_parameter_sensitivity_fails_on_a_narrow_spike():
    """A narrow profitable spike is overfitting; robust strategies sit on plateaus."""
    def run(events, parameters=None, cost_multiple=1.0):
        entry = (parameters or {}).get("entry_z")
        return growing(drift=0.01 if entry == dec("1.5") else -0.01)

    sweep = {"entry_z": [dec(str(x)) for x in ("0.5", "1.0", "1.5", "2.0", "2.5", "3.0")]}
    check = next(c for c in harness(run).run(EVENTS, parameter_sweep=sweep).checks
                 if c.name == "parameter_sensitivity")
    assert check.verdict == Verdict.FAIL
    assert check.value is not None and check.value < 0.30


def test_parameter_sensitivity_passes_on_a_broad_plateau():
    def run(events, parameters=None, cost_multiple=1.0):
        return growing(drift=0.01)

    sweep = {"entry_z": [dec(str(x)) for x in ("0.5", "1.0", "1.5", "2.0")]}
    check = next(c for c in harness(run).run(EVENTS, parameter_sweep=sweep).checks
                 if c.name == "parameter_sensitivity")
    assert check.verdict == Verdict.PASS


def test_walk_forward_counts_positive_out_of_sample_windows():
    report = harness(runner_from(lambda e, p, c: growing(drift=0.003))).run(EVENTS, windows=4)
    check = next(c for c in report.checks if c.name == "walk_forward")
    assert check.verdict == Verdict.PASS
    assert "out-of-sample windows" in check.detail


def test_walk_forward_fails_when_most_windows_lose():
    report = harness(runner_from(lambda e, p, c: growing(drift=-0.003))).run(EVENTS, windows=4)
    check = next(c for c in report.checks if c.name == "walk_forward")
    assert check.verdict == Verdict.FAIL


def test_deflated_sharpe_uses_the_registry_trial_count():
    """Not the remembered count. Self-reported counts are consistently low."""
    registry = TrialRegistry()
    for _ in range(400):
        tid = registry.start("demo", "h", {}, "a", "b")
        registry.finish(tid, sharpe=random.Random(tid).gauss(0, 1))

    h = harness(runner_from(lambda e, p, c: growing(drift=0.001)), registry)
    check = next(c for c in h.run(EVENTS).checks if c.name == "deflated_sharpe")
    assert "400" in check.detail or "trials" in check.detail


def test_time_to_significance_is_reported_not_gated():
    report = harness(runner_from(lambda e, p, c: growing())).run(EVENTS)
    check = next(c for c in report.checks if c.name == "time_to_significance")
    assert check.verdict == Verdict.PASS
    assert "years" in check.detail


def test_monte_carlo_reports_the_fifth_percentile():
    report = harness(runner_from(lambda e, p, c: growing())).run(EVENTS)
    check = next(c for c in report.checks if c.name == "monte_carlo")
    assert "5th-pct drawdown" in check.detail


# --------------------------------------------------------------- holdout


def test_the_holdout_is_the_most_recent_slice():
    store = HoldoutStore(list(range(100)), TrialRegistry(), fraction=0.2)
    assert store.development == list(range(80))
    assert store.holdout_size == 20


def test_the_holdout_can_be_read_once():
    registry = TrialRegistry()
    store = HoldoutStore(list(range(100)), registry, fraction=0.2)
    assert store.read("demo", "sam", "final go/no-go") == list(range(80, 100))
    with pytest.raises(HoldoutSpent, match="already been read"):
        store.read("demo", "sam", "one more look")


def test_a_refused_second_read_is_still_logged():
    """The evidence must survive the researcher who made the attempt."""
    registry = TrialRegistry()
    store = HoldoutStore(list(range(100)), registry, fraction=0.2)
    store.read("demo", "sam", "go/no-go")
    with pytest.raises(HoldoutSpent):
        store.read("demo", "sam", "again")
    assert registry.holdout_access_count("demo") == 2
    assert registry.holdout_reused("demo")


def test_evaluating_a_spent_holdout_fails_rather_than_raising():
    registry = TrialRegistry()
    store = HoldoutStore(list(range(200)), registry, fraction=0.2)
    h = harness(runner_from(lambda e, p, c: growing()), registry)
    first = h.evaluate_holdout(store, "sam")
    assert first.verdict in (Verdict.PASS, Verdict.FAIL)
    second = h.evaluate_holdout(store, "sam")
    assert second.verdict == Verdict.FAIL
    assert "process failure" in second.detail


def test_holdout_fraction_must_be_sensible():
    with pytest.raises(ValueError):
        HoldoutStore([1, 2, 3], TrialRegistry(), fraction=0.0)


def test_running_validation_does_not_touch_the_holdout():
    """It is read once, deliberately, and never as part of a routine pass."""
    registry = TrialRegistry()
    store = HoldoutStore(EVENTS, registry, fraction=0.2)
    h = harness(runner_from(lambda e, p, c: growing()), registry)
    h.run(store.development)
    assert registry.holdout_access_count("demo") == 0


# ------------------------------------------------- against the real thing


def test_the_demo_strategy_is_honestly_reported_as_unvalidated():
    """Forty-five synthetic periods cannot validate anything, and it says so."""
    from tradesys.demo import build_events, make_backtest_runner

    registry = TrialRegistry()
    store = HoldoutStore(build_events(), registry, fraction=0.2)
    h = ValidationHarness(registry, make_backtest_runner(registry),
                          "funding_carry", code_hash="demo")
    report = h.run(store.development, ("synthetic", "synthetic"))

    assert not report.passes
    assert report.inconclusive, "a 45-period scenario should not produce verdicts"


def test_every_harness_run_registers_its_trials():
    from tradesys.demo import build_events, make_backtest_runner

    registry = TrialRegistry()
    h = ValidationHarness(registry, make_backtest_runner(registry), "funding_carry")
    h.run(build_events()[:200])
    assert registry.count("funding_carry") > 1, (
        "sweep and window runs are trials too; deflated Sharpe divides by them"
    )
