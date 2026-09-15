"""L5 - sizing, limits, kill switches.

Specified before strategy, deliberately, and built first. Risk is the layer
that decides whether the operation survives a bad month.

This package must not import ``l3_strategy``: risk cannot be made to depend on
what a strategy wants. The rule is enforced in ``tests/test_import_graph.py``.
"""

from .limits import LimitRegister, LimitError
from .state import PortfolioState
from .killswitch import KillSwitch, SwitchState, Trigger, RECOVERY
from .service import RiskService, CHECKS
from .sizing import fractional_kelly, volatility_target, conditional_loss_size, correlation_adjusted_cap

__all__ = [
    "LimitRegister", "LimitError", "PortfolioState",
    "KillSwitch", "SwitchState", "Trigger", "RECOVERY",
    "RiskService", "CHECKS",
    "fractional_kelly", "volatility_target", "conditional_loss_size",
    "correlation_adjusted_cap",
]
