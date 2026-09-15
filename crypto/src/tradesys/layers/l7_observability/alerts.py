"""Alert taxonomy and service level indicators (SPEC section 10.1-10.2).

The discipline is in what does **not** page. A P1 that fires without money at
risk is a defect in the alert, and gets fixed at the same priority as a defect
in the code: alert fatigue is the mechanism by which the one real page gets
ignored, and it is caused by exactly this.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Dict, List, Optional, Tuple

from ...core.types import Nanos, now_ns

__all__ = ["Severity", "Alert", "AlertRouter", "SLI", "SLIS"]


class Severity:
    #: Money at risk right now. Pages 24/7.
    P1 = "P1"
    #: Degradation. Notify; respond in business hours.
    P2 = "P2"
    #: Informational. Dashboard only.
    P3 = "P3"


@dataclass(frozen=True)
class SLI:
    name: str
    target: str
    pages: bool
    note: str = ""


#: SPEC section 10.1.
SLIS: Tuple[SLI, ...] = (
    SLI("feed_uptime", "99.9%", True),
    SLI("feed_staleness_p99", "< 500ms", True),
    SLI("risk_decision_latency_p99", "< 2ms [B] / 40ms [A]", True),
    SLI("order_ack_latency_p99", "< 100ms", False, "alert, do not page"),
    SLI("reconciliation_success_rate", "100%", True, "pages on 2 consecutive failures"),
    SLI("audit_write_success", "100%", True),
    SLI("signal_to_order_latency_p99", "< 50ms [B]", False),
    SLI("clock_drift", "< 10ms", True, "pages above 50ms"),
)


@dataclass(frozen=True)
class Alert:
    severity: str
    name: str
    detail: str
    at: Nanos
    #: Whether money is at risk right now. A P1 must set this true; the
    #: router refuses one that does not, which is how the rule above stops
    #: being advice.
    money_at_risk: bool = False


class AlertRouter:
    """Routes alerts and refuses malformed P1s."""

    def __init__(self, clock: Callable[[], Nanos] = now_ns) -> None:
        self.clock = clock
        self.sent: List[Alert] = []
        self._handlers: Dict[str, List[Callable[[Alert], None]]] = {
            Severity.P1: [], Severity.P2: [], Severity.P3: []
        }
        #: Alerts suppressed because an identical one is already open.
        self.deduplicated = 0
        self._open: Dict[Tuple[str, str], Alert] = {}

    def on(self, severity: str, handler: Callable[[Alert], None]) -> None:
        self._handlers[severity].append(handler)

    def raise_alert(self, severity: str, name: str, detail: str = "",
                    money_at_risk: bool = False) -> Optional[Alert]:
        if severity == Severity.P1 and not money_at_risk:
            raise ValueError(
                f"P1 alert {name!r} does not claim money at risk. A P1 that fires "
                "without money at risk is a defect in the alert (SPEC section 10.2). "
                "Use P2 for degradation."
            )
        key = (severity, name)
        if key in self._open:
            self.deduplicated += 1
            return None
        alert = Alert(severity, name, detail, self.clock(), money_at_risk)
        self._open[key] = alert
        self.sent.append(alert)
        for h in self._handlers.get(severity, []):
            h(alert)
        return alert

    def resolve(self, severity: str, name: str) -> None:
        self._open.pop((severity, name), None)

    def open_alerts(self) -> List[Alert]:
        return list(self._open.values())

    def pages(self) -> List[Alert]:
        return [a for a in self.sent if a.severity == Severity.P1]
