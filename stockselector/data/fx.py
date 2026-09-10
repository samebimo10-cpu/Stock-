"""USD/NGN exchange-rate history (naira per US dollar)."""
from __future__ import annotations

import logging

import pandas as pd

log = logging.getLogger(__name__)

#: Used only when no live or cached rate is available and the caller gave none.
FALLBACK_USDNGN = 1500.0


def fetch_usdngn(period: str = "2y") -> pd.Series:
    import yfinance as yf

    raw = yf.download("NGN=X", period=period, interval="1d", auto_adjust=True, progress=False)
    if raw is None or raw.empty:
        raise RuntimeError("Yahoo Finance returned no USD/NGN data")
    close = raw["Close"]
    if isinstance(close, pd.DataFrame):
        close = close.iloc[:, 0]
    close.index = pd.to_datetime(close.index).tz_localize(None)
    close = close.astype(float).dropna()
    close.name = "USDNGN"
    return close


def constant_series(rate: float, index: pd.DatetimeIndex) -> pd.Series:
    return pd.Series(rate, index=index, name="USDNGN", dtype=float)
