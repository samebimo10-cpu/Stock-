"""Tiny on-disk cache so repeated runs do not hammer public endpoints."""
from __future__ import annotations

import json
import os
import time
from pathlib import Path

import pandas as pd

DEFAULT_CACHE_DIR = Path(os.environ.get("STOCKSELECTOR_CACHE", ".cache/stockselector"))


class DiskCache:
    def __init__(self, directory: str | Path | None = None, ttl_seconds: float = 6 * 3600) -> None:
        self.dir = Path(directory) if directory else DEFAULT_CACHE_DIR
        self.dir.mkdir(parents=True, exist_ok=True)
        self.ttl = ttl_seconds

    def _path(self, key: str, ext: str) -> Path:
        return self.dir / f"{key}.{ext}"

    def is_fresh(self, key: str, ext: str) -> bool:
        p = self._path(key, ext)
        return p.exists() and (time.time() - p.stat().st_mtime) < self.ttl

    # --- DataFrames ---------------------------------------------------------
    def get_frame(self, key: str, allow_stale: bool = False) -> pd.DataFrame | None:
        p = self._path(key, "csv")
        if not p.exists() or (not allow_stale and not self.is_fresh(key, "csv")):
            return None
        try:
            return pd.read_csv(p, index_col=0, parse_dates=True)
        except Exception:
            return None

    def put_frame(self, key: str, df: pd.DataFrame) -> None:
        df.to_csv(self._path(key, "csv"))

    # --- JSON ---------------------------------------------------------------
    def get_json(self, key: str, allow_stale: bool = False):
        p = self._path(key, "json")
        if not p.exists() or (not allow_stale and not self.is_fresh(key, "json")):
            return None
        try:
            with open(p, "r", encoding="utf-8") as fh:
                return json.load(fh)
        except Exception:
            return None

    def put_json(self, key: str, obj) -> None:
        with open(self._path(key, "json"), "w", encoding="utf-8") as fh:
            json.dump(obj, fh, default=str)

    # --- append-only price history (used to build NGX history over time) ----
    def append_history(self, key: str, rows: pd.DataFrame) -> pd.DataFrame:
        """``rows`` has columns [date, symbol, close]. Returns the merged panel."""
        p = self._path(key, "csv")
        existing = pd.DataFrame(columns=["date", "symbol", "close"])
        if p.exists():
            try:
                existing = pd.read_csv(p)
            except Exception:
                pass
        merged = pd.concat([existing, rows], ignore_index=True)
        merged["date"] = pd.to_datetime(merged["date"]).dt.normalize()
        merged["symbol"] = merged["symbol"].astype(str).str.upper()
        merged = merged.drop_duplicates(subset=["date", "symbol"], keep="last").sort_values(["date", "symbol"])
        merged.to_csv(p, index=False)
        return merged.pivot(index="date", columns="symbol", values="close")

    def read_history(self, key: str) -> pd.DataFrame | None:
        p = self._path(key, "csv")
        if not p.exists():
            return None
        try:
            long = pd.read_csv(p)
            long["date"] = pd.to_datetime(long["date"])
            return long.pivot(index="date", columns="symbol", values="close")
        except Exception:
            return None
