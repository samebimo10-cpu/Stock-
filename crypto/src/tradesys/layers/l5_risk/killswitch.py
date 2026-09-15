"""Kill switches and the recovery matrix (SPEC section 8.4, Annex D sections 2-3).

The part v1.0 of the specification omits is recovery. A kill switch with no
defined route back gets bypassed rather than reset, usually by one tired
person at 3am. So every trigger here declares what it takes to return to
trading, and the design principle is visible in the data: conditions that are
transient and externally verifiable recover automatically; conditions that
imply the system's model of reality is wrong require a human.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Optional, Tuple

from ...core.types import Nanos

__all__ = ["SwitchState", "Trigger", "Recovery", "RECOVERY", "KillSwitch"]


class SwitchState:
    ACTIVE = "ACTIVE"
    #: No new orders; resting orders cancelled. Always entered before
    #: FLATTENING - cancel first, or the flattening orders compete with your
    #: own stale quotes.
    HALTING = "HALTING"
    HALTED = "HALTED"            # positions held
    FLATTENING = "FLATTENING"    # reducing to zero, reduce_only
    FLAT = "FLAT"
    RECOVERING = "RECOVERING"

    TRADING_BLOCKED = frozenset({HALTING, HALTED, FLATTENING, FLAT, RECOVERING})


class Trigger:
    FEED_STALENESS = "feed_staleness"
    LATENCY = "latency_spike"
    ORDER_RATE = "order_rate"
    CONNECTIVITY = "connectivity_loss"
    REJECT_SPIKE = "rejection_rate_spike"
    RECONCILE_MISMATCH = "reconciliation_mismatch"
    MISSING_LOCAL = "missing_local_position"
    LIQUIDATION_DISTANCE = "liquidation_distance"
    DAILY_LOSS = "daily_loss"
    WEEKLY_LOSS = "weekly_loss"
    DRAWDOWN_SOFT = "drawdown_soft"
    DRAWDOWN_HARD = "drawdown_hard"
    DEADMAN = "deadman"
    AUDIT_BUFFER_FULL = "audit_buffer_full"
    CLOCK_DRIFT = "clock_drift"
    MANUAL = "manual"


@dataclass(frozen=True)
class Recovery:
    """How a trigger is cleared."""

    #: State the trigger drives the system into.
    state: str
    #: Flatten positions, or hold them.
    flatten: bool
    #: Automatic once the condition clears for ``settle_s``; otherwise human.
    automatic: bool
    #: People required to authorise the return. 0 means automatic.
    approvals: int = 0
    settle_s: float = 0.0
    note: str = ""


#: Annex D section 3, as data so it can be tested rather than described.
RECOVERY: Dict[str, Recovery] = {
    Trigger.FEED_STALENESS: Recovery(SwitchState.HALTED, False, True, 0, 300,
                                     "feed green for 5 min"),
    Trigger.LATENCY: Recovery(SwitchState.HALTED, False, True, 0, 300,
                              "latency green for 5 min"),
    Trigger.ORDER_RATE: Recovery(SwitchState.HALTED, False, True, 0, 60,
                                 "rate below 50% of budget"),
    Trigger.CONNECTIVITY: Recovery(SwitchState.FLATTENING, True, False, 1, 0,
                                   "reconnect and clean reconciliation"),
    Trigger.REJECT_SPIKE: Recovery(SwitchState.HALTED, False, False, 1, 0,
                                   "root cause recorded"),
    Trigger.RECONCILE_MISMATCH: Recovery(SwitchState.HALTED, False, False, 1, 0,
                                         "manual investigation; never auto-resolved"),
    Trigger.MISSING_LOCAL: Recovery(SwitchState.HALTED, False, False, 1, 0,
                                    "unknown exposure; never auto-adopted"),
    Trigger.LIQUIDATION_DISTANCE: Recovery(SwitchState.HALTED, False, True, 0, 0,
                                           "distance above 35%"),
    Trigger.DAILY_LOSS: Recovery(SwitchState.FLATTENING, True, False, 1, 0,
                                 "next UTC day plus acknowledgement"),
    Trigger.WEEKLY_LOSS: Recovery(SwitchState.FLATTENING, True, False, 2, 0,
                                  "written review, two people"),
    Trigger.DRAWDOWN_SOFT: Recovery(SwitchState.HALTED, False, False, 1, 0,
                                    "allocations halved; written review"),
    Trigger.DRAWDOWN_HARD: Recovery(SwitchState.FLATTENING, True, False, 2, 0,
                                    "full revalidation of every live strategy"),
    Trigger.DEADMAN: Recovery(SwitchState.FLATTENING, True, False, 1, 0,
                              "risk service healthy plus reconciliation"),
    Trigger.AUDIT_BUFFER_FULL: Recovery(SwitchState.HALTED, False, False, 1, 0,
                                        "audit path restored and backlog flushed"),
    Trigger.CLOCK_DRIFT: Recovery(SwitchState.HALTED, False, True, 0, 300,
                                  "drift below 10ms for 5 min"),
    Trigger.MANUAL: Recovery(SwitchState.FLATTENING, True, False, 1, 0,
                             "operator decision"),
}


@dataclass
class _Engaged:
    trigger: str
    at: Nanos
    detail: str
    cleared_since: Optional[Nanos] = None
    approvals: List[str] = field(default_factory=list)


class KillSwitch:
    """Holds engaged triggers and derives the system state from them.

    State is derived rather than assigned, so two simultaneous triggers cannot
    leave the system in the milder of the two states.
    """

    def __init__(self) -> None:
        self._engaged: Dict[str, _Engaged] = {}
        self.deadman_last_beat: Optional[Nanos] = None
        self.deadman_tolerance_ns: int = 10_000_000_000   # 10s [B]; 30s [A]

    # -- engaging --------------------------------------------------------

    def engage(self, trigger: str, at: Nanos, detail: str = "") -> Recovery:
        if trigger not in RECOVERY:
            raise KeyError(f"unknown trigger {trigger!r}")
        if trigger not in self._engaged:
            self._engaged[trigger] = _Engaged(trigger, at, detail)
        return RECOVERY[trigger]

    def condition_cleared(self, trigger: str, at: Nanos) -> None:
        """Mark the underlying condition as no longer true.

        This is not the same as clearing the switch. An automatic trigger still
        has to stay clear for its settle period; a manual one still needs its
        approvals.
        """
        e = self._engaged.get(trigger)
        if e is not None and e.cleared_since is None:
            e.cleared_since = at

    def condition_returned(self, trigger: str) -> None:
        e = self._engaged.get(trigger)
        if e is not None:
            e.cleared_since = None

    def approve(self, trigger: str, operator: str) -> None:
        """Record one operator's authorisation to resume.

        Distinct operators only: the two-person rule is not satisfied by one
        person pressing the button twice.
        """
        e = self._engaged.get(trigger)
        if e is None:
            return
        if operator not in e.approvals:
            e.approvals.append(operator)

    def try_clear(self, trigger: str, now: Nanos) -> bool:
        """Attempt to clear one trigger. True if it cleared."""
        e = self._engaged.get(trigger)
        if e is None:
            return True
        rec = RECOVERY[trigger]
        if rec.automatic:
            if e.cleared_since is None:
                return False
            if (now - e.cleared_since) < int(rec.settle_s * 1e9):
                return False
        else:
            if e.cleared_since is None:
                return False
            if len(e.approvals) < max(1, rec.approvals):
                return False
        del self._engaged[trigger]
        return True

    def try_clear_all(self, now: Nanos) -> List[str]:
        return [t for t in list(self._engaged) if self.try_clear(t, now)]

    # -- deadman ---------------------------------------------------------

    def heartbeat(self, at: Nanos) -> None:
        self.deadman_last_beat = at

    def check_deadman(self, now: Nanos) -> bool:
        """True if the dead-man's switch has fired.

        The execution service acts on this **without asking**, because the
        service it would ask is the one that is not responding. It is the one
        place in the system where a component touches positions without risk
        approval, and it is safe precisely because its only possible action is
        to reduce.
        """
        if self.deadman_last_beat is None:
            return False
        if (now - self.deadman_last_beat) > self.deadman_tolerance_ns:
            self.engage(Trigger.DEADMAN, now, "risk service heartbeat missed")
            return True
        return False

    # -- reading ---------------------------------------------------------

    @property
    def engaged(self) -> Tuple[str, ...]:
        return tuple(sorted(self._engaged))

    @property
    def is_engaged(self) -> bool:
        return bool(self._engaged)

    @property
    def state(self) -> str:
        """Derived: the most severe state any engaged trigger demands."""
        if not self._engaged:
            return SwitchState.ACTIVE
        if any(RECOVERY[t].flatten for t in self._engaged):
            return SwitchState.FLATTENING
        return SwitchState.HALTED

    @property
    def must_flatten(self) -> bool:
        return any(RECOVERY[t].flatten for t in self._engaged)

    def blocking_reason(self) -> Optional[str]:
        if not self._engaged:
            return None
        worst = sorted(self._engaged, key=lambda t: (not RECOVERY[t].flatten, t))[0]
        e = self._engaged[worst]
        return f"{worst}: {e.detail}" if e.detail else worst

    def status(self) -> Dict[str, object]:
        return {
            "state": self.state,
            "engaged": list(self.engaged),
            "must_flatten": self.must_flatten,
            "detail": {t: e.detail for t, e in self._engaged.items()},
        }
