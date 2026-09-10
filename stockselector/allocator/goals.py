"""Translate a :class:`GoalProfile` into an optimisation problem."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import GoalProfile, Objective
from .optimizer import Constraints

CASH = "CASH"

#: Maximum cash / T-bill sleeve by risk tolerance.
_CASH_CAP = {1: 0.60, 2: 0.40, 3: 0.25, 4: 0.15, 5: 0.05}


def cash_cap_for(profile: GoalProfile) -> float:
    return _CASH_CAP[profile.risk_tolerance] if profile.allow_cash else 0.0


@dataclass
class Problem:
    objective: str
    constraints: Constraints
    risk_aversion: float
    diversification_penalty: float
    rationale: str


def build_problem(profile: GoalProfile, symbols: list[str], exchange: pd.Series, sector: pd.Series,
                  include_cash: bool) -> Problem:
    """Return the objective and constraint set that matches the profile."""
    syms = list(symbols) + ([CASH] if include_cash else [])
    n = len(syms)
    lower = pd.Series(profile.min_weight_per_stock, index=syms)
    upper = pd.Series(profile.max_weight_per_stock, index=syms)
    if include_cash:
        lower[CASH] = 0.0
        upper[CASH] = cash_cap_for(profile)

    groups: list[tuple[np.ndarray, float, float]] = []
    ex = np.array([exchange.get(s, "") for s in syms])
    ngx_mask = ex == "NGX"
    lo, hi = profile.ngx_weight_range
    if ngx_mask.any() and (~ngx_mask & (np.array(syms) != CASH)).any():
        groups.append((ngx_mask, lo, hi))
    sec = np.array([sector.get(s, "") for s in syms])
    for s_name in sorted(set(sec[np.array(syms) != CASH])):
        mask = sec == s_name
        if mask.sum() * profile.max_weight_per_stock > profile.max_weight_per_sector:
            groups.append((mask, 0.0, profile.max_weight_per_sector))

    # Risk aversion: 1 = very conservative ... 5 = aggressive.
    risk_aversion = {1: 8.0, 2: 5.0, 3: 3.0, 4: 2.0, 5: 1.2}[profile.risk_tolerance]
    cons = Constraints(lower=lower, upper=upper, groups=groups, max_vol=profile.max_volatility)
    if profile.target_income_yield:
        cons.min_income = float(profile.target_income_yield)
    required = profile.required_return
    if required is not None:
        cons.min_return = float(required)

    if profile.objective == Objective.GROWTH:
        return Problem("max_sharpe", cons, risk_aversion, 0.05,
                       "Growth: maximise risk-adjusted return (Sharpe) inside the volatility ceiling.")
    if profile.objective == Objective.INCOME:
        return Problem("max_income", cons, risk_aversion, 0.05,
                       "Income: maximise portfolio dividend yield with a return/volatility trade-off.")
    if profile.objective == Objective.PRESERVATION:
        cons.min_return = max(cons.min_return or 0.0, profile.cash_rate + 0.01)
        return Problem("min_vol", cons, risk_aversion, 0.0,
                       "Preservation: minimise volatility while beating cash by at least 1%.")
    return Problem("max_utility", cons, risk_aversion, 0.15,
                   "Balanced: maximise return net of a risk charge, with a diversification bonus.")
