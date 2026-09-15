"""Risk-parity allocation (SPEC section 7.1, Annex B section 6).

Allocate so each strategy contributes an equal share of portfolio risk, not
equal capital.

Solved by the standard fixed-point iteration rather than a convex solver,
because adding SciPy to the trading system's dependency list to allocate
across at most ten strategies is a poor trade.

The fixed point falls straight out of the condition. At equal risk
contribution ``w_i * MRC_i`` is the same for every strategy, so
``w_i`` is proportional to ``1 / MRC_i``. Iterating that, with damping,
converges in tens of iterations on problems this size.

Turnover control is a deadband rather than a penalty term: if the proposed
reallocation moves less than ``turnover_penalty`` in total absolute weight,
keep the previous weights and trade nothing. A gradient penalty would bias
the solution itself, which is the wrong fix - the solution is not what is
wrong with churn, the churning is.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

__all__ = ["AllocationResult", "risk_parity_weights", "portfolio_volatility",
           "marginal_risk_contribution", "MIN_WEIGHT", "MAX_WEIGHT"]

#: SPEC section 7.1 constraints. Below the floor a strategy is not earning its
#: operational complexity - retire it or size it properly.
MIN_WEIGHT = 0.05
MAX_WEIGHT = 0.40


def _cov(vols: Sequence[float], corr: Sequence[Sequence[float]]) -> List[List[float]]:
    n = len(vols)
    return [[vols[i] * vols[j] * corr[i][j] for j in range(n)] for i in range(n)]


def portfolio_volatility(weights: Sequence[float], cov: Sequence[Sequence[float]]) -> float:
    n = len(weights)
    total = sum(weights[i] * cov[i][j] * weights[j] for i in range(n) for j in range(n))
    return math.sqrt(max(total, 0.0))


def marginal_risk_contribution(weights: Sequence[float],
                               cov: Sequence[Sequence[float]]) -> List[float]:
    """``(Sigma w)_i / sigma_p``. Risk contributions are ``w_i * MRC_i``."""
    sigma = portfolio_volatility(weights, cov)
    if sigma <= 0:
        return [0.0] * len(weights)
    n = len(weights)
    return [sum(cov[i][j] * weights[j] for j in range(n)) / sigma for i in range(n)]


@dataclass(frozen=True)
class AllocationResult:
    strategies: Tuple[str, ...]
    weights: Tuple[float, ...]
    risk_contributions: Tuple[float, ...]
    portfolio_vol: float
    iterations: int
    converged: bool
    #: True when the per-strategy cap had to be widened because the book is
    #: too small for it. Not an error, but a fact worth surfacing: it means
    #: concentration is forced, not chosen.
    cap_relaxed: bool = False

    def as_dict(self) -> Dict[str, float]:
        return dict(zip(self.strategies, self.weights))

    @property
    def max_contribution_spread(self) -> float:
        """How far from equal the risk contributions ended up. Lower is better."""
        if not self.risk_contributions:
            return 0.0
        return max(self.risk_contributions) - min(self.risk_contributions)


def risk_parity_weights(
    strategies: Sequence[str],
    volatilities: Sequence[float],
    correlations: Sequence[Sequence[float]],
    previous: Optional[Mapping[str, float]] = None,
    turnover_penalty: float = 0.1,
    min_weight: float = MIN_WEIGHT,
    max_weight: float = MAX_WEIGHT,
    iterations: int = 2000,
    tolerance: float = 1e-9,
) -> AllocationResult:
    """Equal risk contribution, subject to weight bounds and turnover cost.

    ``turnover_penalty`` stops the allocator churning the book chasing
    estimation noise. Set it so a re-allocation has to be worth more than its
    own transaction cost.
    """
    n = len(strategies)
    if n == 0:
        return AllocationResult((), (), (), 0.0, 0, True)
    if n == 1:
        return AllocationResult(tuple(strategies), (1.0,), (1.0,),
                                volatilities[0] if volatilities else 0.0, 0, True, True)
    if min_weight * n > 1.0:
        raise ValueError(
            f"min_weight {min_weight} x {n} strategies exceeds 1.0; "
            "the constraints cannot all be satisfied"
        )
    # The 40% cap of SPEC section 7.1 assumes the 5-10 strategy book it is
    # written for. On a two- or three-strategy book - which is Track A - the
    # cap is arithmetically infeasible: two strategies cannot both sit below
    # 40% of a budget that must sum to 100%. Relax it to equal weight rather
    # than refusing to allocate, and report that it was relaxed, because the
    # binding constraint is then "you do not have enough strategies", which is
    # a portfolio problem and not a solver problem.
    effective_max = max(max_weight, 1.0 / n)
    cap_relaxed = effective_max > max_weight

    cov = _cov(volatilities, correlations)
    w = [1.0 / n] * n
    converged = False
    used = 0
    damping = 0.5

    for it in range(iterations):
        used = it + 1
        mrc = marginal_risk_contribution(w, cov)
        if any(m <= 0 for m in mrc):
            break

        # w_i proportional to 1 / MRC_i, damped toward the current weights so
        # a poorly conditioned covariance cannot oscillate.
        raw = [1.0 / m for m in mrc]
        total = sum(raw)
        proposed = [r / total for r in raw]
        blended = [(1 - damping) * w[i] + damping * proposed[i] for i in range(n)]

        clipped = _project(blended, min_weight, effective_max)
        delta = max(abs(clipped[i] - w[i]) for i in range(n))
        w = clipped
        if delta < tolerance:
            converged = True
            break

    # Turnover deadband. Trade only if the move is worth its own cost.
    if previous:
        prev = [previous.get(s_, 0.0) for s_ in strategies]
        if sum(abs(w[i] - prev[i]) for i in range(n)) < turnover_penalty:
            w = _project(prev, min_weight, effective_max)

    sigma = portfolio_volatility(w, cov)
    mrc = marginal_risk_contribution(w, cov)
    rc = [w[i] * mrc[i] / sigma if sigma > 0 else 0.0 for i in range(n)]
    return AllocationResult(tuple(strategies), tuple(w), tuple(rc), sigma, used,
                            converged, cap_relaxed)


def _project(weights: Sequence[float], lo: float, hi: float,
             passes: int = 50) -> List[float]:
    """Clip to [lo, hi] and renormalise to sum 1.

    Repeated because clipping breaks the sum and renormalising breaks the
    clip. With feasible bounds the alternation converges; the pass limit is
    there so an infeasible call returns rather than spins.
    """
    w = list(weights)
    n = len(w)
    for _ in range(passes):
        w = [min(hi, max(lo, x)) for x in w]
        total = sum(w)
        if total <= 0:
            return [1.0 / n] * n
        w = [x / total for x in w]
        if all(lo - 1e-12 <= x <= hi + 1e-12 for x in w):
            break
    return w
