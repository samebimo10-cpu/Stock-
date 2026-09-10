"""Pick the best stocks per exchange, given a goal profile."""
from __future__ import annotations

import math
from dataclasses import dataclass, field

import pandas as pd

from .config import GoalProfile
from .data.base import MarketData
from .scoring import score_universe


@dataclass
class Selection:
    scores: pd.DataFrame                    # full scoring table (all symbols)
    picks: dict[str, list[str]]             # exchange -> chosen symbols
    notes: list[str] = field(default_factory=list)

    @property
    def symbols(self) -> list[str]:
        return [s for ex in ("NGX", "NYSE") for s in self.picks.get(ex, [])]

    def table(self) -> pd.DataFrame:
        return self.scores.loc[self.symbols]


def _exchanges_in_scope(profile: GoalProfile) -> list[str]:
    lo, hi = profile.ngx_weight_range
    out = []
    if hi > 0:
        out.append("NGX")
    if lo < 1:
        out.append("NYSE")
    return out


def select_stocks(md: MarketData, profile: GoalProfile, scores: pd.DataFrame | None = None) -> Selection:
    scores = score_universe(md, profile) if scores is None else scores
    picks: dict[str, list[str]] = {}
    notes: list[str] = []
    n = max(1, int(profile.picks_per_exchange))
    # Sector diversification at the pick stage: no more than ~40% of picks from one sector.
    max_per_sector = max(2, math.ceil(0.4 * n))

    for ex in _exchanges_in_scope(profile):
        pool = scores[(scores["exchange"] == ex) & scores["eligible"]].sort_values("composite", ascending=False)
        if pool.empty:
            notes.append(f"{ex}: no eligible stocks (check data or liquidity thresholds).")
            picks[ex] = []
            continue
        chosen: list[str] = []
        sector_count: dict[str, int] = {}
        for sym, row in pool.iterrows():
            sec = str(row["sector"])
            if sector_count.get(sec, 0) >= max_per_sector:
                continue
            chosen.append(sym)
            sector_count[sec] = sector_count.get(sec, 0) + 1
            if len(chosen) >= n:
                break
        if len(chosen) < n:
            notes.append(f"{ex}: only {len(chosen)} eligible stocks after sector limits (wanted {n}).")
        proxies = int(pool.loc[chosen, "range_proxy"].sum()) if chosen else 0
        if proxies:
            notes.append(f"{ex}: {proxies} pick(s) scored with 52-week range proxies (short price history).")
        picks[ex] = chosen
    return Selection(scores=scores, picks=picks, notes=notes)
