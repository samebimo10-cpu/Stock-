"""L4 - allocation, netting, correlation.

Allocate by risk contribution, not capital. Diversification across edges is
the single largest contributor to Sharpe in this kind of system, which is also
the largest honest gap between a two-strategy book and a six-strategy one - a
gap no amount of engineering closes.
"""

from .netting import net_targets, NettingResult
from .correlation import CorrelationEstimator, PESSIMISTIC_PRIOR, MIN_OBSERVATIONS
from .allocate import risk_parity_weights, AllocationResult, marginal_risk_contribution
from .allocator import Allocator, DEFAULT_REBALANCE_NS

__all__ = [
    "net_targets", "NettingResult",
    "CorrelationEstimator", "PESSIMISTIC_PRIOR", "MIN_OBSERVATIONS",
    "risk_parity_weights", "AllocationResult", "marginal_risk_contribution",
    "Allocator", "DEFAULT_REBALANCE_NS",
]
