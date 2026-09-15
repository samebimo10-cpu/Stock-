"""The allocator that actually allocates (SPEC section 7.1, 7.4).

:mod:`.allocate` solves for risk-parity weights. This applies them, which is a
separate job and the one that was missing: a weight nobody multiplies a signal
by is a number on a dashboard.

Two decisions worth stating:

* **Weights scale a strategy's desired exposure, they do not gate it.** A
  strategy at 20% of the risk budget trades at a fifth of its base size rather
  than one day in five. Gating would make the allocation a lottery.
* **Re-solve on a schedule, not on every event.** Continuous re-optimisation is
  expensive and unstable, and chasing a correlation estimate that moved by
  noise is exactly the churn the turnover deadband exists to prevent
  (SPEC section 7.4).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Sequence

from ...core.types import Decimal as Dec, Nanos, dec
from .allocate import MAX_WEIGHT, AllocationResult, risk_parity_weights
from .correlation import CUT_ALLOCATION_ABOVE, DISABLE_ABOVE, CorrelationEstimator

__all__ = ["Allocator", "DEFAULT_REBALANCE_NS"]

#: Daily. SPEC section 7.4 - intraday, strategies trade within their allocated
#: budget without re-solving the portfolio.
DEFAULT_REBALANCE_NS = 24 * 3600 * 1_000_000_000


class Allocator:
    """Holds the current weights and decides when to re-solve."""

    def __init__(self, correlations: Optional[CorrelationEstimator] = None,
                 rebalance_ns: int = DEFAULT_REBALANCE_NS,
                 turnover_penalty: float = 0.1,
                 min_observations_for_vol: int = 20,
                 max_weight: float = MAX_WEIGHT) -> None:
        self.correlations = correlations or CorrelationEstimator()
        self.rebalance_ns = rebalance_ns
        self.turnover_penalty = turnover_penalty
        self.min_observations_for_vol = min_observations_for_vol
        #: Per-strategy cap. On a book of fewer than three strategies this is
        #: arithmetically infeasible and the solver relaxes it to equal weight,
        #: which also means risk parity is unreachable there: two strategies
        #: get 50/50 whatever their volatilities. That is a portfolio problem -
        #: not enough strategies - and :meth:`status` reports it rather than
        #: presenting equal weight as an optimisation.
        self.max_weight = max_weight
        self.weights: Dict[str, Dec] = {}
        self.last_solved: Optional[Nanos] = None
        self.version = 0
        self.last_result: Optional[AllocationResult] = None
        #: Pairs currently cut for correlation, and what was done.
        self.breaches: List[tuple] = []

    # ------------------------------------------------------------------

    def observe(self, strategy_id: str, daily_pnl: float) -> None:
        self.correlations.observe(strategy_id, daily_pnl)

    def weight_for(self, strategy_id: str) -> Dec:
        """Equal weight until the first solve.

        Not zero: a system that refuses to trade until it has sixty days of
        profit and loss never gets sixty days of profit and loss.
        """
        if not self.weights:
            return dec(1)
        return self.weights.get(strategy_id, dec(0))

    def due(self, now: Nanos) -> bool:
        return self.last_solved is None or (now - self.last_solved) >= self.rebalance_ns

    # ------------------------------------------------------------------

    def solve(self, strategies: Sequence[str], now: Nanos,
              force: bool = False) -> Optional[AllocationResult]:
        """Re-solve the weights, if it is time and there is anything to solve.

        Returns ``None`` when nothing changed, so a caller can tell a
        reallocation from a quiet cycle.
        """
        if not strategies:
            return None
        if not force and not self.due(now):
            return None

        volatilities = [self._volatility(s) for s in strategies]
        if any(v <= 0 for v in volatilities):
            # Not enough profit and loss history to size by risk. Equal weight
            # is the honest interim answer, and it is recorded as such rather
            # than dressed up as an optimisation.
            self.weights = {s: dec(1) / dec(len(strategies)) for s in strategies}
            self.last_solved = now
            self.version += 1
            return None

        correlations = self.correlations.matrix(strategies)
        previous = {s: float(self.weights.get(s, dec(0))) for s in strategies} \
            if self.weights else None

        result = risk_parity_weights(
            strategies, volatilities, correlations,
            previous=previous, turnover_penalty=self.turnover_penalty,
            max_weight=self.max_weight,
        )

        weights = {s: dec(str(round(w, 6))) for s, w in zip(result.strategies, result.weights)}
        weights = self._apply_correlation_cuts(strategies, weights)

        changed = weights != self.weights
        self.weights = weights
        self.last_solved = now
        self.last_result = result
        if changed:
            self.version += 1
        return result if changed else None

    def _apply_correlation_cuts(self, strategies: Sequence[str],
                                weights: Dict[str, Dec]) -> Dict[str, Dec]:
        """Halve a correlated pair, and disable the worse of a very correlated one.

        SPEC section 7.2. Applied after the optimiser rather than inside it:
        the optimiser's job is to equalise risk, and a pair that is nearly the
        same strategy has equal risk contributions and no diversification at
        all. The cut is a different judgement and it belongs where it can be
        seen.
        """
        self.breaches = self.correlations.breaches(strategies)
        adjusted = dict(weights)
        for a, b, rho, action in self.breaches:
            if action == "halve_combined_allocation":
                adjusted[a] = adjusted.get(a, dec(0)) / 2
                adjusted[b] = adjusted.get(b, dec(0)) / 2
            elif action == "disable_worse_performer":
                worse = self._worse_performer(a, b)
                adjusted[worse] = dec(0)
        return adjusted

    def _worse_performer(self, a: str, b: str) -> str:
        history = self.correlations.history
        return a if sum(history.get(a, [0.0])) <= sum(history.get(b, [0.0])) else b

    def _volatility(self, strategy_id: str) -> float:
        series = self.correlations.history.get(strategy_id, [])
        if len(series) < self.min_observations_for_vol:
            return 0.0
        mean = sum(series) / len(series)
        variance = sum((x - mean) ** 2 for x in series) / (len(series) - 1)
        return variance ** 0.5

    # ------------------------------------------------------------------

    def status(self) -> Dict[str, object]:
        return {
            "version": self.version,
            "weights": {k: str(v) for k, v in sorted(self.weights.items())},
            "breaches": [(a, b, round(rho, 3), action)
                         for a, b, rho, action in self.breaches],
            "converged": self.last_result.converged if self.last_result else None,
            "cap_relaxed": self.last_result.cap_relaxed if self.last_result else None,
            "risk_parity_reachable": not (self.last_result.cap_relaxed
                                          if self.last_result else False),
        }
