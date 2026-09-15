"""Metrics and service level indicators (SPEC section 10.1).

Small on purpose. A trading system needs counters, gauges and percentiles, and
pulling in a metrics library to get them costs a dependency on the hot path for
arithmetic that fits on a page.

The part that carries the design is :class:`SloEvaluator`. It holds the targets
from SPEC section 10.1 and decides which breaches page, and it enforces the
rule the specification is firm about: **a P1 that fires without money at risk
is a defect in the alert.** Latency above budget with no position open is a
P2. The same latency with a position open is a P1. Encoding that here is what
stops the taxonomy decaying into "everything pages", which is the mechanism by
which the one real page gets ignored.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from ...core.types import Nanos, now_ns
from .alerts import Severity

__all__ = ["Counter", "Gauge", "Histogram", "MetricRegistry", "SloTarget",
           "SLO_TARGETS", "SloEvaluator", "SloBreach"]


class Counter:
    """Monotonic. Goes up, and resets only when the process does."""

    __slots__ = ("name", "help", "_value")

    def __init__(self, name: str, help: str = "") -> None:
        self.name = name
        self.help = help
        self._value = 0.0

    def inc(self, amount: float = 1.0) -> None:
        if amount < 0:
            raise ValueError("a counter cannot decrease; use a Gauge")
        self._value += amount

    @property
    def value(self) -> float:
        return self._value


class Gauge:
    """A level. The current value of something that moves both ways."""

    __slots__ = ("name", "help", "_value")

    def __init__(self, name: str, help: str = "") -> None:
        self.name = name
        self.help = help
        self._value = 0.0

    def set(self, value: float) -> None:
        self._value = float(value)

    def inc(self, amount: float = 1.0) -> None:
        self._value += amount

    @property
    def value(self) -> float:
        return self._value


class Histogram:
    """A bounded reservoir of recent observations, for percentiles.

    Bounded because a trading system runs for weeks and an unbounded list of
    every latency sample is a memory leak with a graph attached. The window is
    recent-biased on purpose: p99 latency last week does not help during an
    incident today.
    """

    __slots__ = ("name", "help", "window", "_samples", "_count", "_sum")

    def __init__(self, name: str, help: str = "", window: int = 4096) -> None:
        self.name = name
        self.help = help
        self.window = window
        self._samples: List[float] = []
        self._count = 0
        self._sum = 0.0

    def observe(self, value: float) -> None:
        self._count += 1
        self._sum += value
        self._samples.append(value)
        if len(self._samples) > self.window:
            del self._samples[0]

    @property
    def count(self) -> int:
        return self._count

    @property
    def mean(self) -> float:
        return self._sum / self._count if self._count else 0.0

    def percentile(self, pct: float) -> float:
        """Nearest-rank. Honest about its own resolution on small samples."""
        if not self._samples:
            return 0.0
        ordered = sorted(self._samples)
        k = max(0, min(len(ordered) - 1,
                       int(math.ceil(pct / 100.0 * len(ordered))) - 1))
        return ordered[k]

    @property
    def p50(self) -> float:
        return self.percentile(50)

    @property
    def p99(self) -> float:
        return self.percentile(99)

    @property
    def p999(self) -> float:
        return self.percentile(99.9)


class MetricRegistry:
    """Everything the system measures, in one place."""

    def __init__(self) -> None:
        self.counters: Dict[str, Counter] = {}
        self.gauges: Dict[str, Gauge] = {}
        self.histograms: Dict[str, Histogram] = {}

    def counter(self, name: str, help: str = "") -> Counter:
        return self.counters.setdefault(name, Counter(name, help))

    def gauge(self, name: str, help: str = "") -> Gauge:
        return self.gauges.setdefault(name, Gauge(name, help))

    def histogram(self, name: str, help: str = "", window: int = 4096) -> Histogram:
        return self.histograms.setdefault(name, Histogram(name, help, window))

    def snapshot(self) -> Dict[str, float]:
        out: Dict[str, float] = {}
        for name, c in self.counters.items():
            out[name] = c.value
        for name, g in self.gauges.items():
            out[name] = g.value
        for name, h in self.histograms.items():
            out[f"{name}_p50"] = h.p50
            out[f"{name}_p99"] = h.p99
            out[f"{name}_count"] = float(h.count)
        return dict(sorted(out.items()))

    def render_prometheus(self) -> str:
        """Text exposition, so Prometheus can scrape it without a client library."""
        lines: List[str] = []
        for name, c in sorted(self.counters.items()):
            if c.help:
                lines.append(f"# HELP {name} {c.help}")
            lines.append(f"# TYPE {name} counter")
            lines.append(f"{name} {c.value}")
        for name, g in sorted(self.gauges.items()):
            if g.help:
                lines.append(f"# HELP {name} {g.help}")
            lines.append(f"# TYPE {name} gauge")
            lines.append(f"{name} {g.value}")
        for name, h in sorted(self.histograms.items()):
            if h.help:
                lines.append(f"# HELP {name} {h.help}")
            lines.append(f"# TYPE {name} summary")
            lines.append(f'{name}{{quantile="0.5"}} {h.p50}')
            lines.append(f'{name}{{quantile="0.99"}} {h.p99}')
            lines.append(f"{name}_count {h.count}")
        return "\n".join(lines) + "\n"


# ----------------------------------------------------------------------
# Service level objectives
# ----------------------------------------------------------------------


@dataclass(frozen=True)
class SloTarget:
    """One indicator from SPEC section 10.1."""

    name: str
    metric: str
    #: Breach when the value exceeds this. ``below`` inverts the comparison.
    threshold: float
    below: bool = False
    #: Severity when money is *not* at risk.
    quiet_severity: str = Severity.P2
    #: Severity when a position is open. Some indicators page either way.
    live_severity: str = Severity.P1
    unit: str = ""
    note: str = ""

    def breached(self, value: float) -> bool:
        return value < self.threshold if self.below else value > self.threshold


#: SPEC section 10.1, as data.
SLO_TARGETS: Tuple[SloTarget, ...] = (
    SloTarget("feed_uptime", "feed_uptime_fraction", 0.999, below=True,
              unit="fraction", note="99.9%"),
    SloTarget("feed_staleness_p99", "feed_staleness_ms_p99", 500.0, unit="ms"),
    SloTarget("risk_decision_latency_p99", "risk_decision_ms_p99", 2.0, unit="ms",
              note="2ms institutional, 40ms small track"),
    SloTarget("order_ack_latency_p99", "order_ack_ms_p99", 100.0, unit="ms",
              quiet_severity=Severity.P2, live_severity=Severity.P2,
              note="alert, never page - slow acks lose edge, they do not lose money"),
    SloTarget("reconciliation_failures", "reconciliation_consecutive_failures", 1.0,
              note="pages on the second consecutive failure"),
    SloTarget("audit_write_failures", "audit_write_failures", 0.0,
              note="losing the audit path is a trading-halt condition"),
    SloTarget("signal_to_order_latency_p99", "signal_to_order_ms_p99", 50.0, unit="ms",
              quiet_severity=Severity.P3, live_severity=Severity.P2),
    SloTarget("clock_drift", "clock_drift_ms", 50.0, unit="ms",
              quiet_severity=Severity.P2,
              note="above 100ms the venue rejects signed requests outright"),
)


@dataclass(frozen=True)
class SloBreach:
    target: SloTarget
    value: float
    severity: str
    money_at_risk: bool

    def __str__(self) -> str:
        comparison = "below" if self.target.below else "above"
        return (f"{self.severity} {self.target.name}: {self.value:g}{self.target.unit} "
                f"{comparison} {self.target.threshold:g}{self.target.unit}")


class SloEvaluator:
    """Turns metrics into alerts, and decides what is allowed to page.

    ``money_at_risk`` is supplied by the caller rather than inferred, because
    only the caller knows whether a position is open. It is the single input
    that separates a page from a notification.
    """

    def __init__(self, registry: MetricRegistry,
                 targets: Sequence[SloTarget] = SLO_TARGETS) -> None:
        self.registry = registry
        self.targets = tuple(targets)

    def evaluate(self, money_at_risk: bool) -> List[SloBreach]:
        snapshot = self.registry.snapshot()
        breaches: List[SloBreach] = []
        for target in self.targets:
            if target.metric not in snapshot:
                continue                      # not measured yet; not a breach
            value = snapshot[target.metric]
            if not target.breached(value):
                continue
            severity = target.live_severity if money_at_risk else target.quiet_severity
            breaches.append(SloBreach(target, value, severity, money_at_risk))
        return breaches

    def raise_all(self, router, money_at_risk: bool) -> List[SloBreach]:
        """Route every breach through the alert router.

        The router refuses a P1 that does not claim money at risk, so a
        mis-severity here fails loudly rather than teaching operators to
        ignore pages.
        """
        breaches = self.evaluate(money_at_risk)
        for breach in breaches:
            router.raise_alert(breach.severity, breach.target.name, str(breach),
                               money_at_risk=breach.severity == Severity.P1)
        return breaches
