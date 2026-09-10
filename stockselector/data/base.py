from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone

import numpy as np
import pandas as pd

#: Canonical fundamentals table columns. One row per symbol.
FUNDAMENTAL_COLUMNS = [
    "name", "exchange", "sector", "currency", "price", "market_cap",
    "pe", "pb", "roe", "profit_margin", "debt_to_equity", "dividend_yield",
    "avg_daily_value", "high_52w", "low_52w", "source", "as_of",
]


def empty_fundamentals() -> pd.DataFrame:
    df = pd.DataFrame(columns=FUNDAMENTAL_COLUMNS)
    df.index.name = "symbol"
    return df


def normalise_fundamentals(df: pd.DataFrame) -> pd.DataFrame:
    """Guarantee the canonical columns exist with sensible dtypes."""
    df = df.copy()
    for col in FUNDAMENTAL_COLUMNS:
        if col not in df.columns:
            df[col] = np.nan
    numeric = ["price", "market_cap", "pe", "pb", "roe", "profit_margin",
               "debt_to_equity", "dividend_yield", "avg_daily_value", "high_52w", "low_52w"]
    for col in numeric:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ("name", "exchange", "sector", "currency", "source", "as_of"):
        df[col] = df[col].astype("object")
    df.index = df.index.astype(str).str.upper()
    df.index.name = "symbol"
    return df[FUNDAMENTAL_COLUMNS]


@dataclass
class MarketData:
    """Everything the engine needs, in one object.

    ``prices`` holds daily closes in each stock's *local* currency (NGN for NGX,
    USD for NYSE) with a DatetimeIndex and one column per symbol. ``fx_usdngn``
    is the USD/NGN rate (naira per dollar) on the same calendar.
    """

    prices: pd.DataFrame
    fundamentals: pd.DataFrame
    fx_usdngn: pd.Series
    warnings: list[str] = field(default_factory=list)
    is_sample: bool = False
    fetched_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    def __post_init__(self) -> None:
        self.fundamentals = normalise_fundamentals(self.fundamentals)
        self.prices = self.prices.sort_index()
        self.prices.index = pd.to_datetime(self.prices.index)
        self.prices.columns = [str(c).upper() for c in self.prices.columns]
        self.fx_usdngn = pd.Series(self.fx_usdngn, dtype=float).sort_index()
        self.fx_usdngn.index = pd.to_datetime(self.fx_usdngn.index)

    # ----------------------------------------------------------------- helpers
    def symbols(self, exchange: str | None = None) -> list[str]:
        f = self.fundamentals
        if exchange:
            f = f[f["exchange"] == exchange.upper()]
        return list(f.index)

    def subset(self, symbols: list[str]) -> "MarketData":
        symbols = [s.upper() for s in symbols]
        return MarketData(
            prices=self.prices[[s for s in symbols if s in self.prices.columns]],
            fundamentals=self.fundamentals.loc[[s for s in symbols if s in self.fundamentals.index]],
            fx_usdngn=self.fx_usdngn,
            warnings=list(self.warnings),
            is_sample=self.is_sample,
            fetched_at=self.fetched_at,
        )

    def history_days(self, symbol: str) -> int:
        if symbol not in self.prices.columns:
            return 0
        return int(self.prices[symbol].dropna().shape[0])

    def latest_fx(self) -> float:
        fx = self.fx_usdngn.dropna()
        if fx.empty:
            raise ValueError("No USD/NGN rate available")
        return float(fx.iloc[-1])

    def prices_in(self, currency: str) -> pd.DataFrame:
        """Return the price panel converted into ``currency`` ("NGN" or "USD")."""
        currency = currency.upper()
        out = self.prices.copy()
        fx = self.fx_usdngn.reindex(out.index).ffill().bfill()
        for sym in out.columns:
            local = str(self.fundamentals.at[sym, "currency"]).upper() if sym in self.fundamentals.index else "USD"
            if local == currency:
                continue
            if local == "USD" and currency == "NGN":
                out[sym] = out[sym] * fx
            elif local == "NGN" and currency == "USD":
                out[sym] = out[sym] / fx
        return out
