"""Constrained portfolio optimisation with SciPy's SLSQP.

Weights are long-only and sum to one. Group constraints are linear
(exchange share, sector caps), the volatility ceiling and return floor are
quadratic/linear inequality constraints. Several starting points are tried and
the best feasible solution wins, which keeps the small problems here robust.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np
import pandas as pd
from scipy.optimize import minimize

OBJECTIVES = ("max_sharpe", "min_vol", "max_return", "risk_parity", "max_income", "max_utility")


@dataclass
class Constraints:
    lower: pd.Series                       # per-asset lower bound
    upper: pd.Series                       # per-asset upper bound
    #: (mask, min_share, max_share) linear group constraints on the *risky* sleeve,
    #: expressed relative to (1 - cash weight): sum(w[mask]) in [min, max] * (1 - w_cash)
    groups: list[tuple[np.ndarray, float, float]] = field(default_factory=list)
    max_vol: float | None = None
    min_return: float | None = None
    min_income: float | None = None


@dataclass
class OptResult:
    weights: pd.Series
    objective: str
    feasible: bool
    message: str
    expected_return: float
    volatility: float


def _portfolio_stats(w, mu, cov):
    ret = float(w @ mu)
    var = float(w @ cov @ w)
    return ret, float(np.sqrt(max(var, 1e-16)))


def optimise(mu: pd.Series, cov: pd.DataFrame, objective: str, cons: Constraints,
             rf: float = 0.0, income: pd.Series | None = None, cash_index: int | None = None,
             risk_aversion: float = 3.0, diversification_penalty: float = 0.0) -> OptResult:
    if objective not in OBJECTIVES:
        raise ValueError(f"objective must be one of {OBJECTIVES}")
    syms = list(mu.index)
    n = len(syms)
    m = mu.values.astype(float)
    C = cov.loc[syms, syms].values.astype(float)
    inc = income.reindex(syms).fillna(0.0).values.astype(float) if income is not None else np.zeros(n)
    lo = cons.lower.reindex(syms).fillna(0.0).values.astype(float)
    hi = cons.upper.reindex(syms).fillna(1.0).values.astype(float)
    hi = np.maximum(hi, lo)

    risky_mask = np.ones(n, dtype=bool)
    if cash_index is not None:
        risky_mask[cash_index] = False

    def risky_total(w):
        return float(w[risky_mask].sum())

    # ----- objective functions (all minimised)
    def f_max_sharpe(w):
        r, v = _portfolio_stats(w, m, C)
        return -(r - rf) / v + diversification_penalty * float(w @ w)

    def f_min_vol(w):
        return float(w @ C @ w)

    def f_max_return(w):
        return -float(w @ m) + diversification_penalty * float(w @ w)

    def f_risk_parity(w):
        wr = w * risky_mask
        var = float(wr @ C @ wr)
        if var <= 1e-14:
            return 0.0
        rc = wr * (C @ wr) / var
        k = int(risky_mask.sum())
        target = np.where(risky_mask, 1.0 / k, 0.0)
        return float(((rc - target) ** 2).sum()) * 1e3

    def f_max_income(w):
        r, v = _portfolio_stats(w, m, C)
        return -(float(w @ inc) + 0.35 * r - 0.5 * risk_aversion * v**2) + diversification_penalty * float(w @ w)

    def f_max_utility(w):
        r, v = _portfolio_stats(w, m, C)
        return -(r - 0.5 * risk_aversion * v**2) + diversification_penalty * float(w @ w)

    fn = {"max_sharpe": f_max_sharpe, "min_vol": f_min_vol, "max_return": f_max_return,
          "risk_parity": f_risk_parity, "max_income": f_max_income, "max_utility": f_max_utility}[objective]

    # ----- constraints
    constraints = [{"type": "eq", "fun": lambda w: float(w.sum()) - 1.0}]
    for mask, gmin, gmax in cons.groups:
        mask = np.asarray(mask, dtype=bool)
        if gmin > 0:
            constraints.append({"type": "ineq", "fun": lambda w, mk=mask, g=gmin: float(w[mk].sum()) - g * risky_total(w)})
        if gmax < 1:
            constraints.append({"type": "ineq", "fun": lambda w, mk=mask, g=gmax: g * risky_total(w) - float(w[mk].sum())})
    if cons.max_vol is not None:
        constraints.append({"type": "ineq", "fun": lambda w: cons.max_vol**2 - float(w @ C @ w)})
    if cons.min_return is not None:
        constraints.append({"type": "ineq", "fun": lambda w: float(w @ m) - cons.min_return})
    if cons.min_income is not None:
        constraints.append({"type": "ineq", "fun": lambda w: float(w @ inc) - cons.min_income})
    bounds = list(zip(lo, hi))

    # ----- starting points
    starts = []
    eq = np.clip(np.full(n, 1.0 / n), lo, hi)
    starts.append(eq / eq.sum())
    ivol = 1.0 / np.sqrt(np.diag(C) + 1e-12)
    if cash_index is not None:
        ivol[cash_index] = 0.0
    ivol = np.clip(ivol / ivol.sum(), lo, hi)
    starts.append(ivol / ivol.sum())
    top = np.zeros(n)
    top[np.argsort(-m)[: max(3, n // 3)]] = 1.0
    top = np.clip(top / top.sum(), lo, hi)
    starts.append(top / top.sum())

    best: OptResult | None = None
    for x0 in starts:
        try:
            res = minimize(fn, x0, method="SLSQP", bounds=bounds, constraints=constraints,
                           options={"maxiter": 500, "ftol": 1e-10})
        except Exception as exc:  # pragma: no cover
            continue
        w = np.clip(res.x, lo, hi)
        w = w / w.sum()
        feasible = _is_feasible(w, constraints, tol=1e-4)
        r, v = _portfolio_stats(w, m, C)
        cand = OptResult(pd.Series(w, index=syms), objective, feasible, str(res.message), r, v)
        if best is None:
            best = cand
        else:
            if cand.feasible and not best.feasible:
                best = cand
            elif cand.feasible == best.feasible and fn(w) < fn(best.weights.values):
                best = cand
    assert best is not None
    # Drop dust positions (< 1%) that no one would actually trade, then renormalise.
    best.weights[best.weights < 0.01] = 0.0
    best.weights /= best.weights.sum()
    best.expected_return, best.volatility = _portfolio_stats(best.weights.values, m, C)
    return best


def _is_feasible(w, constraints, tol) -> bool:
    for c in constraints:
        val = c["fun"](w)
        if c["type"] == "eq" and abs(val) > tol:
            return False
        if c["type"] == "ineq" and val < -tol:
            return False
    return True
