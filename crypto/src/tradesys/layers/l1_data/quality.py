"""Data-quality gates (SPEC section 4.4).

v1.0 of the specification names the checks; these are the thresholds. Two
things make this module load-bearing rather than cosmetic:

1. A red day is **excluded from research datasets**. Research silently trained
   on a bad window learns to trade the defect.
2. The same measurement read in real time is a **kill-switch trigger**. It is
   one monitor, consumed two ways.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Dict, List, Mapping, Optional, Tuple

__all__ = ["QualityGrade", "Threshold", "THRESHOLDS", "QualityMonitor", "DailyQualityReport"]


class QualityGrade:
    GREEN = "green"
    AMBER = "amber"
    RED = "red"

    _ORDER = {GREEN: 0, AMBER: 1, RED: 2}

    @classmethod
    def worst(cls, grades) -> str:
        return max(grades, key=lambda g: cls._ORDER[g], default=cls.GREEN)


@dataclass(frozen=True)
class Threshold:
    """Green below ``amber_above``; red at or above ``red_above``."""

    name: str
    amber_above: float
    red_above: float
    unit: str = ""

    def grade(self, value: float) -> str:
        if value >= self.red_above:
            return QualityGrade.RED
        if value > self.amber_above:
            return QualityGrade.AMBER
        return QualityGrade.GREEN


#: SPEC section 4.4, verbatim.
THRESHOLDS: Dict[str, Threshold] = {
    "sequence_gaps": Threshold("sequence_gaps", 0, 6, "per stream per day"),
    "gap_duration_s": Threshold("gap_duration_s", 1.0, 30.0, "seconds"),
    "duplicate_rate": Threshold("duplicate_rate", 0.0001, 0.001, "fraction"),
    "crossed_book_incidents": Threshold("crossed_book_incidents", 0, 4, "count"),
    "max_quiet_s": Threshold("max_quiet_s", 5.0, 30.0, "seconds"),
    "transit_p99_ms": Threshold("transit_p99_ms", 100.0, 500.0, "ms"),
    "clock_drift_ms": Threshold("clock_drift_ms", 10.0, 50.0, "ms"),
    "trade_book_inconsistency": Threshold("trade_book_inconsistency", 0.001, 0.01, "fraction"),
}


@dataclass
class DailyQualityReport:
    date: str
    venue: str
    stream: str
    measurements: Mapping[str, float]
    grades: Mapping[str, str]
    grade: str
    #: Escalated because the same check was amber three days running. Catches
    #: the degradation that never quite trips a threshold, which is the shape
    #: most real feed problems have.
    escalated: Tuple[str, ...] = ()

    @property
    def usable_for_research(self) -> bool:
        return self.grade != QualityGrade.RED

    def failing(self) -> List[str]:
        return [k for k, v in self.grades.items() if v != QualityGrade.GREEN]


class QualityMonitor:
    """Accumulates per-stream measurements and grades a day.

    One instance per (venue, stream). Feed it events as they arrive; call
    :meth:`close_day` at the UTC boundary.
    """

    def __init__(self, venue: str, stream: str, amber_escalation_days: int = 3) -> None:
        self.venue = venue
        self.stream = stream
        self.amber_escalation_days = amber_escalation_days
        self._amber_streak: Dict[str, int] = {}
        self.reset()

    def reset(self) -> None:
        self.messages = 0
        self.duplicates = 0
        self.sequence_gaps = 0
        self.gap_duration_s = 0.0
        self.crossed_book_incidents = 0
        self.trades_outside_book = 0
        self.trades_checked = 0
        self._transits_ms: List[float] = []
        self._last_event_ns: Optional[int] = None
        self.max_quiet_s = 0.0
        self.clock_drift_ms = 0.0

    # -- accumulation ----------------------------------------------------

    def observe(self, exchange_ts_ns: int, local_recv_ts_ns: int,
                duplicate: bool = False, crossed: bool = False) -> None:
        self.messages += 1
        if duplicate:
            self.duplicates += 1
        if crossed:
            self.crossed_book_incidents += 1
        self._transits_ms.append((local_recv_ts_ns - exchange_ts_ns) / 1e6)
        if self._last_event_ns is not None:
            quiet = (local_recv_ts_ns - self._last_event_ns) / 1e9
            self.max_quiet_s = max(self.max_quiet_s, quiet)
        self._last_event_ns = local_recv_ts_ns

    def observe_gap(self, duration_s: float = 0.0) -> None:
        self.sequence_gaps += 1
        self.gap_duration_s += duration_s

    def observe_trade_consistency(self, inside_book: bool) -> None:
        self.trades_checked += 1
        if not inside_book:
            self.trades_outside_book += 1

    def observe_clock_drift(self, drift_ms: float) -> None:
        self.clock_drift_ms = max(self.clock_drift_ms, abs(drift_ms))

    # -- grading ---------------------------------------------------------

    def _percentile(self, values: List[float], pct: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        # Nearest-rank. With few samples this is honest about its own
        # resolution rather than interpolating a number no sample supports.
        k = max(0, min(len(ordered) - 1, int(round(pct / 100.0 * len(ordered) + 0.5)) - 1))
        return ordered[k]

    def measurements(self) -> Dict[str, float]:
        return {
            "sequence_gaps": float(self.sequence_gaps),
            "gap_duration_s": self.gap_duration_s,
            "duplicate_rate": (self.duplicates / self.messages) if self.messages else 0.0,
            "crossed_book_incidents": float(self.crossed_book_incidents),
            "max_quiet_s": self.max_quiet_s,
            "transit_p99_ms": self._percentile(self._transits_ms, 99),
            "clock_drift_ms": self.clock_drift_ms,
            "trade_book_inconsistency": (
                self.trades_outside_book / self.trades_checked if self.trades_checked else 0.0
            ),
        }

    def close_day(self, date: str) -> DailyQualityReport:
        m = self.measurements()
        grades = {k: THRESHOLDS[k].grade(v) for k, v in m.items()}

        escalated: List[str] = []
        for check, g in grades.items():
            if g == QualityGrade.AMBER:
                self._amber_streak[check] = self._amber_streak.get(check, 0) + 1
                if self._amber_streak[check] >= self.amber_escalation_days:
                    grades[check] = QualityGrade.RED
                    escalated.append(check)
            else:
                self._amber_streak[check] = 0

        report = DailyQualityReport(
            date=date,
            venue=self.venue,
            stream=self.stream,
            measurements=m,
            grades=grades,
            grade=QualityGrade.worst(grades.values()),
            escalated=tuple(escalated),
        )
        self.reset()
        return report

    # -- live use --------------------------------------------------------

    def live_kill_conditions(self) -> List[str]:
        """Red conditions read in real time, for the kill switch (SPEC 8.3).

        Same measurements, different consumer. A red day is a research
        exclusion in hindsight and a reason to stop trading right now.
        """
        m = self.measurements()
        return [
            name for name in ("max_quiet_s", "transit_p99_ms", "clock_drift_ms", "crossed_book_incidents")
            if THRESHOLDS[name].grade(m[name]) == QualityGrade.RED
        ]
