import numpy as np
import pandas as pd

from stockselector.config import FACTORS, GoalProfile
from stockselector.data.base import MarketData
from stockselector.scoring import MIN_HISTORY_DAYS, raw_metrics, score_universe
from stockselector.selector import select_stocks


def test_scores_are_per_exchange_zscores(md, profile):
    table = score_universe(md, profile)
    for ex, grp in table.groupby("exchange"):
        for f in FACTORS:
            assert abs(grp[f].mean()) < 0.6  # roughly centred (means of averaged z's)
    assert table["composite"].notna().all()
    assert table["rank_in_exchange"].min() == 1


def test_objective_changes_ranking(md):
    growth = score_universe(md, GoalProfile(objective="growth"))
    income = score_universe(md, GoalProfile(objective="income"))
    top_g = growth[growth.exchange == "NYSE"].head(5).index
    top_i = income[income.exchange == "NYSE"].head(5).index
    assert set(top_g) != set(top_i)
    # income picks should carry a higher average dividend yield
    assert income.loc[top_i, "dividend_yield"].mean() > growth.loc[top_g, "dividend_yield"].mean()


def test_selector_respects_counts_and_sector_limits(md):
    p = GoalProfile(picks_per_exchange=6)
    sel = select_stocks(md, p)
    for ex in ("NGX", "NYSE"):
        assert len(sel.picks[ex]) == 6
        sectors = sel.scores.loc[sel.picks[ex], "sector"].value_counts()
        assert sectors.max() <= 3  # ceil(0.4 * 6)


def test_selector_scopes_exchanges(md):
    only_ngx = select_stocks(md, GoalProfile(ngx_weight_range=(1.0, 1.0)))
    only_nyse = select_stocks(md, GoalProfile(ngx_weight_range=(0.0, 0.0)))
    assert "NYSE" not in only_ngx.picks and only_ngx.picks["NGX"]
    assert "NGX" not in only_nyse.picks and only_nyse.picks["NYSE"]


def test_range_proxy_when_history_is_short(md):
    short = MarketData(prices=md.prices.tail(MIN_HISTORY_DAYS - 10), fundamentals=md.fundamentals,
                       fx_usdngn=md.fx_usdngn, is_sample=True)
    raw = raw_metrics(short)
    assert raw["range_proxy"].all()
    assert raw["volatility"].notna().all()
    assert raw["mom_12_1"].between(-1, 1).all()
    table = score_universe(short, GoalProfile())
    assert table["composite"].notna().all()


def test_illiquid_names_are_ineligible(md):
    f = md.fundamentals.copy()
    sym = md.symbols("NYSE")[0]
    f.loc[sym, "avg_daily_value"] = 1.0
    thin = MarketData(prices=md.prices, fundamentals=f, fx_usdngn=md.fx_usdngn, is_sample=True)
    table = score_universe(thin, GoalProfile())
    assert not table.at[sym, "eligible"]
    assert sym not in select_stocks(thin, GoalProfile()).symbols
