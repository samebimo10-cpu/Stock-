"""NYSE data from Yahoo Finance via the ``yfinance`` package (public, no key)."""
from __future__ import annotations

import logging
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd

from ..universe import Listing
from .base import normalise_fundamentals

log = logging.getLogger(__name__)

#: Wall-clock budget for per-ticker fundamentals calls (seconds). Yahoo throttles
#: bursts; past the budget the remaining tickers get price-derived fields only.
FUNDAMENTALS_BUDGET = 360


def _first(info: dict, *keys, default=np.nan):
    for k in keys:
        v = info.get(k)
        if v is not None and v == v:  # not None, not NaN
            return v
    return default


def _as_fraction(value) -> float:
    """Ratios Yahoo reports as fractions (ROE, margins); guard against percent."""
    try:
        v = float(value)
    except (TypeError, ValueError):
        return np.nan
    return v / 100.0 if abs(v) > 1.5 else v


#: No large-cap yields more than this; anything above is a currency or data glitch.
MAX_SANE_YIELD = 0.20


def _dividend_yield(info: dict) -> float:
    """Yahoo's ``dividendYield`` is a percent (1.69 = 1.69%) and is computed in the
    quote currency; ``trailingAnnualDividendYield`` is a fraction but, for ADRs,
    divides a home-currency dividend by the dollar price. Prefer the former."""
    candidates = []
    dy = info.get("dividendYield")
    if dy is not None and dy == dy:
        candidates.append(float(dy) / 100.0)
    tr = info.get("trailingAnnualDividendYield")
    if tr is not None and tr == tr:
        candidates.append(float(tr))
    for v in candidates:
        if 0.0 <= v <= MAX_SANE_YIELD:
            return v
    return 0.0 if not candidates else np.nan


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
    started = time.monotonic()
    throttled = False
    for lst in listings:
        info: dict = {}
        if not throttled and (time.monotonic() - started) < FUNDAMENTALS_BUDGET:
            try:
                info = yf.Ticker(lst.symbol).get_info() or {}
            except Exception as exc:  # pragma: no cover - network dependent
                log.warning("yfinance info failed for %s: %s", lst.symbol, exc)
                if "rate" in str(exc).lower() or "too many" in str(exc).lower():
                    throttled = True
                    log.warning("Yahoo is throttling; remaining tickers get price-derived fields only")
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
            "dividend_yield": _dividend_yield(info),
            "avg_daily_value": float(avg_vol) * float(price) if avg_vol == avg_vol and price == price else np.nan,
            "high_52w": _first(info, "fiftyTwoWeekHigh"),
            "low_52w": _first(info, "fiftyTwoWeekLow"),
            "source": "yahoo",
            "as_of": now,
        }
    df = pd.DataFrame.from_dict(rows, orient="index")
    return normalise_fundamentals(df)


def fetch_nyse(listings: list[Listing], period: str = "2y") -> tuple[pd.DataFrame, pd.DataFrame]:
    """Prices and fundamentals for the screened universe."""
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


# ----------------------------------------------------------------------------
# Whole-market board
# ----------------------------------------------------------------------------
#: Nasdaq Trader's public symbol directory; the "otherlisted" file covers NYSE,
#: NYSE American and NYSE Arca. Exchange code "N" is the New York Stock Exchange.
OTHER_LISTED_URL = "https://www.nasdaqtrader.com/dynamic/SymDir/otherlisted.txt"
BOARD_BUDGET = 480          # seconds for the batched price download
BOARD_CHUNK = 250


def fetch_nyse_symbols() -> pd.DataFrame:
    """All NYSE-listed common stocks: symbol, name (ETFs and test issues excluded)."""
    import io

    import requests

    txt = requests.get(OTHER_LISTED_URL, timeout=30, headers={"User-Agent": "stockselector/0.1"}).text
    df = pd.read_csv(io.StringIO(txt), sep="|")
    df = df[df.columns[:8]]
    df.columns = ["act_symbol", "name", "exchange", "cqs_symbol", "etf", "lot", "test", "nasdaq_symbol"][: len(df.columns)]
    df = df[(df["exchange"] == "N") & (df["etf"] != "Y") & (df["test"] != "Y")]
    df = df[df["act_symbol"].astype(str).str.fullmatch(r"[A-Z]{1,5}")]  # skip warrants, units, preferreds
    out = pd.DataFrame({"symbol": df["act_symbol"].astype(str).str.upper(),
                        "name": df["name"].astype(str).str.replace(r"\s+Common Stock$", "", regex=True)})
    return out.drop_duplicates("symbol").reset_index(drop=True)


def fetch_nyse_board(symbols: pd.DataFrame | None = None) -> pd.DataFrame:
    """Latest close and day change for every NYSE-listed stock (time-boxed)."""
    import yfinance as yf

    symbols = fetch_nyse_symbols() if symbols is None else symbols
    started = time.monotonic()
    rows = []
    syms = list(symbols["symbol"])
    for i in range(0, len(syms), BOARD_CHUNK):
        if time.monotonic() - started > BOARD_BUDGET:
            log.warning("NYSE board: time budget hit after %d of %d symbols", i, len(syms))
            break
        chunk = syms[i:i + BOARD_CHUNK]
        try:
            raw = yf.download(chunk, period="5d", interval="1d", auto_adjust=False, progress=False,
                              group_by="column", threads=True)
        except Exception as exc:  # pragma: no cover - network dependent
            log.warning("NYSE board chunk failed: %s", exc)
            continue
        if raw is None or raw.empty:
            continue
        close = raw["Close"] if isinstance(raw.columns, pd.MultiIndex) else raw[["Close"]].rename(columns={"Close": chunk[0]})
        for sym in close.columns:
            s = close[sym].dropna()
            if s.empty:
                continue
            last = float(s.iloc[-1])
            prev = float(s.iloc[-2]) if len(s) > 1 else np.nan
            rows.append({"symbol": str(sym).upper(), "price": last,
                         "pct_change": (last / prev - 1) * 100 if prev == prev and prev else np.nan,
                         "as_of": pd.Timestamp(s.index[-1]).strftime("%Y-%m-%d")})
    board = pd.DataFrame(rows)
    if board.empty:
        raise RuntimeError("NYSE board: no prices downloaded")
    board = board.merge(symbols, on="symbol", how="left")
    board["exchange"] = "NYSE"
    board["currency"] = "USD"
    return board
