"""The validation harness (SPEC section 11.2, report format in Annex C section 8).

This is where most well-funded trading projects fail. Not in the strategy, not
in the infrastructure - in the validation.

The harness has one design principle that matters more than any of its
statistics: **it distinguishes "failed" from "cannot say".** A strategy with
four trades does not have a Sharpe ratio, and reporting one is worse than
reporting nothing because it invites a decision. Every check can therefore
come back ``INCONCLUSIVE``, and an inconclusive result does not pass. The
common way to fool yourself here is to compute a number from too little data
and then treat the number as evidence because it exists.

The holdout is enforced technically rather than by discipline
(:class:`HoldoutStore`). Discipline that depends on remembering to be
disciplined is not discipline.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from ..core.types import Decimal as Dec, dec
from .registry import TrialRegistry
from .validation import (
    PERIODS_PER_YEAR,
    block_bootstrap_drawdown,
    bootstrap_expectancy_ci,
    deflated_sharpe,
    live_vs_backtest_z,
    max_drawdown,
    monte_carlo_drawdown,
    probability_of_backtest_overfitting,
    purged_kfold_splits,
    sharpe,
    time_to_significance_years,
)

__all__ = ["Verdict", "Check", "ValidationReport", "HoldoutStore",
           "HoldoutSpent", "ValidationHarness", "MIN_TRADES_FOR_A_VERDICT"]

#: Below this, a result is reported as inconclusive rather than as a number.
#: Thirty is the same floor SPEC section 11.2 item 5 puts on a regime.
MIN_TRADES_FOR_A_VERDICT = 30

#: Gates from SPEC section 11.2 and Annex F.
DSR_GATE = 0.95
PBO_GATE = 0.50
WALK_FORWARD_GATE = 0.70
COST_STRESS_MULTIPLE = 1.5


class Verdict:
    PASS = "PASS"
    FAIL = "FAIL"
    #: Not enough evidence to say either way. Does **not** pass.
    INCONCLUSIVE = "INCONCLUSIVE"


@dataclass(frozen=True)
class Check:
    name: str
    verdict: str
    detail: str
    value: Optional[float] = None

    @property
    def ok(self) -> bool:
        return self.verdict == Verdict.PASS

    def __str__(self) -> str:
        return f"[{self.verdict}] {self.name}: {self.detail}"


class HoldoutSpent(RuntimeError):
    """The holdout has already been read for this strategy.

    A second read is a process failure. The strategy that prompted it does not
    proceed, and the failure gets its own review (SPEC section 11.3).
    """


class HoldoutStore:
    """The most recent 20% of data, readable once, with every read logged.

    SPEC section 11.2 item 3: the holdout is touched once, at the final
    go/no-go. If a strategy fails on it, it is dead - you do not re-tune and
    re-test.

    Enforced here rather than trusted, and the access log lives in the trial
    registry so the evidence of a second read survives the researcher who made
    it.
    """

    def __init__(self, data: Sequence[Any], registry: TrialRegistry,
                 fraction: float = 0.2) -> None:
        if not 0 < fraction < 1:
            raise ValueError("holdout fraction must be between 0 and 1")
        split = int(len(data) * (1 - fraction))
        self._development = list(data[:split])
        self._holdout = list(data[split:])
        self.registry = registry

    @property
    def development(self) -> List[Any]:
        """Everything except the holdout. Free to use as often as you like."""
        return list(self._development)

    @property
    def holdout_size(self) -> int:
        return len(self._holdout)

    def read(self, strategy: str, who: str, why: str) -> List[Any]:
        """Read the holdout. Raises on the second attempt."""
        if self.registry.holdout_access_count(strategy) >= 1:
            self.registry.record_holdout_access(strategy, who, f"REFUSED SECOND READ: {why}")
            raise HoldoutSpent(
                f"the holdout for {strategy!r} has already been read. A second "
                "evaluation is a process failure: the strategy does not proceed, "
                "and the access log now records the attempt."
            )
        self.registry.record_holdout_access(strategy, who, why)
        return list(self._holdout)


@dataclass
class ValidationReport:
    """Annex C section 8, produced by the harness rather than written by hand."""

    strategy: str
    code_hash: str
    data_range: Tuple[str, str]
    trial_count: int
    trades: int
    checks: List[Check] = field(default_factory=list)
    holdout: Optional[Check] = None
    parameters: Mapping[str, Any] = field(default_factory=dict)

    def add(self, check: Check) -> None:
        self.checks.append(check)

    @property
    def failures(self) -> List[Check]:
        return [c for c in self.checks if c.verdict == Verdict.FAIL]

    @property
    def inconclusive(self) -> List[Check]:
        return [c for c in self.checks if c.verdict == Verdict.INCONCLUSIVE]

    @property
    def passes(self) -> bool:
        """True only when every check passes.

        Inconclusive is not a pass. A strategy nobody can measure is a strategy
        nobody should fund, and the whole purpose of the distinction is to stop
        an absence of evidence reading as evidence.
        """
        return bool(self.checks) and all(c.ok for c in self.checks)

    def render(self) -> str:
        width = max((len(c.name) for c in self.checks), default=10) + 2
        lines = [
            f"Validation report: {self.strategy}",
            f"  code hash    {self.code_hash}",
            f"  data range   {self.data_range[0]} to {self.data_range[1]}",
            f"  trial count  {self.trial_count}   (from the registry, not from memory)",
            f"  trades       {self.trades}",
            "",
        ]
        for c in self.checks:
            lines.append(f"  [{c.verdict:<12}] {c.name:<{width}} {c.detail}")
        if self.holdout is not None:
            lines.append("")
            lines.append(f"  [{self.holdout.verdict:<12}] {self.holdout.name:<{width}} "
                         f"{self.holdout.detail}")
        lines.append("")
        if self.passes:
            lines.append("  RESULT: PASS")
        elif self.failures:
            lines.append(f"  RESULT: FAIL ({len(self.failures)} failed, "
                         f"{len(self.inconclusive)} inconclusive)")
        else:
            lines.append(f"  RESULT: INCONCLUSIVE ({len(self.inconclusive)} checks "
                         "could not be evaluated on this much data)")
        return "\n".join(lines)


class ValidationHarness:
    """Runs the SPEC section 11.2 protocol and produces the report.

    ``run_backtest(events, parameters)`` must return an object exposing
    ``equity_curve``, ``fills`` and ``books`` - the harness is deliberately
    agnostic about how the backtest is wired, so the same protocol can be run
    against a different engine without rewriting the protocol.
    """

    def __init__(self, registry: TrialRegistry, run_backtest: Callable,
                 strategy: str, parameters: Optional[Mapping[str, Any]] = None,
                 code_hash: str = "unknown") -> None:
        self.registry = registry
        self.run_backtest = run_backtest
        self.strategy = strategy
        self.parameters = dict(parameters or {})
        self.code_hash = code_hash

    # ------------------------------------------------------------------

    def run(self, events: Sequence[Any], data_range: Tuple[str, str] = ("", ""),
            windows: int = 4, cost_multiple: float = COST_STRESS_MULTIPLE,
            parameter_sweep: Optional[Mapping[str, Sequence[Any]]] = None) -> ValidationReport:
        baseline = self.run_backtest(events, self.parameters)
        returns = _returns(baseline.equity_curve)
        trades = int(getattr(baseline, "fills", 0) or 0)

        report = ValidationReport(
            strategy=self.strategy, code_hash=self.code_hash,
            data_range=data_range, trial_count=self.registry.count(self.strategy),
            trades=trades, parameters=self.parameters,
        )

        report.add(self._check_sample_size(trades))
        report.add(self._check_walk_forward(events, windows))
        report.add(self._check_purged_cv(events))
        report.add(self._check_deflated_sharpe(returns, trades))
        report.add(self._check_pbo(events, parameter_sweep))
        report.add(self._check_monte_carlo(returns, trades))
        report.add(self._check_expectancy(returns, trades))
        report.add(self._check_cost_sensitivity(events, cost_multiple))
        report.add(self._check_parameter_sensitivity(events, parameter_sweep))
        report.add(self._check_loss_month(returns))
        report.add(self._check_time_to_significance(returns, trades))
        return report

    # ------------------------------------------------------------------
    # Individual checks
    # ------------------------------------------------------------------

    def _check_sample_size(self, trades: int) -> Check:
        if trades >= MIN_TRADES_FOR_A_VERDICT:
            return Check("sample_size", Verdict.PASS, f"{trades} trades", float(trades))
        return Check(
            "sample_size", Verdict.INCONCLUSIVE,
            f"{trades} trades, below the floor of {MIN_TRADES_FOR_A_VERDICT}. "
            "Every statistic below inherits this: a number computed from this "
            "sample is not evidence.",
            float(trades),
        )

    def _check_walk_forward(self, events: Sequence[Any], windows: int) -> Check:
        if windows < 2 or len(events) < windows * 2:
            return Check("walk_forward", Verdict.INCONCLUSIVE,
                         "not enough data to split into windows")
        size = len(events) // windows
        positive = 0
        evaluated = 0
        for i in range(1, windows):
            window = events[i * size:(i + 1) * size]
            if not window:
                continue
            result = self.run_backtest(window, self.parameters)
            rets = _returns(result.equity_curve)
            if not rets or all(r == 0 for r in rets):
                continue
            evaluated += 1
            if sum(rets) > 0:
                positive += 1
        if evaluated == 0:
            return Check("walk_forward", Verdict.INCONCLUSIVE,
                         "no out-of-sample window produced a trade")
        share = positive / evaluated
        verdict = Verdict.PASS if share >= WALK_FORWARD_GATE else Verdict.FAIL
        return Check("walk_forward", verdict,
                     f"positive in {positive}/{evaluated} out-of-sample windows "
                     f"(gate {WALK_FORWARD_GATE:.0%})", share)

    def _check_purged_cv(self, events: Sequence[Any]) -> Check:
        """Confirms the split is purged and embargoed, not that it is profitable.

        Getting the split right is a precondition for every other number, and
        it is checked separately because a leaking split makes a profitable
        result meaningless rather than wrong-looking.
        """
        n = len(events)
        if n < 20:
            return Check("purged_cv", Verdict.INCONCLUSIVE, "sample too small to fold")
        purge = max(1, n // 50)
        embargo = max(1, n // 100)
        leaked = 0
        for train, test in purged_kfold_splits(n, n_folds=5, purge=purge, embargo=embargo):
            lo, hi = min(test), max(test)
            leaked += sum(1 for i in train if lo - purge <= i <= hi + purge + embargo)
        verdict = Verdict.PASS if leaked == 0 else Verdict.FAIL
        return Check("purged_cv", verdict,
                     f"purge={purge}, embargo={embargo}, {leaked} leaking samples",
                     float(leaked))

    def _check_deflated_sharpe(self, returns: Sequence[float], trades: int) -> Check:
        trial_count = max(1, self.registry.count(self.strategy))
        if len(returns) < 2 or trades < MIN_TRADES_FOR_A_VERDICT:
            return Check("deflated_sharpe", Verdict.INCONCLUSIVE,
                         f"needs {MIN_TRADES_FOR_A_VERDICT} trades; "
                         f"trial count would be {trial_count}")
        per_period = sharpe(returns, periods_per_year=1)
        if not math.isfinite(per_period):
            return Check("deflated_sharpe", Verdict.INCONCLUSIVE,
                         "return series has no variance, so Sharpe is undefined")
        variance = _variance_of_trial_sharpes(self.registry, self.strategy)
        dsr = deflated_sharpe(per_period, len(returns), trial_count, variance,
                              skew=_skew(returns), kurtosis=_kurtosis(returns))
        verdict = Verdict.PASS if dsr > DSR_GATE else Verdict.FAIL
        return Check("deflated_sharpe", verdict,
                     f"DSR {dsr:.4f} over {trial_count} trials (gate {DSR_GATE})", dsr)

    def _check_pbo(self, events, sweep) -> Check:
        if not sweep:
            return Check("probability_of_overfitting", Verdict.INCONCLUSIVE,
                         "no parameter sweep supplied; PBO needs competing configurations")
        configs = _expand(sweep)
        if len(configs) < 2:
            return Check("probability_of_overfitting", Verdict.INCONCLUSIVE,
                         "need at least two configurations")
        blocks = 8
        size = max(1, len(events) // blocks)
        matrix = []
        for cfg in configs:
            row = []
            for b in range(blocks):
                chunk = events[b * size:(b + 1) * size]
                result = self.run_backtest(chunk, {**self.parameters, **cfg})
                row.append(sum(_returns(result.equity_curve)))
            matrix.append(row)
        if all(all(v == 0 for v in row) for row in matrix):
            return Check("probability_of_overfitting", Verdict.INCONCLUSIVE,
                         "no configuration traded in any block")
        pbo = probability_of_backtest_overfitting(matrix, n_splits=blocks)
        verdict = Verdict.PASS if pbo < PBO_GATE else Verdict.FAIL
        return Check("probability_of_overfitting", verdict,
                     f"PBO {pbo:.3f} over {len(configs)} configurations "
                     f"(gate below {PBO_GATE})", pbo)

    def _check_monte_carlo(self, returns: Sequence[float], trades: int) -> Check:
        if trades < MIN_TRADES_FOR_A_VERDICT or len(returns) < 2:
            return Check("monte_carlo", Verdict.INCONCLUSIVE,
                         "too few trades to resample meaningfully")
        mc = monte_carlo_drawdown(list(returns), iterations=2000)
        blocked = block_bootstrap_drawdown(list(returns), block=10, iterations=2000)
        clustered = blocked > mc.drawdown_p5 * 1.2
        detail = (f"5th-pct drawdown {mc.drawdown_p5:.2%} vs observed "
                  f"{mc.observed_drawdown:.2%}; block bootstrap {blocked:.2%}")
        if clustered:
            detail += ". Losses cluster, so size against the block figure."
        return Check("monte_carlo", Verdict.PASS, detail, mc.drawdown_p5)

    def _check_expectancy(self, returns: Sequence[float], trades: int) -> Check:
        if trades < MIN_TRADES_FOR_A_VERDICT or len(returns) < 2:
            return Check("expectancy", Verdict.INCONCLUSIVE, "too few trades")
        lo, point, hi = bootstrap_expectancy_ci(list(returns), iterations=2000)
        verdict = Verdict.PASS if lo > 0 else Verdict.FAIL
        return Check("expectancy", verdict,
                     f"point {point:.5f}, 95% CI [{lo:.5f}, {hi:.5f}]. "
                     "Scaling needs the lower bound above zero.", lo)

    def _check_cost_sensitivity(self, events, multiple: float) -> Check:
        """A strategy that dies at 1.5x costs is one fee-tier change from dead."""
        stressed = self.run_backtest(events, self.parameters, cost_multiple=multiple)
        total = sum(_returns(stressed.equity_curve))
        if total == 0:
            return Check("cost_sensitivity", Verdict.INCONCLUSIVE,
                         f"no return at {multiple}x costs; nothing traded")
        verdict = Verdict.PASS if total > 0 else Verdict.FAIL
        return Check("cost_sensitivity", verdict,
                     f"return at {multiple}x modelled costs: {total:.4%}", total)

    def _check_parameter_sensitivity(self, events, sweep) -> Check:
        if not sweep:
            return Check("parameter_sensitivity", Verdict.INCONCLUSIVE,
                         "no parameter sweep supplied")
        configs = _expand(sweep)
        scores = []
        for cfg in configs:
            result = self.run_backtest(events, {**self.parameters, **cfg})
            scores.append(sum(_returns(result.equity_curve)))
        peak = max(scores) if scores else 0.0
        if peak <= 0:
            return Check("parameter_sensitivity", Verdict.INCONCLUSIVE,
                         "no configuration was profitable")
        plateau = sum(1 for s in scores if s >= 0.8 * peak) / len(scores)
        verdict = Verdict.PASS if plateau >= 0.30 else Verdict.FAIL
        return Check("parameter_sensitivity", verdict,
                     f"{plateau:.0%} of the surface within 80% of peak "
                     "(a narrow spike is overfitting; robust strategies sit on "
                     "broad plateaus)", plateau)

    def _check_loss_month(self, returns: Sequence[float]) -> Check:
        """The rule that generalises where a Sharpe ceiling does not.

        A backtest with no losing month over multiple years has almost
        certainly been fitted to the sample, whatever its Sharpe.
        """
        if len(returns) < 30:
            return Check("contains_a_losing_period", Verdict.INCONCLUSIVE,
                         "sample shorter than one notional month")
        size = max(1, len(returns) // 12)
        months = [sum(returns[i:i + size]) for i in range(0, len(returns), size)]
        losers = sum(1 for m in months if m < 0)
        if losers == 0:
            return Check("contains_a_losing_period", Verdict.FAIL,
                         f"no losing period in {len(months)}. A backtest without "
                         "one has almost certainly been fitted to the sample.",
                         0.0)
        return Check("contains_a_losing_period", Verdict.PASS,
                     f"{losers} losing periods of {len(months)}", float(losers))

    def _check_time_to_significance(self, returns: Sequence[float], trades: int) -> Check:
        """Not a gate. A statement of how long a verdict would actually take."""
        if trades < MIN_TRADES_FOR_A_VERDICT or len(returns) < 2:
            return Check("time_to_significance", Verdict.INCONCLUSIVE,
                         "no Sharpe to reason about yet")
        annual = sharpe(returns, PERIODS_PER_YEAR)
        if not math.isfinite(annual) or annual <= 0:
            return Check("time_to_significance", Verdict.INCONCLUSIVE,
                         "Sharpe is not positive and finite")
        years = time_to_significance_years(annual)
        return Check("time_to_significance", Verdict.PASS,
                     f"at Sharpe {annual:.2f}, distinguishing it from zero takes "
                     f"{years:.1f} years. Read this before any conclusion from "
                     "live results.", years)

    # ------------------------------------------------------------------

    def evaluate_holdout(self, store: HoldoutStore, who: str,
                         why: str = "final go/no-go") -> Check:
        """Read the holdout once and record the result.

        Called separately from :meth:`run` so it cannot happen by accident as
        part of a routine validation pass.
        """
        try:
            events = store.read(self.strategy, who, why)
        except HoldoutSpent as e:
            return Check("holdout", Verdict.FAIL, str(e))
        if not events:
            return Check("holdout", Verdict.INCONCLUSIVE, "holdout is empty")
        result = self.run_backtest(events, self.parameters)
        total = sum(_returns(result.equity_curve))
        fills = int(getattr(result, "fills", 0) or 0)
        if fills == 0:
            return Check("holdout", Verdict.INCONCLUSIVE,
                         "no trades in the holdout window. Read once and spent.")
        verdict = Verdict.PASS if total > 0 else Verdict.FAIL
        return Check("holdout", verdict,
                     f"{total:.4%} over {fills} trades, read once by {who}", total)


# ----------------------------------------------------------------------
# Helpers
# ----------------------------------------------------------------------


def _returns(curve: Sequence[float]) -> List[float]:
    return [(b - a) / a for a, b in zip(curve, curve[1:]) if a]


def _variance_of_trial_sharpes(registry: TrialRegistry, strategy: str) -> float:
    """Spread of Sharpe across trials, for the deflated Sharpe null.

    Falls back to 1.0 when there are too few recorded trials. That is the
    conservative direction: a larger assumed variance raises the expected
    maximum under the null and therefore lowers the deflated Sharpe.
    """
    values = [s for s in registry.sharpes(strategy) if math.isfinite(s)]
    if len(values) < 3:
        return 1.0
    mean = sum(values) / len(values)
    return sum((v - mean) ** 2 for v in values) / (len(values) - 1) or 1.0


def _skew(returns: Sequence[float]) -> float:
    n = len(returns)
    if n < 3:
        return 0.0
    mean = sum(returns) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in returns) / n)
    if sd == 0:
        return 0.0
    return sum(((r - mean) / sd) ** 3 for r in returns) / n


def _kurtosis(returns: Sequence[float]) -> float:
    n = len(returns)
    if n < 4:
        return 3.0
    mean = sum(returns) / n
    sd = math.sqrt(sum((r - mean) ** 2 for r in returns) / n)
    if sd == 0:
        return 3.0
    return sum(((r - mean) / sd) ** 4 for r in returns) / n


def _expand(sweep: Mapping[str, Sequence[Any]]) -> List[Dict[str, Any]]:
    """Cartesian product of a parameter sweep."""
    import itertools

    keys = sorted(sweep)
    return [dict(zip(keys, combo)) for combo in itertools.product(*(sweep[k] for k in keys))]
