"""End-to-end allocation: risk model -> goal problem -> optimiser -> lots -> projection."""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from ..config import GoalProfile
from ..data.base import MarketData
from ..selector import Selection
from .goals import CASH, Problem, build_problem, cash_cap_for
from .lots import LotPlan, to_lots
from .optimizer import Constraints, OptResult, optimise
from .projection import Projection, project
from .risk import RiskModel, build_risk_model


@dataclass
class Allocation:
    weights: pd.Series                 # includes CASH when used
    risk: RiskModel
    problem: Problem
    result: OptResult
    lots: LotPlan
    projection: Projection
    backtest: pd.DataFrame             # historical value of the mix (base currency), if any
    notes: list[str] = field(default_factory=list)
    cash_rate: float = 0.0

    # ----------------------------------------------------------------- stats
    @property
    def expected_return(self) -> float:
        return self.result.expected_return

    @property
    def volatility(self) -> float:
        return self.result.volatility

    def sharpe(self, rf: float) -> float:
        return (self.expected_return - rf) / self.volatility if self.volatility > 0 else float("nan")

    @property
    def income_yield(self) -> float:
        dy = self.risk.dividend_yield.reindex(self.weights.index).fillna(0.0)
        return float((self.weights * dy).sum())

    def exchange_split(self) -> pd.Series:
        ex = self.risk.exchange.reindex(self.weights.index).fillna("CASH")
        return self.weights.groupby(ex).sum().sort_values(ascending=False)

    def sector_split(self) -> pd.Series:
        sec = self.risk.sector.reindex(self.weights.index).fillna("Cash")
        return self.weights.groupby(sec).sum().sort_values(ascending=False)

    def risk_contribution(self) -> pd.Series:
        syms = [s for s in self.weights.index if s != CASH]
        w = self.weights.reindex(syms).values
        C = self.risk.cov.loc[syms, syms].values
        var = float(w @ C @ w)
        if var <= 0:
            return pd.Series(0.0, index=syms)
        rc = w * (C @ w) / var
        return pd.Series(rc, index=syms).sort_values(ascending=False)

    def table(self) -> pd.DataFrame:
        rows = []
        for s, w in self.weights.items():
            if w <= 0:
                continue
            if s == CASH:
                rows.append({"symbol": CASH, "exchange": "-", "sector": "Cash / T-bills", "weight": w,
                             "exp_return": self.cash_rate, "volatility": 0.0, "dividend_yield": self.cash_rate})
            else:
                rows.append({"symbol": s, "exchange": self.risk.exchange[s], "sector": self.risk.sector[s],
                             "weight": w, "exp_return": self.risk.mu[s], "volatility": self.risk.vol[s],
                             "dividend_yield": self.risk.dividend_yield[s]})
        return pd.DataFrame(rows).sort_values("weight", ascending=False).reset_index(drop=True)


def _with_cash(risk: RiskModel, cash_rate: float) -> tuple[pd.Series, pd.DataFrame, pd.Series]:
    mu = pd.concat([risk.mu, pd.Series({CASH: cash_rate})])
    cov = risk.cov.copy()
    cov.loc[CASH, :] = 0.0
    cov.loc[:, CASH] = 0.0
    cov.loc[CASH, CASH] = 1e-8
    inc = pd.concat([risk.dividend_yield, pd.Series({CASH: cash_rate})])
    return mu, cov.loc[mu.index, mu.index], inc


