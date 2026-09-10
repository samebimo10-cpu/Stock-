"""NGX (Nigerian Exchange) data from public sources.

Sources, in order of preference (all free, no key, verified reachable from
GitHub-hosted runners in September 2026):

1. **NGX Group statistics feed** (``doclib.ngxgroup.com/REST/api/statistics``).
   The ``ticker`` table lists every listed security with its last price
   (``Value``) and day change (``PercChange``); the ``equities`` table, queried
   with ``market``/``sector``/``pageSize`` parameters, is the full price list
   the ngxgroup.com website renders. Neither serves history.
2. **african-markets.com** listed-companies table: price, sector, 1-day and
   year-to-date change and market capitalisation (billions of naira) for every
   NGX company, keyed by the NGX code; per-company pages add valuation facts.
3. **afx.kwayisi.org/ngx** price board (often unreachable from cloud runners;
   kept as a last resort).

History is accumulated from the daily snapshots (see :class:`DiskCache`) and a
user-supplied CSV can be imported. Until about 60 trading days exist, the
year-to-date change and 52-week range stand in for momentum and volatility.
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

NGX_TICKER_URL = "https://doclib.ngxgroup.com/REST/api/statistics/ticker/?$top=2000&$skip=0&$orderby=SYMBOL"
NGX_EQUITIES_URL = "https://doclib.ngxgroup.com/REST/api/statistics/equities/?market=&sector=&orderby=&pageSize=400&pageNo=0"
AM_BASE = "https://www.african-markets.com"
AM_LIST_URL = AM_BASE + "/en/stock-markets/ngse/listed-companies"
AM_COMPANY_URL = AM_BASE + "/en/stock-markets/ngse/listed-companies/company?code={code}"
KWAYISI_BOARD_URL = "https://afx.kwayisi.org/ngx/"
KWAYISI_STOCK_URL = "https://afx.kwayisi.org/ngx/{symbol}.html"
USER_AGENT = "Mozilla/5.0 (compatible; stockselector/0.1; public-data research tool)"
TIMEOUT = 15
#: Wall-clock budget for the optional per-company valuation pages (seconds).
STOCK_PAGE_BUDGET = 240
#: NGX enforces a +/-10% daily limit; a bigger move in the feed is a data glitch.
MAX_SANE_DAY_MOVE = 25.0


def _get(url: str, **kw) -> requests.Response:
    resp = requests.get(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*",
                                      "Accept-Encoding": "gzip, deflate"}, timeout=TIMEOUT, **kw)
    resp.raise_for_status()
    return resp


def _num(value) -> float:
    if value is None:
        return np.nan
    if isinstance(value, (int, float)):
        return float(value)
    s = str(value).strip().replace(",", "").replace("₦", "").replace("%", "")
    s = re.sub(r"[^\d.\-eE]", "", s)
    if s in ("", "-", ".", "-."):
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


def _rows(data):
    if isinstance(data, dict):
        for k in ("value", "data", "items", "d", "result", "results"):
            if isinstance(data.get(k), list):
                return data[k]
        return []
    return data if isinstance(data, list) else []


# ----------------------------------------------------------------------------
# Source 1: NGX statistics feed
# ----------------------------------------------------------------------------
def fetch_ngx_ticker() -> pd.DataFrame:
    """Last price and day change for every listed equity (symbol-indexed)."""
    data = _rows(_get(NGX_TICKER_URL).json())
    rows = {}
    for r in data:
        if not isinstance(r, dict):
            continue
        ttype = str(_pick(r, "TickerType", "TICKER_TYPE") or "EQUITIES").upper()
        if ttype != "EQUITIES":
            continue
        sym = _pick(r, "SYMBOL", "Symbol")
        if not sym:
            continue
        rows[str(sym).upper().strip()] = {
            "price": _num(_pick(r, "Value", "CLOSING_PRICE", "ClosePrice", "PRICE")),
            "pct_change": _num(_pick(r, "PercChange", "PERCENT_CHANGE", "PercentChange")),
        }
    if not rows:
        raise RuntimeError("NGX ticker feed returned no equities")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "symbol"
    return df


def fetch_ngx_equities() -> pd.DataFrame:
    """Full equities price list (symbol-indexed) with whatever fields NGX publishes."""
    data = _rows(_get(NGX_EQUITIES_URL).json())
    rows = {}
    for r in data:
        if not isinstance(r, dict):
            continue
        sym = _pick(r, "SYMBOL", "Symbol", "TICKER", "Ticker")
        if not sym:
            continue
        rows[str(sym).upper().strip()] = {
            "price": _num(_pick(r, "CLOSING_PRICE", "ClosePrice", "CLOSE_PRICE", "LAST_PRICE", "PRICE", "Close", "Price")),
            "prev_close": _num(_pick(r, "PREV_CLOSING_PRICE", "PrevClosingPrice", "PREVIOUS_CLOSE", "PrevClose")),
            "high": _num(_pick(r, "HIGH_PRICE", "HighPrice", "High")),
            "low": _num(_pick(r, "LOW_PRICE", "LowPrice", "Low")),
            "pct_change": _num(_pick(r, "PERCENT_CHANGE", "PercentChange", "PercChange", "PCT_CHANGE", "PricePercentChange")),
            "volume": _num(_pick(r, "VOLUME", "Volume", "TOTAL_VOLUME")),
            "value": _num(_pick(r, "VALUE", "Value", "TOTAL_VALUE", "TURNOVER")),
            "market_cap": _num(_pick(r, "MARKET_CAP", "MarketCap", "MKT_CAP", "MARKET_CAPITALIZATION", "MarketCapitalization")),
            "name": _pick(r, "Company2", "Company", "SECURITY_NAME", "CompanyName", "NAME"),
            "sector": _pick(r, "Sector", "SECTOR", "SectorName"),
            "trade_date": _pick(r, "TRADE_DATE", "LAST_TRADE_DATE", "TradeDate", "DATE", "AS_OF"),
            "_keys": ",".join(sorted(r.keys()))[:300],
        }
    if not rows:
        raise RuntimeError("NGX equities feed returned no rows")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "symbol"
    return df


# ----------------------------------------------------------------------------
# Source 2: african-markets.com
# ----------------------------------------------------------------------------
def fetch_african_markets_list() -> pd.DataFrame:
    """NGX listed-companies table: name, sector, price, 1-day %, YTD %, market cap (NGN), date."""
    from bs4 import BeautifulSoup

    html = _get(AM_LIST_URL).text
    soup = BeautifulSoup(html, "html.parser")
    rows = {}
    year = datetime.now(timezone.utc).year
    for tr in soup.find_all("tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all("td")]
        link = tr.find("a", href=True)
        if len(cells) < 6 or not link:
            continue
        m = re.search(r"code=([A-Za-z0-9._-]+)", link["href"])
        if not m:
            continue
        code = m.group(1).upper()
        # Company | Sector | Price | 1D | YTD | M.Cap (billions NGN) | Date (dd/mm)
        date = None
        if len(cells) >= 7:
            dm = re.match(r"(\d{1,2})/(\d{1,2})", cells[6])
            if dm:
                date = f"{year}-{int(dm.group(2)):02d}-{int(dm.group(1)):02d}"
        mcap = _num(cells[5])
        rows[code] = {
            "name": cells[0], "sector": cells[1], "price": _num(cells[2]),
            "pct_change": _num(cells[3]), "ytd_change": _num(cells[4]) / 100.0 if _num(cells[4]) == _num(cells[4]) else np.nan,
            "market_cap": mcap * 1e9 if mcap == mcap else np.nan, "trade_date": date,
        }
    if not rows:
        raise RuntimeError("african-markets NGX table parsed no rows (layout may have changed)")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "symbol"
    return df


_LABEL_MAP = {
    "market cap": "market_cap",
    "market capitalization": "market_cap",
    "p/e": "pe",
    "pe ratio": "pe",
    "price/earnings": "pe",
    "price to earnings": "pe",
    "p/b": "pb",
    "price/book": "pb",
    "price to book": "pb",
    "eps": "eps",
    "earnings per share": "eps",
    "dividend yield": "dividend_yield",
    "div. yield": "dividend_yield",
    "div yield": "dividend_yield",
    "yield": "dividend_yield",
    "dividend": "dividend_per_share",
    "52-week range": "range_52w",
    "52 week range": "range_52w",
    "52w range": "range_52w",
    "52-week high": "high_52w",
    "52 week high": "high_52w",
    "52w high": "high_52w",
    "52-week low": "low_52w",
    "52 week low": "low_52w",
    "52w low": "low_52w",
    "shares outstanding": "shares_outstanding",
    "sector": "sector",
    "price": "price",
}


def _parse_label_value_rows(html: str) -> dict:
    """Generic label/value table parser shared by the per-company pages."""
    from bs4 import BeautifulSoup

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
                    parts = [_num(p) for p in re.split(r"\s*[-–]\s*|\s+to\s+", value) if _num(p) == _num(p)]
                    if len(parts) >= 2:
                        out["low_52w"], out["high_52w"] = min(parts[:2]), max(parts[:2])
                elif field == "sector":
                    out["sector"] = value
                else:
                    v = _num(value)
                    if field == "market_cap":
                        low = value.lower()
                        if "trillion" in low or re.search(r"\d\s*t\b", low):
                            v *= 1e12
                        elif "billion" in low or re.search(r"\d\s*bn?\b", low):
                            v *= 1e9
                        elif "million" in low or re.search(r"\d\s*mn?\b", low):
                            v *= 1e6
                    if field == "dividend_yield" and v == v and v > 1:
                        v = v / 100.0
                    if field not in out or out[field] != out[field]:
                        out[field] = v
                break
    return out


def fetch_african_markets_company(code: str) -> dict:
    return _parse_label_value_rows(_get(AM_COMPANY_URL.format(code=code)).text)


# ----------------------------------------------------------------------------
# Source 3: afx.kwayisi.org (last resort)
# ----------------------------------------------------------------------------
def fetch_kwayisi_board() -> pd.DataFrame:
    from bs4 import BeautifulSoup

    html = _get(KWAYISI_BOARD_URL).text
    soup = BeautifulSoup(html, "html.parser")
    rows = {}
    for tr in soup.select("table tr"):
        cells = [c.get_text(" ", strip=True) for c in tr.find_all(["td", "th"])]
        link = tr.find("a", href=True)
        if len(cells) < 4 or not link:
            continue
        sym = link.get_text(strip=True).upper()
        if not re.fullmatch(r"[A-Z0-9]{2,15}", sym):
            continue
        nums = [_num(c) for c in cells[2:]]
        rows[sym] = {"name": cells[1], "volume": nums[0] if nums else np.nan,
                     "price": nums[1] if len(nums) > 1 else np.nan, "pct_change": nums[2] if len(nums) > 2 else np.nan}
    if not rows:
        raise RuntimeError("kwayisi NGX board parsed no rows")
    df = pd.DataFrame.from_dict(rows, orient="index")
    df.index.name = "symbol"
    return df


def fetch_kwayisi_stock(symbol: str) -> dict:
    return _parse_label_value_rows(_get(KWAYISI_STOCK_URL.format(symbol=symbol.lower())).text)


# ----------------------------------------------------------------------------
# Assembly
# ----------------------------------------------------------------------------
def _lookup(df: pd.DataFrame | None, codes: tuple[str, ...]):
    if df is None:
        return None
    for c in codes:
        if c in df.index:
            return df.loc[c]
    return None


def _sane(price: float, pct: float) -> bool:
    return price == price and price > 0 and not (pct == pct and abs(pct) > MAX_SANE_DAY_MOVE)


def fetch_ngx(listings: list[Listing], polite_delay: float = 0.3,
              with_stock_pages: bool = True) -> tuple[pd.DataFrame, pd.DataFrame, list[str]]:
    """Return (snapshot_long, fundamentals, warnings) for the NGX universe."""
    warnings: list[str] = []
    sources: list[str] = []

    def attempt(name, fn):
        try:
            out = fn()
            sources.append(name)
            return out
        except Exception as exc:
            warnings.append(f"NGX source '{name}' unavailable: {exc}")
            return None

    ticker = attempt("ngx-ticker", fetch_ngx_ticker)
    equities = attempt("ngx-equities", fetch_ngx_equities)
    am = attempt("african-markets", fetch_african_markets_list)
    kw = None
    if ticker is None and equities is None and am is None:
        kw = attempt("kwayisi", fetch_kwayisi_board)
        if kw is None:
            raise RuntimeError("No public NGX price source reachable: " + "; ".join(warnings))
    if equities is not None and "_keys" in equities.columns:
        log.info("NGX equities feed fields: %s", equities["_keys"].iloc[0])
        if equities["price"].isna().all():
            warnings.append("NGX equities feed fields not recognised: " + str(equities["_keys"].iloc[0]))

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    rows = {}
    pages_started = time.monotonic()
    consecutive_failures = 0
    pages_skipped = 0
    for lst in listings:
        codes = lst.codes
        t, e, a, k = _lookup(ticker, codes), _lookup(equities, codes), _lookup(am, codes), _lookup(kw, codes)
        price, pct, src = np.nan, np.nan, None
        for cand, name in ((e, "ngx-equities"), (t, "ngx-ticker"), (a, "african-markets"), (k, "kwayisi")):
            if cand is not None and _sane(cand.get("price", np.nan), cand.get("pct_change", np.nan)):
                price, pct, src = float(cand["price"]), cand.get("pct_change", np.nan), name
                break
        market_cap = np.nan
        for cand in (e, a):
            if cand is not None and cand.get("market_cap", np.nan) == cand.get("market_cap", np.nan):
                market_cap = float(cand["market_cap"])
                break
        value = e["value"] if e is not None and e.get("value", np.nan) == e.get("value", np.nan) else np.nan
        ytd = a["ytd_change"] if a is not None and a.get("ytd_change", np.nan) == a.get("ytd_change", np.nan) else np.nan
        trade_date = today
        for cand in (e, a):
            td = cand.get("trade_date") if cand is not None else None
            if td is not None and td == td and str(td).strip():
                try:
                    trade_date = pd.to_datetime(str(td)).strftime("%Y-%m-%d")
                    break
                except Exception:
                    pass
        facts: dict = {}
        if with_stock_pages and consecutive_failures < 3 and (time.monotonic() - pages_started) < STOCK_PAGE_BUDGET:
            for code in codes:
                try:
                    facts = fetch_african_markets_company(code)
                    consecutive_failures = 0
                    time.sleep(polite_delay)
                    break
                except Exception as exc:
                    log.debug("african-markets company page failed for %s: %s", code, exc)
            else:
                consecutive_failures += 1
        elif with_stock_pages:
            pages_skipped += 1
        if market_cap != market_cap:
            market_cap = facts.get("market_cap", np.nan)
        pe = facts.get("pe", np.nan)
        eps = facts.get("eps", np.nan)
        if pe != pe and eps == eps and eps and price == price:
            pe = price / eps if eps > 0 else -1.0
        rows[lst.symbol] = {
            "name": lst.name, "exchange": "NGX", "sector": lst.sector, "currency": "NGN",
            "price": price, "market_cap": market_cap, "pe": pe, "pb": facts.get("pb", np.nan),
            "roe": np.nan, "profit_margin": np.nan, "debt_to_equity": np.nan,
            "dividend_yield": facts.get("dividend_yield", np.nan), "avg_daily_value": value,
            "high_52w": facts.get("high_52w", np.nan), "low_52w": facts.get("low_52w", np.nan),
            "ytd_change": ytd, "source": src or "none", "as_of": trade_date,
        }
    fundamentals = normalise_fundamentals(pd.DataFrame.from_dict(rows, orient="index"))
    if pages_skipped:
        warnings.append(f"NGX: valuation pages skipped for {pages_skipped} stocks (source slow or unavailable).")
    missing = [s for s in fundamentals.index if pd.isna(fundamentals.at[s, "price"])]
    if missing:
        warnings.append(f"No NGX price for: {', '.join(missing)}")
    warnings.append("NGX sources used: " + ", ".join(sources))
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
