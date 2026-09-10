"""Deterministic synthetic market data for offline runs, demos and tests.

Nothing here is a real quote. Prices are simulated with a geometric random walk
whose drift, volatility and correlation are set by sector so that the numbers
*behave* like an equity market, and fundamentals are drawn from sector-typical
ranges. Every output produced from it is stamped ``SAMPLE DATA``.
"""
from __future__ import annotations

import hashlib
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..universe import Listing, load_universe
from .base import MarketData, normalise_fundamentals

# (annual drift, annual vol, typical PE, typical div yield, typical ROE, typical margin, D/E)
_SECTOR_PRIORS_USD = {
    "default":                (0.08, 0.24, 20, 0.020, 0.15, 0.12, 0.8),
    "Technology":             (0.13, 0.30, 30, 0.008, 0.28, 0.22, 0.5),
    "Healthcare":             (0.09, 0.22, 22, 0.020, 0.18, 0.15, 0.7),
    "Financial Services":     (0.09, 0.26, 13, 0.025, 0.13, 0.25, 1.5),
    "Energy":                 (0.07, 0.30, 11, 0.040, 0.14, 0.10, 0.4),
    "Consumer Staples":       (0.07, 0.17, 22, 0.030, 0.25, 0.10, 1.2),
    "Consumer Discretionary": (0.10, 0.28, 24, 0.012, 0.20, 0.08, 1.0),
    "Industrials":            (0.09, 0.24, 20, 0.018, 0.18, 0.10, 1.0),
    "Utilities":              (0.05, 0.16, 18, 0.040, 0.10, 0.12, 1.4),
    "Real Estate":            (0.05, 0.22, 35, 0.045, 0.06, 0.25, 1.1),
    "Materials":              (0.08, 0.27, 16, 0.025, 0.12, 0.10, 0.6),
    "Communication Services": (0.05, 0.20, 12, 0.055, 0.12, 0.13, 1.3),
}
# NGX priors are in nominal naira terms (high nominal drift and vol).
_SECTOR_PRIORS_NGN = {
    "default":                 (0.25, 0.45, 9,  0.050, 0.18, 0.12, 0.8),
    "Financial Services":      (0.30, 0.50, 4,  0.090, 0.25, 0.30, 2.0),
    "Industrial Goods":        (0.28, 0.40, 14, 0.035, 0.30, 0.25, 0.7),
    "ICT":                     (0.22, 0.42, 12, 0.060, 0.40, 0.20, 1.5),
    "Oil & Gas":               (0.35, 0.55, 8,  0.050, 0.20, 0.15, 0.6),
    "Consumer Goods":          (0.20, 0.42, 18, 0.025, 0.15, 0.08, 1.2),
    "Agriculture":             (0.40, 0.50, 7,  0.045, 0.35, 0.30, 0.3),
    "Utilities":               (0.25, 0.45, 15, 0.060, 0.30, 0.20, 1.0),
    "Conglomerates":           (0.30, 0.55, 10, 0.020, 0.12, 0.10, 1.1),
    "Construction/Real Estate": (0.22, 0.45, 11, 0.030, 0.15, 0.06, 0.9),
    "Services":                (0.28, 0.48, 12, 0.040, 0.20, 0.12, 0.7),
    "Healthcare":              (0.18, 0.40, 15, 0.020, 0.12, 0.08, 0.8),
}


def _seed(symbol: str, salt: str = "") -> int:
    return int(hashlib.sha256(f"{symbol}:{salt}".encode()).hexdigest()[:8], 16)


