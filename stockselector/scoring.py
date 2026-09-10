"""Multi-factor scoring.

Every stock gets six factor scores (value, quality, momentum, low_vol,
dividend, liquidity), each a cross-sectional z-score computed *within its
exchange* so that NGX and NYSE names are judged against their own peers. The
composite is the goal-weighted sum of those factor scores.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

from .config import FACTORS, GoalProfile
from .data.base import MarketData

#: Fewer price observations than this and price-based factors use range proxies.
MIN_HISTORY_DAYS = 60
#: Sample-size cushions: 12-month momentum needs about a year of data.
_LOOKBACK_12M, _LOOKBACK_6M, _SKIP_1M = 252, 126, 21


def _winsor_z(s: pd.Series, clip: float = 2.5) -> pd.Series:
    """Cross-sectional z-score, robust to outliers, NaNs treated as neutral (0)."""
    x = s.astype(float)
    valid = x.dropna()
    if valid.shape[0] < 3 or valid.std(ddof=0) == 0:
        return pd.Series(0.0, index=s.index)
    lo, hi = valid.quantile(0.02), valid.quantile(0.98)
    x = x.clip(lower=lo, upper=hi)
    z = (x - x.mean()) / (x.std(ddof=0) or 1.0)
    return z.clip(-clip, clip).fillna(0.0)


def raw_metrics(md: MarketData) -> pd.DataFrame:
    """Per-symbol raw inputs to the factors (local-currency price based)."""
    f = md.fundamentals
    out = pd.DataFrame(index=f.index)
    out["exchange"] = f["exchange"]
    out["sector"] = f["sector"]
    out["price"] = f["price"]

    # ---- valuation
    pe = f["pe"].where(f["pe"] > 0)
    out["earnings_yield"] = 1.0 / pe
    out.loc[f["pe"] < 0, "earnings_yield"] = -0.05  # loss-making: penalise, don't drop
    pb = f["pb"].where(f["pb"] > 0)
    out["book_yield"] = 1.0 / pb

    # ---- quality
    out["roe"] = f["roe"]
    out["profit_margin"] = f["profit_margin"]
    out["leverage"] = f["debt_to_equity"]

    # ---- price-based: momentum, volatility, drawdown
    mom12 = pd.Series(np.nan, index=f.index)
    mom6 = pd.Series(np.nan, index=f.index)
    vol = pd.Series(np.nan, index=f.index)
    mdd = pd.Series(np.nan, index=f.index)
    hist_days = pd.Series(0, index=f.index, dtype=int)
    proxy = pd.Series(False, index=f.index)
    for sym in f.index:
        s = md.prices[sym].dropna() if sym in md.prices.columns else pd.Series(dtype=float)
        n = int(s.shape[0])
        hist_days[sym] = n
        if n >= MIN_HISTORY_DAYS:
            r = np.log(s).diff().dropna()
            vol[sym] = float(r.tail(_LOOKBACK_12M).std(ddof=1) * np.sqrt(252))
            last = float(s.iloc[-1])
            if n > _LOOKBACK_6M:
                mom6[sym] = last / float(s.iloc[-1 - _LOOKBACK_6M]) - 1
            else:
                mom6[sym] = last / float(s.iloc[0]) - 1
            if n > _LOOKBACK_12M:
                mom12[sym] = float(s.iloc[-1 - _SKIP_1M]) / float(s.iloc[-1 - _LOOKBACK_12M]) - 1
            else:
                mom12[sym] = float(s.iloc[-1 - min(_SKIP_1M, n - 2)]) / float(s.iloc[0]) - 1
            w = s.tail(_LOOKBACK_12M)
            mdd[sym] = float((w / w.cummax() - 1).min())
        else:
            # Range proxies from the 52-week high/low published by the exchange boards.
            hi, lo, px = f.at[sym, "high_52w"], f.at[sym, "low_52w"], f.at[sym, "price"]
            if hi == hi and lo == lo and px == px and hi > 0 and lo > 0 and hi >= lo:
                proxy[sym] = True
                pos = (px - lo) / (hi - lo) if hi > lo else 0.5     # 0 = at low, 1 = at high
                mom12[sym] = pos * 2 - 1                               # map to [-1, 1]
                mom6[sym] = px / hi - 1                                # distance from high
                # Parkinson range estimator over ~1 year: sigma ≈ ln(H/L) / (2 sqrt(ln 2))
                vol[sym] = float(np.log(hi / lo) / (2 * np.sqrt(np.log(2))))
                mdd[sym] = float(px / hi - 1)
    out["mom_12_1"] = mom12
    out["mom_6"] = mom6
    out["volatility"] = vol
    out["max_drawdown"] = mdd
    out["history_days"] = hist_days
    out["range_proxy"] = proxy

    # ---- dividend, liquidity, size
    out["dividend_yield"] = f["dividend_yield"].fillna(0.0)
    out["avg_daily_value"] = f["avg_daily_value"]
    out["log_adv"] = np.log(f["avg_daily_value"].where(f["avg_daily_value"] > 0))
    out["log_mcap"] = np.log(f["market_cap"].where(f["market_cap"] > 0))
    return out


def factor_scores(raw: pd.DataFrame) -> pd.DataFrame:
    """Turn raw metrics into the six factor z-scores, per exchange."""
    parts = []
    for ex, grp in raw.groupby("exchange", sort=False):
        z = pd.DataFrame(index=grp.index)
        z["value"] = pd.concat([_winsor_z(grp["earnings_yield"]), _winsor_z(grp["book_yield"])], axis=1).mean(axis=1)
        z["quality"] = pd.concat([
            _winsor_z(grp["roe"]), _winsor_z(grp["profit_margin"]), -_winsor_z(grp["leverage"])
        ], axis=1).mean(axis=1)
        z["momentum"] = pd.concat([_winsor_z(grp["mom_12_1"]), _winsor_z(grp["mom_6"])], axis=1).mean(axis=1)
        z["low_vol"] = pd.concat([-_winsor_z(grp["volatility"]), _winsor_z(grp["max_drawdown"])], axis=1).mean(axis=1)
        z["dividend"] = _winsor_z(grp["dividend_yield"])
        z["liquidity"] = pd.concat([_winsor_z(grp["log_adv"]), _winsor_z(grp["log_mcap"])], axis=1).mean(axis=1)
        # Data coverage: share of the underlying inputs that were actually observed.
        inputs = ["earnings_yield", "book_yield", "roe", "profit_margin", "leverage",
                  "mom_12_1", "volatility", "dividend_yield", "avg_daily_value", "log_mcap"]
        z["coverage"] = grp[inputs].notna().mean(axis=1)
        parts.append(z)
    return pd.concat(parts) if parts else pd.DataFrame(columns=[*FACTORS, "coverage"])


def score_universe(md: MarketData, profile: GoalProfile) -> pd.DataFrame:
    """Full scoring table: raw metrics + factor z-scores + goal-weighted composite."""
    raw = raw_metrics(md)
    z = factor_scores(raw)
    weights = profile.factor_weights
    composite = sum(z[f] * w for f, w in weights.items())
    # Low coverage gets a small haircut so a stock with mostly-missing data
    # cannot float to the top on one lucky metric.
    composite = composite - 0.5 * (1.0 - z["coverage"])
    table = raw.join(z)
    table["composite"] = composite
    table["name"] = md.fundamentals["name"]
    table["market_cap"] = md.fundamentals["market_cap"]
    table["pe"] = md.fundamentals["pe"]
    table["currency"] = md.fundamentals["currency"]
    table["eligible"] = eligibility(md, profile)
    table["rank_in_exchange"] = (
        table.groupby("exchange")["composite"].rank(ascending=False, method="first").astype(int)
    )
    return table.sort_values(["exchange", "composite"], ascending=[True, False])


def eligibility(md: MarketData, profile: GoalProfile) -> pd.Series:
    f = md.fundamentals
    has_price = f["price"].notna() & (f["price"] > 0)
    adv = f["avg_daily_value"]
    threshold = np.where(f["currency"].str.upper() == "NGN",
                         profile.min_avg_daily_value_ngn, profile.min_avg_daily_value_usd)
    liquid = adv.isna() | (adv >= threshold)  # unknown liquidity is not a reason to exclude
    return (has_price & liquid).rename("eligible")
