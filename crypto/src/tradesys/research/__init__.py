"""Research and validation.

Not a layer - an environment that replays L1 through L6 offline (SPEC section
3.1). It has different availability requirements from the trading system and
must never share a database connection with it.

This is where most well-funded trading projects fail: not in the strategy, not
in the infrastructure, but in the validation.
"""

from ..costs import (
    CostModel, FeeModel, slippage_cost, market_impact_bps,
    funding_carry, carry_breakeven_periods, maker_edge_bps,
)
from .registry import TrialRegistry, RegistryRequired, Trial
from .harness import (
    ValidationHarness, ValidationReport, HoldoutStore, HoldoutSpent, Verdict, Check,
)
from .validation import (
    sharpe, deflated_sharpe, expected_max_sharpe, probability_of_backtest_overfitting,
    purged_kfold_splits, monte_carlo_drawdown, live_vs_backtest_z, time_to_significance_years,
    bootstrap_expectancy_ci, max_drawdown,
)

__all__ = [
    "CostModel", "FeeModel", "slippage_cost", "market_impact_bps",
    "funding_carry", "carry_breakeven_periods", "maker_edge_bps",
    "TrialRegistry", "RegistryRequired", "Trial",
    "ValidationHarness", "ValidationReport", "HoldoutStore", "HoldoutSpent",
    "Verdict", "Check",
    "sharpe", "deflated_sharpe", "expected_max_sharpe",
    "probability_of_backtest_overfitting", "purged_kfold_splits",
    "monte_carlo_drawdown", "live_vs_backtest_z", "time_to_significance_years",
    "bootstrap_expectancy_ci", "max_drawdown",
]
