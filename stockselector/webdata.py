"""Export a :class:`MarketData` bundle as a compact JSON "data pack" for the browser app."""
from __future__ import annotations

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd

from .data.base import MarketData

_NUM_FIELDS = ["price", "market_cap", "pe", "pb", "roe", "profit_margin", "debt_to_equity",
               "dividend_yield", "avg_daily_value", "high_52w", "low_52w", "ytd_change"]


def _clean(v):
    if v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if math.isnan(f) or math.isinf(f):
        return None
    return float(f"{f:.6g}")


def to_web_pack(md: MarketData, max_days: int = 520) -> dict:
    prices = md.prices.tail(max_days)
    dates = [d.strftime("%Y-%m-%d") for d in prices.index]
    fx = md.fx_usdngn.reindex(prices.index).ffill().bfill()
    stocks = []
    for sym, row in md.fundamentals.iterrows():
        closes = prices[sym].tolist() if sym in prices.columns else []
        stocks.append({
            "symbol": sym,
            "name": str(row["name"]),
            "exchange": str(row["exchange"]),
            "sector": str(row["sector"]),
            "currency": str(row["currency"]),
            **{k: _clean(row[k]) for k in _NUM_FIELDS},
            "closes": [_clean(c) for c in closes],
        })
    board = []
    for _, r in md.board.iterrows():
        board.append({"symbol": str(r["symbol"]), "name": None if pd.isna(r["name"]) else str(r["name"]),
                      "exchange": str(r["exchange"]), "sector": None if pd.isna(r["sector"]) else str(r["sector"]),
                      "currency": str(r["currency"]), "price": _clean(r["price"]), "pct_change": _clean(r["pct_change"]),
                      "market_cap": _clean(r["market_cap"]), "ytd_change": _clean(r["ytd_change"]),
                      "as_of": None if pd.isna(r["as_of"]) else str(r["as_of"])})
    return {
        "board": board,
        "meta": {
            "is_sample": bool(md.is_sample),
            "fetched_at": md.fetched_at.isoformat(),
            "warnings": list(md.warnings),
            "sources": sorted({str(s) for s in md.fundamentals["source"].dropna().unique() if str(s) not in ("none", "nan")}),
        },
        "dates": dates,
        "fx_usdngn": [_clean(v) for v in fx.tolist()],
        "stocks": stocks,
    }


def write_web_pack(md: MarketData, path: str | Path, **kw) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8") as fh:
        json.dump(to_web_pack(md, **kw), fh, separators=(",", ":"))
    return path
