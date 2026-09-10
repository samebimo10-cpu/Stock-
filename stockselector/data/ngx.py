"""NGX (Nigerian Exchange) data from public sources.

Two public sources are used, in order:

1. The NGX Group statistics feed that powers ngxgroup.com's price tables
   (``doclib.ngxgroup.com/REST/api/statistics/...``). It returns the latest
   daily snapshot for every listed equity: close, change, volume, value and,
   on some rows, market capitalisation. It does **not** return history.
2. ``afx.kwayisi.org/ngx``, a public HTML price board that also exposes per-stock
   valuation figures (P/E, EPS, dividend yield, market cap, 52-week range).

Because neither source serves a long price history, this module accumulates a
history from the daily snapshots it sees (persisted through :class:`DiskCache`)
and also accepts a user-supplied CSV export (columns ``date,symbol,close``),
for example the daily price lists NGX publishes. Until enough history exists,
the engine falls back to range-based proxies derived from the 52-week high/low.
"""
from __future__ import annotations

import logging
import re
import time
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import requests

from ..universe import Listing
from .base import normalise_fundamentals

log = logging.getLogger(__name__)

NGX_STATS_URL = "https://doclib.ngxgroup.com/REST/api/statistics/{table}/?$top=1000&$skip=0&$orderby=SYMBOL"
KWAYISI_BOARD_URL = "https://afx.kwayisi.org/ngx/"
KWAYISI_STOCK_URL = "https://afx.kwayisi.org/ngx/{symbol}.html"
USER_AGENT = "stockselector/0.1 (+https://github.com/; public-data research tool)"
TIMEOUT = 15
#: Wall-clock budget for the optional per-stock valuation pages (seconds).
STOCK_PAGE_BUDGET = 240


def _get(url: str, **kw) -> requests.Response:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"}, timeout=TIMEOUT, **kw)
    resp.raise_for_status()
    return resp


def _num(value) -> float:
    if value is None:
        return np.nan
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "").replace("₦", "").replace("%", "")
    s = re.sub(r"[^\d.\-eE]", "", s)
    if s in ("", "-", "."):
        return np.nan
    try:
        return float(s)
    except ValueError:
        return np.nan


def _pick(row: dict, *candidates):
    """Case-insensitive lookup over several possible field names."""
    lowered = {str(k).lower(): v for k, v in row.items()}
    for c in candidates:
        if c.lower() in lowered:
            return lowered[c.lower()]
    return None


# ----------------------------------------------------------------------------
# Source 1: NGX statistics feed
# ----------------------------------------------------------------------------
def fetch_ngx_snapshot() -> pd.DataFrame:
    """Latest daily equity snapshot from the NGX feed, indexed by symbol.

    Columns: price, prev_close, pct_change, volume, value, market_cap, trade_date.
    """
    frames = []
    for table in ("equities", "ticker"):
        try:
            data = _get(NGX_STATS_URL.format(table=table)).json()
        except Exception as exc:
            log.warning("NGX feed '%s' unavailable: %s", table, exc)
            continue
        if isinstance(data, dict):
            data = data.get("value") or data.get("data") or data.get("items") or []
        rows = {}
        for r in data:
            if not isinstance(r, dict):
                continue
            sym = _pick(r, "SYMBOL", "Symbol", "TICKER", "Ticker")
            if not sym:
                continue
            sym = str(sym).upper().strip()
            rows[sym] = {
                "price": _num(_pick(r, "CLOSING_PRICE", "ClosePrice", "CLOSE_PRICE", "LAST_PRICE", "PRICE", "Close")),
                "prev_close": _num(_pick(r, "PREV_CLOSING_PRICE", "PrevClosePrice", "PREVIOUS_CLOSE", "PrevClose")),
                "pct_change": _num(_pick(r, "PERCENT_CHANGE", "PercentChange", "PercChange", "PCT_CHANGE", "CHANGE_PERCENT", "PricePercentChange")),
                "name": _pick(r, "Company2", "Company", "SECURITY_NAME", "CompanyName", "NAME"),
                "sector": _pick(r, "Sector", "SECTOR", "SectorName"),
                "volume": _num(_pick(r, "VOLUME", "Volume", "TOTAL_VOLUME")),
                "value": _num(_pick(r, "VALUE", "Value", "TOTAL_VALUE", "TURNOVER")),
                "market_cap": _num(_pick(r, "MARKET_CAP", "MarketCap", "MKT_CAP", "MARKET_CAPITALIZATION")),
                "trade_date": _pick(r, "TRADE_DATE", "LAST_TRADE_DATE", "TradeDate", "DATE", "AS_OF"),
            }
        if rows:
            frames.append(pd.DataFrame.from_dict(rows, orient="index"))
    if not frames:
        raise RuntimeError("NGX statistics feed returned no usable rows")
    snap = frames[0]
    for extra in frames[1:]:
        snap = snap.combine_first(extra)
    snap.index.name = "symbol"
    return snap


