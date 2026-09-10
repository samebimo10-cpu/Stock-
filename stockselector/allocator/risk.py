"""Expected returns and covariance in the investor's base currency.

The estimates deliberately lean on shrinkage: raw historical means are noisy,
so they are blended with a sector/exchange prior and tilted by the factor
composite. Covariance shrinks toward a constant-correlation target, and stocks
with too little history get structural estimates instead of sample ones.
"""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from ..config import BaseCurrency, GoalProfile
from ..data.base import MarketData
from ..scoring import MIN_HISTORY_DAYS

TRADING_DAYS = 252
#: Equity risk premium prior over the local cash rate, by exchange.
_ERP = {"NGX": 0.06, "NYSE": 0.05}
#: Annual nominal volatility prior when history is missing and no range is published.
_VOL_PRIOR = {"NGX": 0.40, "NYSE": 0.25}
#: Structural correlations used when sample correlations are unavailable.
_CORR_SAME_SECTOR, _CORR_SAME_EXCHANGE, _CORR_CROSS = 0.55, 0.30, 0.15
_CORR_FX_CROSS_NGN = 0.35  # NYSE names held in NGN all share the USD/NGN move
#: How far historical means are pulled toward the prior (0 = trust history fully).
_MEAN_SHRINK = 0.6
#: Composite z-score tilt: +/- this per unit of z, capped at |z| <= 2.
_SCORE_TILT = 0.02
_EXPECTED_RETURN_BOUNDS = (-0.10, 0.60)


@dataclass
class RiskModel:
    mu: pd.Series          # annual expected return, base currency
    cov: pd.DataFrame      # annual covariance, base currency
    exchange: pd.Series    # symbol -> exchange
    sector: pd.Series      # symbol -> sector
    dividend_yield: pd.Series
    history_days: pd.Series
    base_currency: str

    @property
    def symbols(self) -> list[str]:
        return list(self.mu.index)

    @property
    def vol(self) -> pd.Series:
        return pd.Series(np.sqrt(np.diag(self.cov.values)), index=self.cov.index)


def _local_cash(profile: GoalProfile, exchange: str) -> float:
    return profile.cash_rate_ngn if exchange == "NGX" else profile.cash_rate_usd


def _fx_drift(profile: GoalProfile, asset_exchange: str) -> float:
    """Expected FX carry when the asset's currency differs from the base currency.

    Uncovered interest parity: the high-rate currency is expected to depreciate
    by the rate differential, so a USD asset held in NGN earns roughly the
    NGN-USD rate gap on top of its USD return, and vice versa.
    """
    asset_ccy = "NGN" if asset_exchange == "NGX" else "USD"
    if asset_ccy == profile.base_currency.value:
        return 0.0
    diff = profile.cash_rate_ngn - profile.cash_rate_usd
    return diff if profile.base_currency == BaseCurrency.NGN else -diff


