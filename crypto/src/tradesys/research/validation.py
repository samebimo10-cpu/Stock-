"""Validation arithmetic (Annex C).

v1.0 of the specification names these procedures and gives no formulas, which
means each team implements a different thing under the same name.

Floats throughout, deliberately. These are statistics, not money: the
precision that matters here is in the sample size, not in the twentieth
decimal place, and ``NormalDist`` needs floats anyway. Money stays Decimal
everywhere else in the system.
"""

from __future__ import annotations

import math
import random
from dataclasses import dataclass
from statistics import NormalDist
from typing import Iterator, List, Optional, Sequence, Tuple

__all__ = [
    "sharpe", "max_drawdown", "expected_max_sharpe", "deflated_sharpe",
    "probability_of_backtest_overfitting", "purged_kfold_splits",
    "monte_carlo_drawdown", "block_bootstrap_drawdown", "live_vs_backtest_z",
    "time_to_significance_years", "bootstrap_expectancy_ci", "MonteCarloResult",
    "PERIODS_PER_YEAR",
]

_N = NormalDist()
_EULER_MASCHERONI = 0.5772156649015329

#: Crypto trades every day. Using 252 overstates Sharpe by about 20%.
PERIODS_PER_YEAR = 365


def sharpe(returns: Sequence[float], periods_per_year: int = PERIODS_PER_YEAR,
           risk_free: float = 0.0) -> float:
    """Annualised Sharpe from periodic returns.

    A constant return series has no variance, so its Sharpe is unbounded.
    That is arithmetic rather than an achievement: it means the sample carries
    no information about risk, which is the opposite of a good result.

    >>> round(sharpe([0.001, -0.0005] * 180, 365), 4)
    6.3595
    """
    if len(returns) < 2:
        return 0.0
    excess = [r - risk_free / periods_per_year for r in returns]
    mean = sum(excess) / len(excess)
    var = sum((r - mean) ** 2 for r in excess) / (len(excess) - 1)
    if var <= 0:
        return math.inf if mean > 0 else 0.0
    return mean / math.sqrt(var) * math.sqrt(periods_per_year)


def max_drawdown(equity: Sequence[float]) -> float:
    """Peak-to-trough fraction of an equity curve.

    Sampled at whatever frequency the curve is given. Daily closes
    systematically understate drawdown, which is why SPEC section 1.2 measures
    hourly.
    """
    peak = -math.inf
    worst = 0.0
    for value in equity:
        peak = max(peak, value)
        if peak > 0:
            worst = max(worst, (peak - value) / peak)
    return worst


# --------------------------------------------------------------------------
# Deflated Sharpe (Annex C section 2)
# --------------------------------------------------------------------------


def expected_max_sharpe(n_trials: int, variance_of_trial_sharpes: float) -> float:
    """Expected maximum Sharpe under the null, across ``n_trials``.

    After N trials the best observed Sharpe is high *by construction*, even
    when every strategy is worthless. "Our best of 500 backtests has Sharpe
    2.0" is a statement about 500, not about the strategy.

    >>> round(expected_max_sharpe(100, 1.0), 3)
    2.531
    """
    if n_trials < 2 or variance_of_trial_sharpes <= 0:
        return 0.0
    g = _EULER_MASCHERONI
    a = _N.inv_cdf(1.0 - 1.0 / n_trials)
    b = _N.inv_cdf(1.0 - 1.0 / (n_trials * math.e))
    return math.sqrt(variance_of_trial_sharpes) * ((1 - g) * a + g * b)


def deflated_sharpe(observed_sharpe: float, n_observations: int, n_trials: int,
                    variance_of_trial_sharpes: float, skew: float = 0.0,
                    kurtosis: float = 3.0) -> float:
    """Probability the true Sharpe exceeds zero, given the trial count.

    The skew and kurtosis terms are not decoration. A strategy with negative
    skew and fat tails - which describes carry, market making, and everything
    that earns steadily and loses suddenly - is penalised, correctly, because
    its Sharpe is a worse estimate of its future than a symmetric strategy's.

    **Gate: DSR > 0.95 before a strategy proceeds to paper trading.**

    Sharpe values here are per-observation, not annualised: mixing the two is
    the easiest way to get a confidently wrong answer out of this function.

    One property that looks like a bug and is not: the skew and kurtosis
    penalty only *reduces* DSR when ``observed_sharpe`` exceeds ``SR0``. Below
    that the numerator is negative and a larger denominator pulls the score
    back toward 0.5. That is correct - a strategy scoring below the expected
    maximum under the null has already failed the test, and how fat its tails
    are no longer changes the conclusion. Do not "fix" the sign.
    """
    if n_observations < 2:
        return 0.0
    sr0 = expected_max_sharpe(n_trials, variance_of_trial_sharpes)
    denom_sq = 1.0 - skew * observed_sharpe + ((kurtosis - 1.0) / 4.0) * observed_sharpe ** 2
    if denom_sq <= 0:
        return 0.0
    z = (observed_sharpe - sr0) * math.sqrt(n_observations - 1) / math.sqrt(denom_sq)
    return _N.cdf(z)


