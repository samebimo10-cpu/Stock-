"""L6 - routing, order lifecycle, reconciliation.

Poor execution destroys more edge than poor strategy. On a strategy with 5bps
of gross edge, 3bps of avoidable slippage removes 60% of it.
"""

from .fsm import OrderMachine, TRANSITIONS, TIMEOUTS, IllegalTransition
from .reconcile import Reconciler, Discrepancy, DiscrepancyClass
from .executor import Executor, ExecutionResult
from .tca import TcaRecord, implementation_shortfall_bps
from .startup import StartupGate, StartupGateFailed

__all__ = [
    "OrderMachine", "TRANSITIONS", "TIMEOUTS", "IllegalTransition",
    "Reconciler", "Discrepancy", "DiscrepancyClass",
    "Executor", "ExecutionResult",
    "TcaRecord", "implementation_shortfall_bps",
    "StartupGate", "StartupGateFailed",
]
