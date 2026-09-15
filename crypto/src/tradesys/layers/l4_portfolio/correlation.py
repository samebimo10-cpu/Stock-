"""Correlation estimation (SPEC section 7.2).

The practical problem v1.0 of the specification skips: correlation estimated
on a short sample is mostly noise, and the optimiser will act on that noise
with great confidence.

Four rules, each implemented here:

1. Estimate on **daily strategy profit and loss**, not on asset returns. Two
   strategies trading the same asset can be uncorrelated; two trading
   different assets can be identical.
2. Below :data:`MIN_OBSERVATIONS`, assume :data:`PESSIMISTIC_PRIOR`. It costs
   a little diversification and stops the optimiser concentrating on a
   coincidence.
3. Ledoit-Wolf style shrinkage toward a constant-correlation target.
4. Compute a 60-day and a 20-day estimate and **use the higher**. Correlations
   rise in stress, and the stress estimate is the one that will be true when
   it matters.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

__all__ = ["MIN_OBSERVATIONS", "PESSIMISTIC_PRIOR", "CorrelationEstimator",
           "pearson", "shrink_toward_constant"]

#: Below this many joint observations, do not believe the estimate.
MIN_OBSERVATIONS = 60
#: What to assume instead. Deliberately pessimistic.
PESSIMISTIC_PRIOR = 0.5

#: SPEC section 7.2 thresholds.
CUT_ALLOCATION_ABOVE = 0.6
DISABLE_ABOVE = 0.8


def pearson(a: Sequence[float], b: Sequence[float]) -> Optional[float]:
    n = min(len(a), len(b))
    if n < 2:
        return None
    a, b = list(a[-n:]), list(b[-n:])
    ma, mb = sum(a) / n, sum(b) / n
    va = sum((x - ma) ** 2 for x in a)
    vb = sum((x - mb) ** 2 for x in b)
    if va <= 0 or vb <= 0:
        return None
    cov = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return cov / math.sqrt(va * vb)


def shrink_toward_constant(estimate: float, target: float, intensity: float) -> float:
    """Blend a noisy estimate toward a constant-correlation target."""
    intensity = min(1.0, max(0.0, intensity))
    return (1.0 - intensity) * estimate + intensity * target


@dataclass
class CorrelationEstimator:
    """Holds per-strategy daily PnL and answers pairwise questions."""

    long_window: int = 60
    short_window: int = 20
    shrink_intensity: float = 0.2
    history: Dict[str, List[float]] = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.history is None:
            self.history = {}

    def observe(self, strategy_id: str, daily_pnl: float) -> None:
        self.history.setdefault(strategy_id, []).append(daily_pnl)

    def observations(self, a: str, b: str) -> int:
        return min(len(self.history.get(a, [])), len(self.history.get(b, [])))

    def correlation(self, a: str, b: str) -> Tuple[float, bool]:
        """Return (correlation, is_estimated).

        ``is_estimated`` is False when the pessimistic prior was used because
        there were too few joint observations. Callers should surface that:
        a 0.5 that is an assumption and a 0.5 that is a measurement call for
        different confidence.
        """
        if a == b:
            return 1.0, True
        n = self.observations(a, b)
        if n < MIN_OBSERVATIONS:
            return PESSIMISTIC_PRIOR, False

        ha, hb = self.history[a], self.history[b]
        long_est = pearson(ha[-self.long_window:], hb[-self.long_window:])
        short_est = pearson(ha[-self.short_window:], hb[-self.short_window:])

        candidates = [c for c in (long_est, short_est) if c is not None]
        if not candidates:
            return PESSIMISTIC_PRIOR, False

        # The higher of the two. Correlations rise in stress.
        raw = max(candidates)
        return shrink_toward_constant(raw, PESSIMISTIC_PRIOR, self.shrink_intensity), True

    def matrix(self, strategies: Sequence[str]) -> List[List[float]]:
        return [[self.correlation(a, b)[0] for b in strategies] for a in strategies]

    def breaches(self, strategies: Sequence[str]) -> List[Tuple[str, str, float, str]]:
        """Pairs above the action thresholds, with the action to take."""
        out = []
        for i, a in enumerate(strategies):
            for b in strategies[i + 1:]:
                rho, _ = self.correlation(a, b)
                if rho > DISABLE_ABOVE:
                    out.append((a, b, rho, "disable_worse_performer"))
                elif rho > CUT_ALLOCATION_ABOVE:
                    out.append((a, b, rho, "halve_combined_allocation"))
        return out