def allocate(md: MarketData, profile: GoalProfile, selection: Selection,
             lot_size: dict[str, int] | None = None) -> Allocation:
    symbols = selection.symbols
    if not symbols:
        raise ValueError("No stocks selected; cannot allocate.")
    composite = selection.scores["composite"] if "composite" in selection.scores else None
    risk = build_risk_model(md, profile, symbols, composite)
    include_cash = cash_cap_for(profile) > 0
    problem = build_problem(profile, risk.symbols, risk.exchange, risk.sector, include_cash)
    notes: list[str] = [problem.rationale]

    if include_cash:
        mu, cov, income = _with_cash(risk, profile.cash_rate)
        cash_index = list(mu.index).index(CASH)
    else:
        mu, cov, income, cash_index = risk.mu, risk.cov, risk.dividend_yield, None

    result = optimise(mu, cov, problem.objective, problem.constraints, rf=profile.cash_rate,
                      income=income, cash_index=cash_index, risk_aversion=problem.risk_aversion,
                      diversification_penalty=problem.diversification_penalty)

    # Relax goal-driven constraints one at a time if the problem is infeasible.
    if not result.feasible:
        cons = problem.constraints
        relaxed = []
        if cons.min_return is not None:
            relaxed.append("required return")
            cons.min_return = None
        if cons.min_income is not None and not result.feasible:
            relaxed.append("income target")
            cons.min_income = None
        retry = optimise(mu, cov, problem.objective, cons, rf=profile.cash_rate, income=income,
                         cash_index=cash_index, risk_aversion=problem.risk_aversion,
                         diversification_penalty=problem.diversification_penalty)
        if retry.feasible:
            result = retry
            if relaxed:
                notes.append("Goal not reachable inside your risk tolerance; dropped the "
                             + " and ".join(relaxed) + " constraint and solved for the best achievable mix.")
        else:
            cons.max_vol = None
            retry = optimise(mu, cov, "min_vol", cons, rf=profile.cash_rate, income=income, cash_index=cash_index)
            result = retry
            notes.append("Even the lowest-volatility mix breaches your volatility ceiling; showing the "
                         "minimum-volatility portfolio instead. Consider a lower budget share in equities.")

    req = profile.required_return
    if req is not None and result.expected_return < req - 1e-6:
        notes.append(f"Target of {profile.target_amount:,.0f} needs {req:.1%}/yr; this mix is expected to "
                     f"return {result.expected_return:.1%}/yr. Extend the horizon, raise the budget or accept more risk.")
    if profile.target_income_yield and (result.weights * income.reindex(result.weights.index)).sum() < profile.target_income_yield - 1e-6:
        notes.append("Income target not met by the eligible universe at this risk level.")

    weights = result.weights[result.weights > 0]
    lots = to_lots(weights, md.fundamentals, md.latest_fx(), profile.budget, profile.base_currency.value, lot_size)
    if lots.unaffordable:
        notes.append("Budget too small for even one lot of: " + ", ".join(lots.unaffordable)
                     + ". Increase the budget or use a broker that offers fractional shares.")
    projection = project(profile.budget, result.expected_return, result.volatility,
                         profile.horizon_years, profile.target_amount)
    backtest = _backtest(md, weights, profile)
    return Allocation(weights=weights, risk=risk, problem=problem, result=result, lots=lots,
                      projection=projection, backtest=backtest, notes=notes, cash_rate=profile.cash_rate)


def _backtest(md: MarketData, weights: pd.Series, profile: GoalProfile) -> pd.DataFrame:
    """Buy-and-hold value of the mix over the available price window, base currency."""
    syms = [s for s in weights.index if s != CASH and s in md.prices.columns]
    if not syms:
        return pd.DataFrame()
    px = md.prices_in(profile.base_currency.value)[syms].dropna(how="all")
    px = px.dropna(axis=1, thresh=int(0.8 * len(px))).ffill().dropna()
    if px.empty or px.shape[0] < 20:
        return pd.DataFrame()
    w = weights.reindex(px.columns).fillna(0.0)
    cash_w = float(weights.get(CASH, 0.0))
    rel = px / px.iloc[0]
    days = np.arange(len(px))
    cash_leg = cash_w * (1 + profile.cash_rate) ** (days / 252.0)
    equity_leg = (rel * w).sum(axis=1)
    value = (equity_leg + cash_leg) * profile.budget
    out = pd.DataFrame({"value": value})
    out["drawdown"] = out["value"] / out["value"].cummax() - 1
    return out
