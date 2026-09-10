import numpy as np
import pandas as pd
import pytest

from stockselector.allocator import allocate, project, to_lots
from stockselector.allocator.goals import CASH, cash_cap_for
from stockselector.allocator.optimizer import Constraints, optimise
from stockselector.allocator.risk import build_risk_model
from stockselector.config import GoalProfile
from stockselector.selector import select_stocks


def _alloc(md, **kw):
    p = GoalProfile(**{"budget": 5_000_000, "base_currency": "NGN", **kw})
    return p, allocate(md, p, select_stocks(md, p))


def test_weights_sum_to_one_and_respect_bounds(md, profile):
    alloc = allocate(md, profile, select_stocks(md, profile))
    w = alloc.weights
    assert abs(w.sum() - 1) < 1e-6
    assert (w >= -1e-9).all()
    assert (w.drop(CASH, errors="ignore") <= profile.max_weight_per_stock + 1e-6).all()
    assert w.get(CASH, 0) <= cash_cap_for(profile) + 1e-6


def test_exchange_range_and_sector_cap(md):
    p, alloc = _alloc(md, ngx_weight_range=(0.3, 0.5), max_weight_per_sector=0.3)
    split = alloc.exchange_split()
    risky = 1 - split.get("CASH", 0.0)
    assert 0.3 * risky - 1e-4 <= split["NGX"] <= 0.5 * risky + 1e-4
    assert alloc.sector_split().drop("Cash", errors="ignore").max() <= 0.3 + 1e-4


def test_volatility_ceiling_holds(md):
    for risk in (1, 3, 5):
        p, alloc = _alloc(md, risk_tolerance=risk, objective="growth")
        assert alloc.volatility <= p.max_volatility + 1e-4, risk


def test_risk_tolerance_monotone(md):
    vols = [_alloc(md, risk_tolerance=r, objective="growth")[1].volatility for r in (1, 3, 5)]
    assert vols[0] <= vols[1] + 1e-6 <= vols[2] + 1e-6


def test_income_objective_yields_more(md):
    inc = _alloc(md, objective="income")[1].income_yield
    gro = _alloc(md, objective="growth")[1].income_yield
    assert inc > gro


def test_preservation_is_low_vol(md):
    pres = _alloc(md, objective="preservation")[1].volatility
    gro = _alloc(md, objective="growth", risk_tolerance=5)[1].volatility
    assert pres < gro


def test_unreachable_target_is_reported_not_fatal(md):
    p, alloc = _alloc(md, target_amount=50_000_000, horizon_years=2, risk_tolerance=1)
    assert alloc.result.feasible
    assert any("not reachable" in n or "needs" in n for n in alloc.notes)


def test_nyse_only_and_ngx_only(md):
    p, a = _alloc(md, ngx_weight_range=(0.0, 0.0), base_currency="USD", budget=50_000)
    assert "NGX" not in a.exchange_split().index
    p, b = _alloc(md, ngx_weight_range=(1.0, 1.0))
    assert "NYSE" not in b.exchange_split().index


def test_lots_within_budget(md, profile):
    alloc = allocate(md, profile, select_stocks(md, profile))
    lots = alloc.lots
    assert lots.invested_base <= profile.budget + 1e-6
    assert lots.cash_base >= lots.cash_sleeve_base - 1e-6
    assert (lots.orders["shares"] >= 0).all()
    assert (lots.orders["shares"] % lots.orders["lot"] == 0).all()
    assert np.allclose(lots.orders["cost_base"], lots.orders["shares"] * lots.orders["price_base"])


def test_lot_size_is_respected(md):
    p = GoalProfile(budget=50_000_000, base_currency="NGN")
    alloc = allocate(md, p, select_stocks(md, p), lot_size={"NGX": 100})
    ngx = alloc.lots.orders[alloc.lots.orders.exchange == "NGX"]
    assert (ngx["shares"] % 100 == 0).all()


def test_optimiser_min_return_constraint():
    mu = pd.Series({"A": 0.05, "B": 0.15})
    cov = pd.DataFrame([[0.01, 0.0], [0.0, 0.09]], index=["A", "B"], columns=["A", "B"])
    cons = Constraints(lower=pd.Series(0.0, index=mu.index), upper=pd.Series(1.0, index=mu.index), min_return=0.10)
    res = optimise(mu, cov, "min_vol", cons)
    assert res.feasible and abs(res.weights["B"] - 0.5) < 1e-3


def test_risk_model_is_psd_and_in_bounds(md, profile):
    syms = md.symbols("NGX")[:5] + md.symbols("NYSE")[:5]
    rm = build_risk_model(md, profile, syms)
    eig = np.linalg.eigvalsh(rm.cov.values)
    assert eig.min() > -1e-10
    assert rm.mu.between(-0.10, 0.60).all()
    assert (rm.vol > 0).all()


def test_projection_probabilities():
    p = project(100, 0.10, 0.20, 5, target_amount=120)
    assert 0 < p.prob_target < 1
    assert p.p10[-1] < p.p50[-1] < p.p90[-1]
    assert p.p50[0] == 100
