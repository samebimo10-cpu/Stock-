"""Append-only, hash-chained audit log (SPEC section 10.4).

Two properties, both load-bearing:

* **Tamper evidence.** Each record carries the hash of the previous one, so a
  record cannot be altered or removed without breaking the chain. A break is a
  P1: either the log was tampered with or the writer has a defect, and both
  mean the record of what the system did cannot be trusted.
* **Halt on buffer full.** A system that keeps trading while it has lost the
  ability to record what it is doing cannot be reconciled afterwards. Losing
  the audit path is a trading-halt condition, not a degraded mode
  (SPEC section 3.3).
"""

from __future__ import annotations

import hashlib
import json
from collections import deque
from dataclasses import dataclass, asdict, is_dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Callable, Deque, Dict, Iterable, Iterator, List, Mapping, Optional

from ...core.events import AuditRecord
from ...core.types import Nanos, now_ns

__all__ = ["AuditLog", "AuditBufferFull", "ChainBroken", "verify_chain", "GENESIS"]

#: Hash of the empty chain. The first record links to this.
GENESIS = "0" * 64


class AuditBufferFull(RuntimeError):
    """The audit path is unavailable and the buffer is exhausted. Halt trading."""


class ChainBroken(AssertionError):
    """The hash chain does not verify. P1."""


def _encode(value: Any) -> Any:
    """JSON-safe, order-stable, and lossless for Decimal.

    Decimals become strings rather than floats. A float round-trip would
    change the recorded number, which defeats the point of recording it.
    """
    if isinstance(value, Decimal):
        return str(value)
    if is_dataclass(value) and not isinstance(value, type):
        return {k: _encode(v) for k, v in asdict(value).items()}
    if isinstance(value, Mapping):
        return {str(k): _encode(v) for k, v in value.items()}
    if isinstance(value, (list, tuple, set, frozenset)):
        return [_encode(v) for v in value]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value
    return str(value)


def _hash(seq: int, kind: str, correlation_id: str, recorded_at: int,
          payload: Any, prev_hash: str) -> str:
    material = json.dumps(
        {
            "seq": seq, "kind": kind, "correlation_id": correlation_id,
            "recorded_at": recorded_at, "payload": payload, "prev_hash": prev_hash,
        },
        sort_keys=True, separators=(",", ":"),
    )
    return hashlib.sha256(material.encode()).hexdigest()


class AuditLog:
    """Writes JSON lines, chained. One instance per process.

    ``sink`` receives each serialised line. The default writes to a file;
    passing a sink that raises is how the halt path gets tested.
    """

    def __init__(
        self,
        path: Optional[str | Path] = None,
        sink: Optional[Callable[[str], None]] = None,
        buffer_limit: int = 10_000,
        clock: Callable[[], Nanos] = now_ns,
    ) -> None:
        self.path = Path(path) if path else None
        self._sink = sink
        self.buffer_limit = buffer_limit
        self.clock = clock
        self.seq = 0
        self.last_hash = GENESIS
        self._buffer: Deque[str] = deque()
        self.halted = False
        self.halt_reason: Optional[str] = None
        if self.path is not None:
            self.path.parent.mkdir(parents=True, exist_ok=True)

    # -- writing ---------------------------------------------------------

    def record(self, kind: str, payload: Any, correlation_id: str = "") -> AuditRecord:
        """Append one record. Raises :class:`AuditBufferFull` when the path is lost."""
        if self.halted:
            raise AuditBufferFull(self.halt_reason or "audit halted")

        self.seq += 1
        at = self.clock()
        encoded = _encode(payload)
        h = _hash(self.seq, kind, correlation_id, at, encoded, self.last_hash)
        rec = AuditRecord(
            seq=self.seq, kind=kind, correlation_id=correlation_id,
            recorded_at=at, payload=encoded, prev_hash=self.last_hash, hash=h,
        )
        line = json.dumps(
            {
                "seq": rec.seq, "kind": rec.kind, "correlation_id": rec.correlation_id,
                "recorded_at": rec.recorded_at, "payload": rec.payload,
                "prev_hash": rec.prev_hash, "hash": rec.hash,
            },
            sort_keys=True, separators=(",", ":"),
        )
        self.last_hash = h
        self._emit(line)
        return rec

    def _emit(self, line: str) -> None:
        try:
            self._write(line)
            # Path is healthy again; drain anything we buffered while it was not.
            while self._buffer:
                self._write(self._buffer[0])
                self._buffer.popleft()
        except AuditBufferFull:
            raise
        except Exception as e:
            self._buffer.append(line)
            if len(self._buffer) >= self.buffer_limit:
                self.halted = True
                self.halt_reason = (
                    f"audit buffer full after {len(self._buffer)} records ({e}); "
                    "trading must halt - a system that cannot record what it is "
                    "doing cannot be reconciled afterwards"
                )
                raise AuditBufferFull(self.halt_reason) from e

    def _write(self, line: str) -> None:
        if self._sink is not None:
            self._sink(line)
        elif self.path is not None:
            with open(self.path, "a", encoding="utf-8") as fh:
                fh.write(line + "\n")

    @property
    def buffered(self) -> int:
        return len(self._buffer)

    @property
    def must_halt_trading(self) -> bool:
        return self.halted

    def recover(self) -> None:
        """Clear the halt after the audit path is restored and the backlog flushed."""
        if self._buffer:
            raise AuditBufferFull("backlog not flushed; cannot recover yet")
        self.halted = False
        self.halt_reason = None

    # -- reading ---------------------------------------------------------

    def read(self) -> Iterator[Dict[str, Any]]:
        if self.path is None or not self.path.exists():
            return iter(())
        def gen():
            with open(self.path, "r", encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line:
                        yield json.loads(line)
        return gen()

    def verify(self) -> bool:
        return verify_chain(self.read())


def verify_chain(records: Iterable[Mapping[str, Any]]) -> bool:
    """Verify a chain end to end. Raises :class:`ChainBroken` on the first fault.

    Checks three things, because a tamperer would have to defeat all three:
    the sequence increments, each record links to its predecessor, and each
    record's own hash matches its contents.
    """
    prev = GENESIS
    expected_seq = 1
    for rec in records:
        if rec["seq"] != expected_seq:
            raise ChainBroken(f"sequence jumped: expected {expected_seq}, got {rec['seq']}")
        if rec["prev_hash"] != prev:
            raise ChainBroken(
                f"record {rec['seq']} links to {rec['prev_hash'][:12]}... "
                f"but the previous record hashed to {prev[:12]}...; a record was "
                "altered or removed"
            )
        recomputed = _hash(rec["seq"], rec["kind"], rec["correlation_id"],
                           rec["recorded_at"], rec["payload"], rec["prev_hash"])
        if recomputed != rec["hash"]:
            raise ChainBroken(f"record {rec['seq']} contents do not match its own hash")
        prev = rec["hash"]
        expected_seq += 1
    return True
