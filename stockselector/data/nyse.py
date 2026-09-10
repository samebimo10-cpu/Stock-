"""NYSE data from Yahoo Finance via the ``yfinance`` package (public, no key)."""
from __future__ import annotations

import logging
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..universe import Listing
from .base import normalise_fundamentals

log = logging.getLogger(__name__)


def _first(info: dict, *keys, default=np.nan):
    for k in keys:
        v = info.get(k)
        if v is not None and v == v:  # not None, not NaN
            return v
    return default


def _as_fraction(value) -> float:
    """Yahoo sometimes reports yields/margins in percent, sometimes as fractions."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return np.nan
    return v / 100.0 if abs(v) > 1.0 else v


def fetch_prices(symbols: list[str], period: str = "2y") -> pd.DataFrame:
    import yfinance as yf

    raw = yf.download(symbols, period=period, interval="1d", auto_adjust=True,
                      progress=False, group_by="column", threads=True)
    if raw is None or raw.empty:
        raise RuntimeError("Yahoo Finance returned no NYSE price data")
    if isinstance(raw.columns, pd.MultiIndex):
        close = raw["Close"]
    else:  # single symbol
        close = raw[["Close"]].rename(columns={"Close": symbols[0]})
    close = close.dropna(how="all")
    close.columns = [str(c).upper() for c in close.columns]
    close.index = pd.to_datetime(close.index).tz_localize(None)
    return close


def fetch_fundamentals(listings: list[Listing], prices: pd.DataFrame | None = None) -> pd.DataFrame:
    import yfinance as yf

    rows = {}
    now = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    for lst in listings:
        info: dict = {}
        try:
            info = yf.Ticker(lst.symbol).get_info() or {}
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("yfinance info failed for %s: %s", lst.symbol, exc)
        price = _first(info, "currentPrice", "regularMarketPrice", "previousClose")
        if (price is None or price != price) and prices is not None and lst.symbol in prices.columns:
            s = prices[lst.symbol].dropna()
            price = float(s.iloc[-1]) if not s.empty else np.nan
        avg_vol = _first(info, "averageDailyVolume3Month", "averageVolume", "averageVolume10days")
        de = _first(info, "debtToEquity")
        rows[lst.symbol] = {
            "name": _first(info, "shortName", "longName", default=lst.name),
            "exchange": "NYSE",
            "sector": _first(info, "sector", default=lst.sector),
            "currency": "USD",
            "price": price,
            "market_cap": _first(info, "marketCap"),
            "pe": _first(info, "trailingPE", "forwardPE"),
            "pb": _first(info, "priceToBook"),
            "roe": _as_fraction(_first(info, "returnOnEquity")),
            "profit_margin": _as_fraction(_first(info, "profitMargins")),
            "debt_to_equity": (float(de) / 100.0) if de == de and de is not None else np.nan,
            "dividend_yield": _as_fraction(_first(info, "dividendYield", "trailingAnnualDividendYield", default=0.0)),
            "avg_daily_value": float(avg_vol) * float(price) if avg_vol == avg_vol and price == price else np.nan,
            "high_52w": _first(info, "fiftyTwoWeekHigh"),
            "low_52w": _first(info, "fiftyTwoWeekLow"),
            "source": "yahoo",
            "as_of": now,
        }
    df = pd.DataFrame.from_dict(rows, orient="index")
    return normalise_fundamentals(df)


def fetch_nyse(listings: list[Listing], period: str = "2y") -> tuple[pd.DataFrame, pd.DataFrame]:
    symbols = [l.symbol for l in listings]
    prices = fetch_prices(symbols, period=period)
    fundamentals = fetch_fundamentals(listings, prices)
    # Fill 52-week range and dollar volume from history when Yahoo's info was thin.
    last_year = prices.tail(252)
    for sym in fundamentals.index:
        if sym in last_year.columns:
            s = last_year[sym].dropna()
            if not s.empty:
                if pd.isna(fundamentals.at[sym, "high_52w"]):
                    fundamentals.at[sym, "high_52w"] = float(s.max())
                if pd.isna(fundamentals.at[sym, "low_52w"]):
                    fundamentals.at[sym, "low_52w"] = float(s.min())
                if pd.isna(fundamentals.at[sym, "price"]):
                    fundamentals.at[sym, "price"] = float(s.iloc[-1])
    return prices, fundamentals