# ----------------------------------------------------------------------------
# Source 2: afx.kwayisi.org price board and per-stock pages
# ----------------------------------------------------------------------------
def fetch_kwayisi_board() -> pd.DataFrame:
    """Price board: symbol -> name, volume, price, pct_change."""
    from bs4 import BeautifulSoup

    html = _get(KWAYISI_BOARD_URL).text
    soup = BeautifulSoup(html, "html.parser")
    rows = {}
    for tr in soup.select("table tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        if len(cells) < 4:
            continue
        link = tr.find("a", href=True)
        if not link:
            continue
        sym = link.get_text(strip=True).upper()
        if not re.fullmatch(r"[A-Z0-9]{2,15}", sym):
            continue
        # Typical layout: Ticker | Name | Volume | Price | Change
        nums = [_num(c) for c in cells[2:]]
        rows[sym] = {
            "name": cells[1] if len(cells) > 1 else sym,
            "volume": nums[0] if len(nums) > 0 else np.nan,
            "price": nums[1] if len(nums) > 1 else np.nan,
            "pct_change": nums[2] if len(nums) > 2 else np.nan,
        }
    if not rows:
        raise RuntimeError("kwayisi NGX board parsed no rows (layout may have changed)")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "symbol"
    return df


_LABEL_MAP = {
    "market cap": "market_cap",
    "market capitalization": "market_cap",
    "p/e": "pe",
    "pe ratio": "pe",
    "price/earnings": "pe",
    "eps": "eps",
    "earnings per share": "eps",
    "dividend yield": "dividend_yield",
    "div. yield": "dividend_yield",
    "div yield": "dividend_yield",
    "yield": "dividend_yield",
    "dividend": "dividend_per_share",
    "52-week range": "range_52w",
    "52 week range": "range_52w",
    "52-week high": "high_52w",
    "52-week low": "low_52w",
    "shares outstanding": "shares_outstanding",
    "sector": "sector",
    "price": "price",
}


def fetch_kwayisi_stock(symbol: str) -> dict:
    """Valuation facts for one NGX symbol from its kwayisi page."""
    from bs4 import BeautifulSoup

    html = _get(KWAYISI_STOCK_URL.format(symbol=symbol.lower())).text
    soup = BeautifulSoup(html, "html.parser")
    out: dict = {}
    for tr in soup.find_all("tr"):
        cells = tr.find_all(["td", "th"])
        if len(cells) != 2:
            continue
        label = cells[0].get_text(" ", strip=True).lower().rstrip(":")
        value = cells[1].get_text(" ", strip=True)
        for key, field in _LABEL_MAP.items():
            if label.startswith(key):
                if field == "range_52w":
                    parts = [_num(p) for p in re.split(r"[-–to]+", value) if _num(p) == _num(p)]
                    if len(parts) >= 2:
                        out["low_52w"], out["high_52w"] = min(parts[:2]), max(parts[:2])
                elif field == "sector":
                    out["sector"] = value
                else:
                    v = _num(value)
                    # Market cap on the board is often shown in billions/millions.
                    if field == "market_cap":
                        low = value.lower()
                        if "trillion" in low or re.search(r"\d\s*t\b", low):
                            v *= 1e12
                        elif "billion" in low or re.search(r"\d\s*b\b", low):
                            v *= 1e9
                        elif "million" in low or re.search(r"\d\s*m\b", low):
                            v *= 1e6
                    if field == "dividend_yield" and v == v and v > 1:
                        v = v / 100.0
                    out[field] = v
                break
    return out


# ----------------------------------------------------------------------------
# Assembly
# ----------------------------------------------------------------------------
def fetch_ngx(listings: list[Listing], polite_delay: float = 0.4,
              with_stock_pages: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Return (snapshot_prices, fundamentals, warnings) for the NGX universe.

    ``snapshot_prices`` is a one-row panel (today's close per symbol) that the
    loader appends to the persisted history.
    """
    warnings: list[str] = []
    symbols = [l.symbol for l in listings]
    snap = None
    try:
        snap = fetch_ngx_snapshot()
    except Exception as exc:
        warnings.append(f"NGX statistics feed failed: {exc}")
    board = None
    try:
        board = fetch_kwayisi_board()
    except Exception as exc:
        warnings.append(f"kwayisi NGX board failed: {exc}")
    if snap is None and board is None:
        raise RuntimeError("No public NGX price source reachable: " + "; ".join(warnings))

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = {}
    pages_started = time.monotonic()
    consecutive_failures = 0
    pages_skipped = 0
    for lst in listings:
        sym = lst.symbol
        price = np.nan
        market_cap = np.nan
        value = np.nan
        trade_date = today
        if snap is not None and sym in snap.index:
            price = snap.at[sym, "price"]
            market_cap = snap.at[sym, "market_cap"]
            value = snap.at[sym, "value"]
            td = snap.at[sym, "trade_date"]
            if td is not None and td == td:
                try:
                    trade_date = pd.to_datetime(str(td)).strftime("%Y-%m-%d")
                except Exception:
                    pass
        if (price != price) and board is not None and sym in board.index:
            price = board.at[sym, "price"]
            vol = board.at[sym, "volume"]
            if value != value and vol == vol and price == price:
                value = float(vol) * float(price)
        facts: dict = {}
        if with_stock_pages and consecutive_failures < 3 and (time.monotonic() - pages_started) < STOCK_PAGE_BUDGET:
            try:
                facts = fetch_kwayisi_stock(sym)
                consecutive_failures = 0
                time.sleep(polite_delay)
            except Exception as exc:
                consecutive_failures += 1
                log.debug("kwayisi page failed for %s: %s", sym, exc)
        elif with_stock_pages:
            pages_skipped += 1
        if market_cap != market_cap:
            market_cap = facts.get("market_cap", np.nan)
        pe = facts.get("pe", np.nan)
        eps = facts.get("eps", np.nan)
        if pe != pe and eps == eps and eps and price == price:
            pe = float(price) / float(eps) if eps > 0 else np.nan
        rows[sym] = {
            "name": lst.name,
            "exchange": "NGX",
            "sector": facts.get("sector") or lst.sector,
            "currency": "NGN",
            "price": price,
            "market_cap": market_cap,
            "pe": pe,
            "pb": np.nan,  # not published by the free sources; left blank
            "roe": np.nan,
            "profit_margin": np.nan,
            "debt_to_equity": np.nan,
            "dividend_yield": facts.get("dividend_yield", np.nan),
            "avg_daily_value": value,
            "high_52w": facts.get("high_52w", np.nan),
            "low_52w": facts.get("low_52w", np.nan),
            "source": "ngx-feed" if snap is not None else "kwayisi",
            "as_of": trade_date,
        }
    fundamentals = normalise_fundamentals(pd.DataFrame.from_dict(rows, orient="index"))
    if pages_skipped:
        warnings.append(f"NGX: valuation pages skipped for {pages_skipped} stocks (source slow or unavailable); "
                        "P/E and yield are blank for them this run.")
    missing = [s for s in symbols if pd.isna(fundamentals.at[s, "price"])]
    if missing:
        warnings.append(f"No NGX price for: {', '.join(missing)}")
    dates = pd.to_datetime(fundamentals["as_of"], errors="coerce").fillna(pd.Timestamp(today))
    long = pd.DataFrame({
        "date": dates.dt.normalize().values,
        "symbol": fundamentals.index.values,
        "close": fundamentals["price"].values,
    }).dropna(subset=["close"])
    return long, fundamentals, warnings


def import_history_csv(path: str) -> pd.DataFrame:
    """Read a user-supplied NGX history CSV into long form [date, symbol, close].

    Accepts either long form (date,symbol,close) or wide form (date + one column
    per symbol). Column names are matched case-insensitively.
    """
    df = pd.read_csv(path)
    cols = {c.lower().strip(): c for c in df.columns}
    if {"date", "symbol", "close"} <= set(cols):
        long = df.rename(columns={cols["date"]: "date", cols["symbol"]: "symbol", cols["close"]: "close"})
        long = long[["date", "symbol", "close"]]
    else:
        date_col = cols.get("date") or df.columns[0]
        long = df.melt(id_vars=[date_col], var_name="symbol", value_name="close")
        long = long.rename(columns={date_col: "date"})
    long["date"] = pd.to_datetime(long["date"], errors="coerce")
    long["symbol"] = long["symbol"].astype(str).str.upper().str.strip()
    long["close"] = pd.to_numeric(long["close"], errors="coerce")
    return long.dropna(subset=["date", "close"])
