"""The startup gate (SPEC section 9.5).

No strategy runs until reconciliation completes cleanly. Step 5 - a
discrepancy requires operator acknowledgement - is the one under pressure
during an incident, and the one that must not be automated.

Failure mode 6 in SPEC section 8.5 is a system that restarts, does not know
about open positions, and opens more. This gate is the whole defence.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, List, Optional, Sequence, Tuple

__all__ = ["StartupGateFailed", "StartupGate", "GateStep"]


class StartupGateFailed(RuntimeError):
    """The system must not trade. Exit rather than continue."""


@dataclass
class GateStep:
    name: str
    check: Callable[[], bool]
    #: Whether failure exits the process or merely blocks strategies.
    fatal: bool = True
    detail: str = ""


@dataclass
class StartupGate:
    """Ordered. Strategies are enabled one at a time, and only at the end."""

    steps: List[GateStep] = field(default_factory=list)
    passed: List[str] = field(default_factory=list)
    failed: List[Tuple[str, str]] = field(default_factory=list)
    #: Set when a discrepancy was found. Cleared only by a human.
    needs_acknowledgement: bool = False
    acknowledged_by: Optional[str] = None

    def add(self, name: str, check: Callable[[], bool], fatal: bool = True,
            detail: str = "") -> "StartupGate":
        self.steps.append(GateStep(name, check, fatal, detail))
        return self

    def acknowledge(self, operator: str) -> None:
        """A human confirms they have looked at the discrepancy.

        Deliberately not automatable. Auto-resolving here would mean resuming
        trading while not knowing what we hold.
        """
        self.needs_acknowledgement = False
        self.acknowledged_by = operator

    def run(self) -> bool:
        self.passed.clear()
        self.failed.clear()
        for step in self.steps:
            try:
                ok = bool(step.check())
            except Exception as e:                       # a check that throws has failed
                ok = False
                step = GateStep(step.name, step.check, step.fatal, f"{type(e).__name__}: {e}")
            if ok:
                self.passed.append(step.name)
                continue
            self.failed.append((step.name, step.detail))
            if step.fatal:
                raise StartupGateFailed(
                    f"startup gate failed at {step.name}"
                    + (f": {step.detail}" if step.detail else "")
                    + ". No strategy may run."
                )
        if self.needs_acknowledgement and not self.acknowledged_by:
            raise StartupGateFailed(
                "reconciliation found a discrepancy at startup; an operator must "
                "acknowledge it before any strategy runs (SPEC section 9.5 step 5)"
            )
        return True

    @property
    def may_enable_strategies(self) -> bool:
        return not self.failed and not self.needs_acknowledgement