def probability_of_backtest_overfitting(
    performance_matrix: Sequence[Sequence[float]], n_splits: int = 16
) -> float:
    """PBO via combinatorially symmetric cross-validation.

    ``performance_matrix`` is configurations x time blocks. Returns the
    probability that the in-sample-best configuration ranks below median out
    of sample.

    **PBO above 0.5 means the selection procedure is worse than choosing at
    random.** Report it alongside DSR: they catch different failures, and a
    strategy passing DSR while failing PBO is one whose whole parameter family
    is noise.
    """
    import itertools

    if not performance_matrix or not performance_matrix[0]:
        return 0.0
    n_configs = len(performance_matrix)
    n_blocks = len(performance_matrix[0])
    s = min(n_splits, n_blocks)
    if s < 2 or n_configs < 2:
        return 0.0
    if s % 2:
        s -= 1
    blocks = list(range(s))

    below_median = 0
    total = 0
    for train in itertools.combinations(blocks, s // 2):
        test = [b for b in blocks if b not in train]
        is_perf = [sum(performance_matrix[c][b] for b in train) for c in range(n_configs)]
        best = max(range(n_configs), key=lambda c: is_perf[c])
        oos = [sum(performance_matrix[c][b] for b in test) for c in range(n_configs)]
        rank = sorted(range(n_configs), key=lambda c: oos[c]).index(best)
        relative = rank / (n_configs - 1)
        total += 1
        if relative < 0.5:
            below_median += 1
    return below_median / total if total else 0.0


# --------------------------------------------------------------------------
# Purged K-fold with embargo (Annex C section 3)
# --------------------------------------------------------------------------


def purged_kfold_splits(n_samples: int, n_folds: int = 5, purge: int = 0,
                        embargo: int = 0) -> Iterator[Tuple[List[int], List[int]]]:
    """Yield (train, test) index lists with purging and embargo.

    Standard cross-validation leaks in time series because a sample's label
    depends on data overlapping the neighbouring folds. Purge removes training
    samples whose evaluation window overlaps the test set; embargo excludes a
    further window after it, because serial correlation means the sample
    immediately after the test fold still carries information from it.

    Without both, a strategy holding positions for four hours, evaluated on
    hourly data, sees roughly four hours of its own test-set outcomes inside
    the training set - enough to produce a convincing and entirely fictitious
    result.
    """
    if n_folds < 2:
        raise ValueError("need at least 2 folds")
    fold_size = n_samples // n_folds
    for k in range(n_folds):
        start = k * fold_size
        stop = n_samples if k == n_folds - 1 else (k + 1) * fold_size
        test = list(range(start, stop))
        blocked_lo = max(0, start - purge)
        blocked_hi = min(n_samples, stop + purge + embargo)
        train = [i for i in range(n_samples) if i < blocked_lo or i >= blocked_hi]
        yield train, test


# --------------------------------------------------------------------------
# Monte Carlo (Annex C section 6)
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class MonteCarloResult:
    drawdown_p5: float
    return_p5: float
    drawdown_median: float
    observed_drawdown: float

    @property
    def observed_is_lucky(self) -> bool:
        """True when the realised path was better than the 5th percentile.

        Usually true, and that is the point: the observed path was lucky in
        ways you cannot count on.
        """
        return self.observed_drawdown < self.drawdown_p5


def _equity(trades: Sequence[float], start: float = 1.0) -> List[float]:
    equity = [start]
    for t in trades:
        equity.append(equity[-1] + t)
    return equity


def monte_carlo_drawdown(trades: Sequence[float], iterations: int = 10_000,
                         seed: int = 7) -> MonteCarloResult:
    """Reshuffle trade order and report the 5th-percentile drawdown.

    Size against that number, not against the observed one: the realised
    ordering is one draw from many equally real ones.
    """
    if not trades:
        raise ValueError("no trades to resample")
    rng = random.Random(seed)
    order = list(trades)
    dds: List[float] = []
    rets: List[float] = []
    for _ in range(iterations):
        rng.shuffle(order)
        eq = _equity(order)
        dds.append(max_drawdown(eq))
        rets.append(eq[-1] - eq[0])
    dds.sort()
    rets.sort()
    p5 = int(0.95 * len(dds))          # 95th percentile of drawdown = 5th pct of outcome
    return MonteCarloResult(
        drawdown_p5=dds[min(p5, len(dds) - 1)],
        return_p5=rets[int(0.05 * len(rets))],
        drawdown_median=dds[len(dds) // 2],
        observed_drawdown=max_drawdown(_equity(trades)),
    )


def block_bootstrap_drawdown(trades: Sequence[float], block: int = 10,
                             iterations: int = 10_000, seed: int = 7) -> float:
    """5th-percentile drawdown preserving serial correlation.

    Plain shuffling destroys serial correlation, and serial correlation is
    exactly what produces the bad runs that matter. If this number is much
    worse than :func:`monte_carlo_drawdown`'s, the strategy's losses cluster -
    which changes how it must be sized, and is invisible in the observed
    equity curve.
    """
    if not trades:
        raise ValueError("no trades to resample")
    rng = random.Random(seed)
    n = len(trades)
    dds: List[float] = []
    for _ in range(iterations):
        path: List[float] = []
        while len(path) < n:
            start = rng.randrange(n)
            path.extend(trades[start:start + block])
        dds.append(max_drawdown(_equity(path[:n])))
    dds.sort()
    return dds[min(int(0.95 * len(dds)), len(dds) - 1)]


# --------------------------------------------------------------------------
# Live vs backtest, and power (Annex C sections 4-5)
# --------------------------------------------------------------------------


def _sharpe_variance(sr: float, n: int) -> float:
    return (1.0 + sr * sr / 2.0) / n if n > 0 else math.inf


def live_vs_backtest_z(live_sharpe: float, live_n: int,
                       backtest_sharpe: float, backtest_n: int) -> float:
    """z-statistic for the difference between live and backtest Sharpe.

    **The gate is one-sided.** Live outperforming backtest is not evidence of
    health - it usually means a cost is unmodelled and is currently helping.
    Flag both directions; gate on the downside at z < -2.0.

    This is the honest Phase 4 gate: not "is live Sharpe above 1.5", which 90
    days cannot answer, but "is live Sharpe inconsistent with the backtest",
    which it can.
    """
    var = _sharpe_variance(live_sharpe, live_n) + _sharpe_variance(backtest_sharpe, backtest_n)
    if var <= 0:
        return 0.0
    return (live_sharpe - backtest_sharpe) / math.sqrt(var)


def time_to_significance_years(true_sharpe: float, confidence: float = 0.95) -> float:
    """How long until an observed Sharpe can be distinguished from zero.

    ``T = (z / SR)^2``. At the SPEC section 1.2 minimum Sharpe of 1.5 the
    answer is about 1.7 years. At 90 days the t-statistic is around 0.75, and
    the observed Sharpe could plausibly land anywhere from -1 to +4 with the
    strategy unchanged.

    Read this before every conclusion drawn from live results. A good quarter
    is not evidence and a bad quarter is not evidence.

    >>> round(time_to_significance_years(1.5), 2)
    1.71
    """
    if true_sharpe <= 0:
        return math.inf
    z = _N.inv_cdf(1.0 - (1.0 - confidence) / 2.0)
    return (z / true_sharpe) ** 2


def bootstrap_expectancy_ci(trades: Sequence[float], iterations: int = 10_000,
                            seed: int = 7) -> Tuple[float, float, float]:
    """Bootstrap CI for per-trade expectancy. Returns (lower, point, upper).

    **Scaling requires the lower bound above zero**, not the point estimate. A
    point estimate above zero with a lower bound below it describes a strategy
    that has not yet demonstrated an edge.
    """
    if not trades:
        raise ValueError("no trades")
    rng = random.Random(seed)
    n = len(trades)
    point = sum(trades) / n
    means: List[float] = []
    for _ in range(iterations):
        sample = [trades[rng.randrange(n)] for _ in range(n)]
        means.append(sum(sample) / n)
    means.sort()
    return means[int(0.025 * len(means))], point, means[int(0.975 * len(means))]
