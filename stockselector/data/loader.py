"""Assemble a :class:`MarketData` bundle from live, cached or sample sources."""
from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from ..universe import Listing, load_universe
from .base import MarketData, empty_fundamentals
from .cache import DiskCache
from .sample import sample_market_data

log = logging.getLogger(__name__)

MODES = ("auto", "live", "cache", "sample")


def load_market_data(
    exchanges: tuple[str, ...] = ("NGX", "NYSE"),
    mode: str = "auto",
    cache_dir: str | Path | None = None,
    cache_ttl_hours: float = 6.0,
    ngx_history_csv: str | None = None,
    fx_override: float | None = None,
    universe_files: dict[str, str] | None = None,
    ngx_stock_pages: bool = True,
) -> MarketData:
    """Load data for the requested exchanges.

    ``mode``:
      * ``auto``   – fresh cache if available, else live, else sample (with a warning).
      * ``live``   – always hit the public sources (falls back to stale cache on failure).
      * ``cache``  – use whatever is cached, however old.
      * ``sample`` – synthetic data, no network.
    """
    if mode not in MODES:
        raise ValueError(f"mode must be one of {MODES}")
    exchanges = tuple(e.upper() for e in exchanges)
    universe_files = universe_files or {}
    listings: dict[str, list[Listing]] = {ex: load_universe(ex, universe_files.get(ex)) for ex in exchanges}

    if mode == "sample":
        all_listings = [l for ex in exchanges for l in listings[ex]]
        return sample_market_data(exchanges, listings=all_listings)

    cache = DiskCache(cache_dir, ttl_seconds=cache_ttl_hours * 3600)
    warnings: list[str] = []
    price_frames: list[pd.DataFrame] = []
    fund_frames: list[pd.DataFrame] = []

    # Optional user-supplied NGX history is merged into the persisted store first.
    if ngx_history_csv:
        from .ngx import import_history_csv
        cache.append_history("ngx_history", import_history_csv(ngx_history_csv))

    for ex in exchanges:
        prices, funds, w = _load_exchange(ex, listings[ex], cache, mode, ngx_stock_pages)
        warnings.extend(w)
        if prices is not None and not prices.empty:
            price_frames.append(prices)
        if funds is not None and not funds.empty:
            fund_frames.append(funds)

    if not fund_frames:
        if mode == "auto":
            md = load_market_data(exchanges, mode="sample", universe_files=universe_files)
            md.warnings = warnings + ["No live or cached data reachable; using SAMPLE DATA."] + md.warnings
            return md
        raise RuntimeError("No market data available: " + "; ".join(warnings))

    prices = pd.concat(price_frames, axis=1).sort_index() if price_frames else pd.DataFrame()
    fundamentals = pd.concat(fund_frames).pipe(lambda d: d[~d.index.duplicated(keep="first")])

    fx = _load_fx(cache, mode, fx_override, warnings, prices.index if not prices.empty else None)
    return MarketData(prices=prices, fundamentals=fundamentals, fx_usdngn=fx,
                      warnings=warnings, is_sample=False, fetched_at=datetime.now(timezone.utc))


# ----------------------------------------------------------------------------
def _load_exchange(ex: str, listings: list[Listing], cache: DiskCache, mode: str,
                   ngx_stock_pages: bool):
    warnings: list[str] = []
    pkey, fkey = f"{ex.lower()}_prices", f"{ex.lower()}_fundamentals"

    def from_cache(allow_stale: bool):
        p = cache.get_frame(pkey, allow_stale=allow_stale)
        f = cache.get_json(fkey, allow_stale=allow_stale)
        if ex == "NGX":
            hist = cache.read_history("ngx_history")
            if hist is not None and not hist.empty:
                p = hist if p is None else hist.combine_first(p)
        if f is None:
            return None, None
        fdf = pd.DataFrame.from_dict(f, orient="index")
        return (p if p is not None else pd.DataFrame()), fdf

    if mode in ("auto", "cache"):
        p, f = from_cache(allow_stale=(mode == "cache"))
        if f is not None:
            wanted = [l.symbol for l in listings]
            f = f[f.index.isin(wanted)]
            if not f.empty:
                return p, f, warnings
        if mode == "cache":
            warnings.append(f"{ex}: nothing in cache")
            return None, None, warnings

    # live
    try:
        if ex == "NYSE":
            from .nyse import fetch_nyse
            prices, funds = fetch_nyse(listings)
        elif ex == "NGX":
            from .ngx import fetch_ngx
            long, funds, w = fetch_ngx(listings, with_stock_pages=ngx_stock_pages)
            warnings.extend(w)
            prices = cache.append_history("ngx_history", long)
            hist_days = int(prices.notna().sum().median()) if not prices.empty else 0
            if hist_days < 60:
                warnings.append(
                    f"NGX: only ~{hist_days} days of price history stored so far. Momentum and "
                    "volatility use 52-week range proxies until more daily snapshots accumulate "
                    "(run `stockselector refresh` daily, or import a history CSV)."
                )
        else:
            raise ValueError(f"Unknown exchange {ex}")
        cache.put_frame(pkey, prices)
        cache.put_json(fkey, funds.replace({np.nan: None}).to_dict(orient="index"))
        return prices, funds, warnings
    except Exception as exc:
        warnings.append(f"{ex}: live fetch failed ({exc}); trying stale cache")
        p, f = from_cache(allow_stale=True)
        if f is not None:
            warnings.append(f"{ex}: using stale cached data")
            return p, f, warnings
        return None, None, warnings


def _load_fx(cache: DiskCache, mode: str, override: float | None, warnings: list[str],
             index: pd.DatetimeIndex | None) -> pd.Series:
    from .fx import FALLBACK_USDNGN, constant_series, fetch_usdngn

    idx = index if index is not None and len(index) else pd.bdate_range(end=pd.Timestamp.today(), periods=504)
    if override:
        return constant_series(float(override), idx)
    if mode in ("auto", "cache"):
        cached = cache.get_frame("usdngn", allow_stale=(mode == "cache"))
        if cached is not None and not cached.empty:
            return cached.iloc[:, 0].astype(float)
        if mode == "cache":
            warnings.append(f"USD/NGN: nothing cached, using constant {FALLBACK_USDNGN}")
            return constant_series(FALLBACK_USDNGN, idx)
    try:
        fx = fetch_usdngn()
        cache.put_frame("usdngn", fx.to_frame())
        return fx
    except Exception as exc:
        cached = cache.get_frame("usdngn", allow_stale=True)
        if cached is not None and not cached.empty:
            warnings.append(f"USD/NGN: live fetch failed ({exc}); using stale cache")
            return cached.iloc[:, 0].astype(float)
        warnings.append(f"USD/NGN: live fetch failed ({exc}); using constant {FALLBACK_USDNGN}. "
                        "Pass --fx to set today's rate.")
        return constant_series(FALLBACK_USDNGN, idx)