def build_risk_model(md: MarketData, profile: GoalProfile, symbols: list[str],
                     composite: pd.Series | None = None) -> RiskModel:
    symbols = [s for s in symbols if s in md.fundamentals.index]
    f = md.fundamentals.loc[symbols]
    base = profile.base_currency.value
    prices = md.prices_in(base)
    prices = prices[[s for s in symbols if s in prices.columns]]
    rets = np.log(prices).diff().iloc[1:] if not prices.empty else pd.DataFrame(index=[], columns=symbols)

    hist_days = pd.Series({s: int(rets[s].dropna().shape[0]) if s in rets.columns else 0 for s in symbols})
    enough = hist_days >= MIN_HISTORY_DAYS

    # ------------------------------------------------------------ expected return
    mu = pd.Series(index=symbols, dtype=float)
    for s in symbols:
        ex = str(f.at[s, "exchange"])
        prior = _local_cash(profile, ex) + _ERP.get(ex, 0.05) + _fx_drift(profile, ex)
        if enough[s]:
            r = rets[s].dropna()
            hist = float(r.mean() * TRADING_DAYS + 0.5 * r.var(ddof=1) * TRADING_DAYS)  # arithmetic
            m = _MEAN_SHRINK * prior + (1 - _MEAN_SHRINK) * hist
        else:
            m = prior
        if composite is not None and s in composite.index:
            m += _SCORE_TILT * float(np.clip(composite[s], -2, 2))
        mu[s] = float(np.clip(m, *_EXPECTED_RETURN_BOUNDS))

    # ------------------------------------------------------------ covariance
    # 1. Sample covariance where history exists, pairwise-complete.
    sample_cov = rets.cov(min_periods=MIN_HISTORY_DAYS) * TRADING_DAYS if not rets.empty else pd.DataFrame()
    # 2. Per-stock vol: sample if enough data, else range proxy, else prior.
    vol = pd.Series(index=symbols, dtype=float)
    fx_vol = float(np.log(md.fx_usdngn).diff().dropna().std(ddof=1) * np.sqrt(TRADING_DAYS)) if md.fx_usdngn.shape[0] > 30 else 0.10
    for s in symbols:
        ex = str(f.at[s, "exchange"])
        if enough[s] and s in sample_cov.index and sample_cov.at[s, s] == sample_cov.at[s, s]:
            vol[s] = float(np.sqrt(sample_cov.at[s, s]))
        else:
            hi, lo = f.at[s, "high_52w"], f.at[s, "low_52w"]
            if hi == hi and lo == lo and hi > lo > 0:
                v = float(np.log(hi / lo) / (2 * np.sqrt(np.log(2))))
            else:
                v = _VOL_PRIOR.get(ex, 0.30)
            if _fx_drift(profile, ex) != 0.0:       # cross-currency: add FX variance
                v = float(np.sqrt(v**2 + fx_vol**2))
            vol[s] = v
    # 3. Correlation: sample where both have data, structural otherwise.
    n = len(symbols)
    corr = np.eye(n)
    for i, a in enumerate(symbols):
        for j in range(i + 1, n):
            b = symbols[j]
            c = np.nan
            if enough[a] and enough[b] and a in sample_cov.index and b in sample_cov.index:
                cab = sample_cov.at[a, b]
                if cab == cab and vol[a] > 0 and vol[b] > 0:
                    c = float(cab / (np.sqrt(sample_cov.at[a, a]) * np.sqrt(sample_cov.at[b, b])))
            if c != c:
                ea, eb = str(f.at[a, "exchange"]), str(f.at[b, "exchange"])
                if ea == eb:
                    c = _CORR_SAME_SECTOR if str(f.at[a, "sector"]) == str(f.at[b, "sector"]) else _CORR_SAME_EXCHANGE
                    if ea == "NYSE" and base == "NGN":
                        c = max(c, _CORR_FX_CROSS_NGN)
                else:
                    c = _CORR_CROSS
            corr[i, j] = corr[j, i] = float(np.clip(c, -0.95, 0.95))
    # 4. Shrink toward constant correlation (Ledoit-Wolf style, fixed intensity
    #    that grows when the panel is short).
    avg_days = float(hist_days[enough].mean()) if enough.any() else 0.0
    intensity = float(np.clip(0.25 + 0.5 * max(0.0, 1 - avg_days / TRADING_DAYS), 0.25, 0.75))
    off = corr[~np.eye(n, dtype=bool)]
    target = np.full((n, n), float(off.mean()) if off.size else 0.3)
    np.fill_diagonal(target, 1.0)
    corr = (1 - intensity) * corr + intensity * target
    cov = np.outer(vol.values, vol.values) * corr
    # Ensure positive semi-definite.
    w_, v_ = np.linalg.eigh(cov)
    cov = (v_ * np.clip(w_, 1e-8, None)) @ v_.T
    cov_df = pd.DataFrame(cov, index=symbols, columns=symbols)

    return RiskModel(
        mu=mu, cov=cov_df,
        exchange=f["exchange"].astype(str), sector=f["sector"].astype(str),
        dividend_yield=f["dividend_yield"].fillna(0.0).astype(float),
        history_days=hist_days, base_currency=base,
    )
