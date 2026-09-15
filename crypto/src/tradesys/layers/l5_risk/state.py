"""Portfolio state as the risk service sees it.

One definition of equity, used everywhere (SPEC section 12.1). Two definitions
in one system means two different drawdown numbers and an argument during an
incident.

The state **persists**: a risk service that forgets today's losses on restart
converts a restart into a limit bypass, and that bypass is available to anyone
who can cause a crash (Annex D section 5).
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field, asdict
from decimal import Decimal
from pathlib import Path
from typing import Dict, Mapping, Optional, Tuple

from ...core.events import Position
from ...core.types import Decimal as Dec, dec

__all__ = ["PortfolioState"]


@dataclass
class PortfolioState:
    """Mutable, persisted, and the single source for every limit computation."""

    cash: Dec = dec(0)
    unrealised: Dec = dec(0)
    accrued_funding: Dec = dec(0)
    accrued_borrow: Dec = dec(0)

    #: Peak equity ever seen, for the drawdown ladder.
    peak_equity: Dec = dec(0)
    #: Equity at the start of the current UTC day / ISO week.
    day_start_equity: Dec = dec(0)
    week_start_equity: Dec = dec(0)
    current_day: str = ""
    current_week: str = ""

    positions: Dict[Tuple[str, str], Position] = field(default_factory=dict)
    venue_capital: Dict[str, Dec] = field(default_factory=dict)
    consecutive_rejects: Dict[str, int] = field(default_factory=dict)
    disabled_strategies: set = field(default_factory=set)
    median_order_notional: Dec = dec(0)

    # -- equity ----------------------------------------------------------

    @property
    def equity(self) -> Dec:
        """cash + unrealised + accrued funding - accrued borrow."""
        return self.cash + self.unrealised + self.accrued_funding - self.accrued_borrow

    def mark(self) -> None:
        """Update the running peak. Call after any equity change."""
        e = self.equity
        if e > self.peak_equity:
            self.peak_equity = e
        if self.day_start_equity == 0:
            self.day_start_equity = e
        if self.week_start_equity == 0:
            self.week_start_equity = e

    @property
    def drawdown(self) -> Dec:
        """Peak-to-trough fraction. Zero at a new high."""
        if self.peak_equity <= 0:
            return dec(0)
        dd = (self.peak_equity - self.equity) / self.peak_equity
        return dd if dd > 0 else dec(0)

    @property
    def daily_loss(self) -> Dec:
        if self.day_start_equity <= 0:
            return dec(0)
        loss = (self.day_start_equity - self.equity) / self.day_start_equity
        return loss if loss > 0 else dec(0)

    @property
    def weekly_loss(self) -> Dec:
        if self.week_start_equity <= 0:
            return dec(0)
        loss = (self.week_start_equity - self.equity) / self.week_start_equity
        return loss if loss > 0 else dec(0)

    def roll_day(self, day: str) -> None:
        self.current_day = day
        self.day_start_equity = self.equity

    def roll_week(self, week: str) -> None:
        self.current_week = week
        self.week_start_equity = self.equity

    # -- exposure --------------------------------------------------------

    @property
    def gross_notional(self) -> Dec:
        return sum((p.notional for p in self.positions.values()), dec(0))

    @property
    def gross_exposure(self) -> Dec:
        """Gross notional as a multiple of equity."""
        e = self.equity
        return self.gross_notional / e if e > 0 else dec(0)

    def position(self, venue: str, symbol: str) -> Optional[Position]:
        return self.positions.get((venue, symbol))

    def position_qty(self, venue: str, symbol: str) -> Dec:
        p = self.positions.get((venue, symbol))
        return p.quantity if p else dec(0)

    def asset_concentration(self, symbol: str) -> Dec:
        """One symbol's share of gross book."""
        gross = self.gross_notional
        if gross <= 0:
            return dec(0)
        same = sum((p.notional for (v, s), p in self.positions.items() if s == symbol), dec(0))
        return same / gross

    def venue_share(self, venue: str) -> Dec:
        total = sum(self.venue_capital.values(), dec(0))
        if total <= 0:
            return dec(0)
        return self.venue_capital.get(venue, dec(0)) / total

    # -- persistence -----------------------------------------------------

    def to_json(self) -> str:
        payload = {
            "cash": str(self.cash),
            "unrealised": str(self.unrealised),
            "accrued_funding": str(self.accrued_funding),
            "accrued_borrow": str(self.accrued_borrow),
            "peak_equity": str(self.peak_equity),
            "day_start_equity": str(self.day_start_equity),
            "week_start_equity": str(self.week_start_equity),
            "current_day": self.current_day,
            "current_week": self.current_week,
            "consecutive_rejects": dict(self.consecutive_rejects),
            "disabled_strategies": sorted(self.disabled_strategies),
            "median_order_notional": str(self.median_order_notional),
        }
        return json.dumps(payload, indent=2, sort_keys=True)

    @classmethod
    def from_json(cls, text: str) -> "PortfolioState":
        d = json.loads(text)
        st = cls(
            cash=dec(d["cash"]),
            unrealised=dec(d["unrealised"]),
            accrued_funding=dec(d["accrued_funding"]),
            accrued_borrow=dec(d["accrued_borrow"]),
            peak_equity=dec(d["peak_equity"]),
            day_start_equity=dec(d["day_start_equity"]),
            week_start_equity=dec(d["week_start_equity"]),
            current_day=d.get("current_day", ""),
            current_week=d.get("current_week", ""),
            median_order_notional=dec(d.get("median_order_notional", "0")),
        )
        st.consecutive_rejects = dict(d.get("consecutive_rejects", {}))
        st.disabled_strategies = set(d.get("disabled_strategies", []))
        return st

    def save(self, path: str | Path) -> None:
        Path(path).write_text(self.to_json(), encoding="utf-8")

    @classmethod
    def load(cls, path: str | Path) -> "PortfolioState":
        return cls.from_json(Path(path).read_text(encoding="utf-8"))