def _simulate_panel(listings: list[Listing], days: int, seed: int) -> pd.DataFrame:
    """One-factor + sector-factor GBM simulation, calendar of business days."""
    rng = np.random.default_rng(seed)
    idx = pd.bdate_range(end=pd.Timestamp("2026-09-08"), periods=days)
    market = rng.standard_normal(days)
    sectors = sorted({l.sector for l in listings})
    sector_shock = {s: rng.standard_normal(days) for s in sectors}
    cols = {}
    for lst in listings:
        priors = _SECTOR_PRIORS_NGN if lst.currency == "NGN" else _SECTOR_PRIORS_USD
        mu, sigma, *_ = priors.get(lst.sector, priors["default"])
        r = np.random.default_rng(_seed(lst.symbol, "path"))
        mu *= r.uniform(0.4, 1.6)
        sigma *= r.uniform(0.7, 1.4)
        idio = r.standard_normal(days)
        # Factor loadings: ~55% market, ~25% sector, rest idiosyncratic
        z = 0.55 * market + 0.30 * sector_shock[lst.sector] + 0.55 * idio
        z /= np.sqrt(0.55**2 + 0.30**2 + 0.55**2)
        daily = (mu - 0.5 * sigma**2) / 252 + sigma / np.sqrt(252) * z
        start = r.uniform(5, 3000) if lst.currency == "NGN" else r.uniform(20, 600)
        cols[lst.symbol] = start * np.exp(np.cumsum(daily))
    return pd.DataFrame(cols, index=idx)


def _simulate_fx(index: pd.DatetimeIndex, seed: int) -> pd.Series:
    rng = np.random.default_rng(seed)
    n = len(index)
    daily = 0.12 / 252 + 0.10 / np.sqrt(252) * rng.standard_normal(n)  # naira drifts weaker
    path = 1300.0 * np.exp(np.cumsum(daily))
    return pd.Series(path, index=index, name="USDNGN")


def _fundamentals(listings: list[Listing], prices: pd.DataFrame) -> pd.DataFrame:
    rows = {}
    as_of = prices.index[-1].strftime("%Y-%m-%d")
    for lst in listings:
        priors = _SECTOR_PRIORS_NGN if lst.currency == "NGN" else _SECTOR_PRIORS_USD
        _, _, pe0, dy0, roe0, pm0, de0 = priors.get(lst.sector, priors["default"])
        r = np.random.default_rng(_seed(lst.symbol, "fund"))
        s = prices[lst.symbol]
        price = float(s.iloc[-1])
        last_year = s.tail(252)
        shares = r.uniform(0.5e9, 40e9) if lst.currency == "NGN" else r.uniform(0.3e9, 8e9)
        adv_mult = r.uniform(0.0005, 0.004)
        rows[lst.symbol] = {
            "name": lst.name,
            "exchange": lst.exchange,
            "sector": lst.sector,
            "currency": lst.currency,
            "price": price,
            "market_cap": price * shares,
            "pe": max(3.0, pe0 * r.lognormal(0, 0.35)),
            "pb": max(0.3, r.lognormal(np.log(2.0), 0.5)),
            "roe": roe0 * r.uniform(0.4, 1.6),
            "profit_margin": pm0 * r.uniform(0.4, 1.6),
            "debt_to_equity": max(0.0, de0 * r.uniform(0.3, 1.8)),
            "dividend_yield": max(0.0, dy0 * r.uniform(0.0, 1.8)),
            "avg_daily_value": price * shares * adv_mult,
            "high_52w": float(last_year.max()),
            "low_52w": float(last_year.min()),
            "source": "sample",
            "as_of": as_of,
        }
    return normalise_fundamentals(pd.DataFrame.from_dict(rows, orient="index"))


def sample_market_data(exchanges: tuple[str, ...] = ("NGX", "NYSE"), days: int = 504,
                       seed: int = 42, listings: list[Listing] | None = None) -> MarketData:
    if listings is None:
        listings = []
        for ex in exchanges:
            listings.extend(load_universe(ex))
    prices = _simulate_panel(listings, days, seed)
    fx = _simulate_fx(prices.index, seed + 1)
    fundamentals = _fundamentals(listings, prices)
    last, prev = prices.iloc[-1], prices.iloc[-2]
    board = pd.DataFrame({
        "symbol": fundamentals.index, "name": fundamentals["name"], "exchange": fundamentals["exchange"],
        "sector": fundamentals["sector"], "currency": fundamentals["currency"], "price": fundamentals["price"],
        "pct_change": [(last[s] / prev[s] - 1) * 100 for s in fundamentals.index],
        "market_cap": fundamentals["market_cap"], "ytd_change": np.nan, "as_of": fundamentals["as_of"],
    })
    return MarketData(
        prices=prices,
        fundamentals=fundamentals,
        fx_usdngn=fx,
        warnings=["SAMPLE DATA: synthetic prices and fundamentals, not live market quotes."],
        is_sample=True,
        fetched_at=datetime.now(timezone.utc),
        board=board,
    )
