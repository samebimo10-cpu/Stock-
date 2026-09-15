"""The trial registry (SPEC section 11.3).

Deflated Sharpe uses the **true** trial count. Self-reported counts are
consistently low by an order of magnitude, not from dishonesty but because a
failed experiment does not feel like a trial.

So the registry is written by the harness, not by the researcher, and
**the harness refuses to start without a registry connection**. A backtest that
runs without registering does not run.
"""

from __future__ import annotations

import json
import sqlite3
from contextlib import contextmanager
from dataclasses import dataclass, asdict
from pathlib import Path
from typing import Any, Dict, Iterator, List, Mapping, Optional

from ..core.types import Nanos, now_ns

__all__ = ["Trial", "TrialRegistry", "RegistryRequired"]


class RegistryRequired(RuntimeError):
    """Raised when a backtest is attempted with no registry attached."""


@dataclass(frozen=True)
class Trial:
    trial_id: int
    strategy: str
    code_hash: str
    parameters: Mapping[str, Any]
    data_start: str
    data_end: str
    started_at: Nanos
    finished_at: Optional[Nanos] = None
    sharpe: Optional[float] = None
    max_drawdown: Optional[float] = None
    trades: Optional[int] = None
    outcome: str = "running"      # running | complete | abandoned | error
    note: str = ""


_SCHEMA = """
CREATE TABLE IF NOT EXISTS trials (
    trial_id     INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy     TEXT NOT NULL,
    code_hash    TEXT NOT NULL,
    parameters   TEXT NOT NULL,
    data_start   TEXT NOT NULL,
    data_end     TEXT NOT NULL,
    started_at   INTEGER NOT NULL,
    finished_at  INTEGER,
    sharpe       REAL,
    max_drawdown REAL,
    trades       INTEGER,
    outcome      TEXT NOT NULL DEFAULT 'running',
    note         TEXT NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_trials_strategy ON trials(strategy);

-- Every read of the holdout is logged: who, when and why (SPEC section 11.3).
-- Two reads for the same strategy is a process failure, and it is invisible
-- unless it is logged.
CREATE TABLE IF NOT EXISTS holdout_access (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    strategy   TEXT NOT NULL,
    who        TEXT NOT NULL,
    why        TEXT NOT NULL,
    at         INTEGER NOT NULL
);
"""


class TrialRegistry:
    """SQLite-backed. Boring and correct."""

    def __init__(self, path: str | Path = ":memory:") -> None:
        self.path = str(path)
        if self.path != ":memory:":
            Path(self.path).parent.mkdir(parents=True, exist_ok=True)
        self._conn = sqlite3.connect(self.path)
        self._conn.row_factory = sqlite3.Row
        self._conn.executescript(_SCHEMA)
        self._conn.commit()

    def close(self) -> None:
        self._conn.close()

    # -- recording -------------------------------------------------------

    def start(self, strategy: str, code_hash: str, parameters: Mapping[str, Any],
              data_start: str, data_end: str, at: Optional[Nanos] = None) -> int:
        cur = self._conn.execute(
            "INSERT INTO trials (strategy, code_hash, parameters, data_start, data_end, started_at)"
            " VALUES (?,?,?,?,?,?)",
            (strategy, code_hash, json.dumps(parameters, sort_keys=True, default=str),
             data_start, data_end, at if at is not None else now_ns()),
        )
        self._conn.commit()
        return int(cur.lastrowid)

    def finish(self, trial_id: int, *, sharpe: Optional[float] = None,
               max_drawdown: Optional[float] = None, trades: Optional[int] = None,
               outcome: str = "complete", note: str = "",
               at: Optional[Nanos] = None) -> None:
        self._conn.execute(
            "UPDATE trials SET finished_at=?, sharpe=?, max_drawdown=?, trades=?, outcome=?, note=?"
            " WHERE trial_id=?",
            (at if at is not None else now_ns(), sharpe, max_drawdown, trades, outcome, note, trial_id),
        )
        self._conn.commit()

    def abandon(self, trial_id: int, note: str = "abandoned by researcher") -> None:
        """An abandoned run is still a trial.

        This is the method that makes the count honest. A run killed after
        five minutes because the equity curve looked wrong is a trial: it
        informed the search, so it belongs in the denominator.
        """
        self.finish(trial_id, outcome="abandoned", note=note)

    @contextmanager
    def trial(self, strategy: str, code_hash: str, parameters: Mapping[str, Any],
              data_start: str, data_end: str) -> Iterator[int]:
        """Context manager that records the trial whatever happens to it.

        An exception inside the block still closes the trial, as ``error``.
        A crashed backtest is a trial too.
        """
        tid = self.start(strategy, code_hash, parameters, data_start, data_end)
        try:
            yield tid
        except BaseException as e:
            self.finish(tid, outcome="error", note=f"{type(e).__name__}: {e}")
            raise
        else:
            row = self._conn.execute(
                "SELECT outcome FROM trials WHERE trial_id=?", (tid,)
            ).fetchone()
            if row and row["outcome"] == "running":
                self.finish(tid, outcome="complete")

    # -- reading ---------------------------------------------------------

    def count(self, strategy: Optional[str] = None) -> int:
        """The true trial count. Every run, including abandoned and errored."""
        if strategy is None:
            row = self._conn.execute("SELECT COUNT(*) c FROM trials").fetchone()
        else:
            row = self._conn.execute(
                "SELECT COUNT(*) c FROM trials WHERE strategy=?", (strategy,)
            ).fetchone()
        return int(row["c"])

    def sharpes(self, strategy: Optional[str] = None) -> List[float]:
        sql = "SELECT sharpe FROM trials WHERE sharpe IS NOT NULL"
        args: tuple = ()
        if strategy is not None:
            sql += " AND strategy=?"
            args = (strategy,)
        return [float(r["sharpe"]) for r in self._conn.execute(sql, args)]

    def get(self, trial_id: int) -> Optional[Trial]:
        row = self._conn.execute("SELECT * FROM trials WHERE trial_id=?", (trial_id,)).fetchone()
        if row is None:
            return None
        return Trial(
            trial_id=row["trial_id"], strategy=row["strategy"], code_hash=row["code_hash"],
            parameters=json.loads(row["parameters"]), data_start=row["data_start"],
            data_end=row["data_end"], started_at=row["started_at"],
            finished_at=row["finished_at"], sharpe=row["sharpe"],
            max_drawdown=row["max_drawdown"], trades=row["trades"],
            outcome=row["outcome"], note=row["note"],
        )

    # -- holdout ---------------------------------------------------------

    def record_holdout_access(self, strategy: str, who: str, why: str,
                              at: Optional[Nanos] = None) -> int:
        self._conn.execute(
            "INSERT INTO holdout_access (strategy, who, why, at) VALUES (?,?,?,?)",
            (strategy, who, why, at if at is not None else now_ns()),
        )
        self._conn.commit()
        return self.holdout_access_count(strategy)

    def holdout_access_count(self, strategy: str) -> int:
        row = self._conn.execute(
            "SELECT COUNT(*) c FROM holdout_access WHERE strategy=?", (strategy,)
        ).fetchone()
        return int(row["c"])

    def holdout_reused(self, strategy: str) -> bool:
        """True when the holdout has been read more than once for one strategy.

        A process failure. The strategy that prompted it does not proceed, and
        the failure gets its own review.
        """
        return self.holdout_access_count(strategy) > 1
