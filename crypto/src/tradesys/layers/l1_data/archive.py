"""Raw archive and normalisation (SPEC section 4.3).

Two layers, and the distinction between them is the whole point:

* ``raw/`` holds the **exact bytes from the wire** plus a local receive
  timestamp. Write-once, checksummed, never read by the trading system. It is
  the only irreplaceable asset in the building: a strategy can be rewritten,
  last March cannot be re-recorded.
* ``norm/`` holds a typed, deduplicated, gap-annotated view. It is the research
  primitive, and it is **regenerable from raw by a pure function**, which is
  what makes it safe to change how normalisation works.

The hard requirement (SPEC section 4.3) is that re-running normalisation
version *N* on the same raw bytes produces byte-identical output. Without that
property "regenerable" is a hope, and a backtest from last year cannot be
reproduced.

Layout::

    raw/  venue=X/stream=Y/date=YYYY-MM-DD/hour=HH/part-NNNN.jsonl[.zst]
    norm/ venue=X/symbol=Z/date=YYYY-MM-DD/part-NNNN.jsonl
    feat/ regenerable, 90 day retention

Compression is optional and transparent: the checksum is always taken over the
uncompressed bytes, so a file that is later recompressed still verifies.
"""

from __future__ import annotations

import gzip
import hashlib
import json
import os
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence, Tuple

from ...core.types import Nanos, dec

__all__ = ["RawArchive", "Normaliser", "NORMALISER_VERSION", "ArchiveError",
           "ImmutableViolation", "ChecksumMismatch", "partition_for", "Retention"]

#: Bumping this creates a new normalisation version. It never silently changes
#: history: old output stays on disk under its own version, and a backtest
#: records which version it read.
NORMALISER_VERSION = 1


class ArchiveError(RuntimeError):
    pass


class ImmutableViolation(ArchiveError):
    """An attempt to overwrite raw data.

    Normalisation logic will change; raw data will not. Refusing the write is
    the only enforcement that survives a tired operator.
    """


class ChecksumMismatch(ArchiveError):
    """Stored bytes do not match their recorded digest."""


def partition_for(venue: str, stream: str, at_ns: Nanos) -> Tuple[str, str]:
    """Return the (date, hour) partition an event belongs in, in UTC.

    UTC always. Partitioning by local time puts a daylight-saving transition
    inside the data and produces a day with 23 or 25 hours in it.

    >>> partition_for("binance", "depth", 1_700_000_000_000_000_000)
    ('2023-11-14', '22')
    """
    moment = datetime.fromtimestamp(at_ns / 1e9, tz=timezone.utc)
    return moment.strftime("%Y-%m-%d"), moment.strftime("%H")


@dataclass(frozen=True)
class Retention:
    """SPEC section 4.3.

    ``raw`` is kept indefinitely for traded symbols. ``feat`` is regenerable,
    so it is the only tier with a short life.
    """

    raw_days: Optional[int] = None       # None means indefinitely
    norm_days: Optional[int] = None
    feat_days: int = 90

    def expired(self, tier: str, age_days: int) -> bool:
        limit = {"raw": self.raw_days, "norm": self.norm_days, "feat": self.feat_days}[tier]
        return limit is not None and age_days > limit


# ----------------------------------------------------------------------
# Raw archive
# ----------------------------------------------------------------------


class RawArchive:
    """Write-once storage for exactly what arrived on the wire."""

    def __init__(self, root: str | Path, compress: bool = False) -> None:
        self.root = Path(root)
        self.compress = compress
        self.root.mkdir(parents=True, exist_ok=True)

    # -- paths -----------------------------------------------------------

    def partition_dir(self, venue: str, stream: str, at_ns: Nanos) -> Path:
        date, hour = partition_for(venue, stream, at_ns)
        return self.root / f"venue={venue}" / f"stream={stream}" / f"date={date}" / f"hour={hour}"

    def _part_path(self, directory: Path, index: int) -> Path:
        suffix = ".jsonl.gz" if self.compress else ".jsonl"
        return directory / f"part-{index:04d}{suffix}"

    def _next_part(self, directory: Path) -> Path:
        directory.mkdir(parents=True, exist_ok=True)
        index = 0
        while self._part_path(directory, index).exists():
            index += 1
        return self._part_path(directory, index)

    # -- writing ---------------------------------------------------------

    def write(self, venue: str, stream: str, records: Sequence[Mapping[str, Any]],
              at_ns: Optional[Nanos] = None) -> Path:
        """Append a part file. Never modifies an existing one.

        Each record must carry ``local_recv_ts``; that timestamp is what makes
        the archive a latency measurement as well as a data store, and there is
        no way to recover it later.
        """
        if not records:
            raise ArchiveError("refusing to write an empty part")
        for record in records:
            if "local_recv_ts" not in record:
                raise ArchiveError(
                    "every raw record needs local_recv_ts; the venue timestamp "
                    "alone cannot tell you how late the data was"
                )

        anchor = at_ns if at_ns is not None else int(records[0]["local_recv_ts"])
        directory = self.partition_dir(venue, stream, anchor)
        path = self._next_part(directory)

        payload = "\n".join(
            json.dumps(r, sort_keys=True, separators=(",", ":"), default=str)
            for r in records
        ) + "\n"
        raw_bytes = payload.encode()

        if self.compress:
            # GzipFile rather than gzip.open, because only GzipFile accepts
            # mtime. Pinning it to zero keeps the compressed bytes reproducible:
            # without it the same records compress differently every run and the
            # archive stops being comparable across machines.
            with open(path, "wb") as fh:
                with gzip.GzipFile(fileobj=fh, mode="wb", compresslevel=6, mtime=0) as gz:
                    gz.write(raw_bytes)
        else:
            path.write_bytes(raw_bytes)

        # Checksum over the uncompressed bytes, so recompressing later still
        # verifies. A digest of the compressed form would make the storage
        # format part of the integrity guarantee, which it is not.
        self._write_checksum(path, hashlib.sha256(raw_bytes).hexdigest(), len(records))
        self._make_read_only(path)
        return path

    def _checksum_path(self, path: Path) -> Path:
        return path.with_suffix(path.suffix + ".sha256")

    def _write_checksum(self, path: Path, digest: str, count: int) -> None:
        self._checksum_path(path).write_text(
            json.dumps({"sha256": digest, "records": count,
                        "normaliser_hint": NORMALISER_VERSION}, sort_keys=True) + "\n",
            encoding="utf-8",
        )

    @staticmethod
    def _make_read_only(path: Path) -> None:
        """Drop the write bit. A speed bump, not a security control.

        Anyone with the file can chmod it back. The point is that an accidental
        overwrite fails loudly rather than succeeding quietly.
        """
        try:
            os.chmod(path, 0o444)
        except OSError:
            pass

    def overwrite_guard(self, path: Path) -> None:
        if path.exists():
            raise ImmutableViolation(
                f"{path} already exists. Raw data is write-once: normalisation "
                "logic will change, raw data will not."
            )

    # -- reading ---------------------------------------------------------

    def parts(self, venue: Optional[str] = None, stream: Optional[str] = None) -> List[Path]:
        pattern = f"venue={venue}" if venue else "venue=*"
        pattern += f"/stream={stream}" if stream else "/stream=*"
        return sorted(p for p in self.root.glob(pattern + "/date=*/hour=*/part-*")
                      if not p.name.endswith(".sha256"))

    def read_part(self, path: Path, verify: bool = True) -> List[Dict[str, Any]]:
        raw_bytes = gzip.decompress(path.read_bytes()) if path.suffix == ".gz" \
            else path.read_bytes()
        if verify:
            self._verify_bytes(path, raw_bytes)
        return [json.loads(line) for line in raw_bytes.decode().splitlines() if line]

    def _verify_bytes(self, path: Path, raw_bytes: bytes) -> None:
        checksum_path = self._checksum_path(path)
        if not checksum_path.exists():
            raise ChecksumMismatch(f"{path} has no recorded checksum")
        recorded = json.loads(checksum_path.read_text())["sha256"]
        actual = hashlib.sha256(raw_bytes).hexdigest()
        if actual != recorded:
            raise ChecksumMismatch(
                f"{path} does not match its recorded digest "
                f"({actual[:12]}... vs {recorded[:12]}...). The archive has been "
                "altered or corrupted; do not use it for research until resolved."
            )

    def verify_all(self, venue: Optional[str] = None) -> Tuple[int, List[str]]:
        """Verify every part. Returns (checked, failures)."""
        failures: List[str] = []
        checked = 0
        for path in self.parts(venue):
            checked += 1
            try:
                self.read_part(path, verify=True)
            except ArchiveError as e:
                failures.append(str(e))
        return checked, failures

    def read_all(self, venue: Optional[str] = None,
                 stream: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        for path in self.parts(venue, stream):
            yield from self.read_part(path)


# ----------------------------------------------------------------------
# Normalisation
# ----------------------------------------------------------------------


class Normaliser:
    """A pure, versioned function from raw records to the research primitive.

    Pure in the sense that matters: same input bytes and same version produce
    byte-identical output. No clock reads, no randomness, no ordering that
    depends on dictionary iteration or on how many files the input arrived in.

    Deduplication is by ``(stream, sequence)`` where a sequence exists, and by
    the full record digest otherwise. Gaps are **annotated, not repaired**: a
    window that is missing data is marked unusable so research excludes it,
    because research silently trained on a gap window learns to trade a
    reconnection.
    """

    version = NORMALISER_VERSION

    def __init__(self, version: Optional[int] = None) -> None:
        self.version = version if version is not None else NORMALISER_VERSION

    # -- the function ----------------------------------------------------

    def normalise(self, records: Iterable[Mapping[str, Any]]) -> List[Dict[str, Any]]:
        """Type, deduplicate, order and gap-annotate."""
        typed: List[Dict[str, Any]] = []
        seen_keys: set = set()
        duplicates = 0

        for record in records:
            key = self._dedupe_key(record)
            if key in seen_keys:
                duplicates += 1
                continue
            seen_keys.add(key)
            typed.append(self._type_record(record))

        # Deterministic order: exchange time, then sequence, then the digest.
        # The digest tiebreak matters - without it two records sharing a
        # timestamp and no sequence could order differently between runs, and
        # the byte-identical guarantee would quietly not hold.
        typed.sort(key=lambda r: (r["exchange_ts"], r.get("sequence") or 0, r["_digest"]))

        self._annotate_gaps(typed)
        for row in typed:
            row.pop("_digest", None)
            row["normaliser_version"] = self.version
        return typed

    def _dedupe_key(self, record: Mapping[str, Any]) -> Tuple:
        stream = record.get("stream", "")
        sequence = record.get("sequence")
        if sequence is not None:
            return (stream, "seq", int(sequence))
        return (stream, "digest", self._digest(record))

    @staticmethod
    def _digest(record: Mapping[str, Any]) -> str:
        return hashlib.sha256(
            json.dumps(record, sort_keys=True, separators=(",", ":"), default=str).encode()
        ).hexdigest()

    def _type_record(self, record: Mapping[str, Any]) -> Dict[str, Any]:
        out: Dict[str, Any] = {
            "venue": str(record.get("venue", "")),
            "symbol": str(record.get("symbol", "")),
            "stream": str(record.get("stream", "")),
            "kind": str(record.get("kind", "")),
            "exchange_ts": int(record.get("exchange_ts", 0)),
            "local_recv_ts": int(record["local_recv_ts"]),
            "sequence": int(record["sequence"]) if record.get("sequence") is not None else None,
            "payload": record.get("payload"),
            "_digest": self._digest(record),
        }
        # Numbers stay as strings. They came off the wire as strings, and
        # parsing them to float here would round a price in the one file that
        # is supposed to be exact.
        out["transit_ns"] = out["local_recv_ts"] - out["exchange_ts"]
        return out

    @staticmethod
    def _annotate_gaps(rows: List[Dict[str, Any]]) -> None:
        """Mark sequence discontinuities per stream. Annotate, never repair."""
        last_seq: Dict[str, int] = {}
        for row in rows:
            stream = row["stream"]
            sequence = row["sequence"]
            row["gap_before"] = False
            if sequence is None:
                continue
            previous = last_seq.get(stream)
            if previous is not None and sequence > previous + 1:
                row["gap_before"] = True
                row["gap_size"] = sequence - previous - 1
            last_seq[stream] = sequence

    # -- disk ------------------------------------------------------------

    def serialise(self, rows: Sequence[Mapping[str, Any]]) -> bytes:
        """Stable bytes for a normalised partition."""
        return ("\n".join(json.dumps(r, sort_keys=True, separators=(",", ":"), default=str)
                          for r in rows) + "\n").encode() if rows else b""

    def write(self, norm_root: str | Path, venue: str, symbol: str,
              rows: Sequence[Mapping[str, Any]], date: str) -> Path:
        directory = Path(norm_root) / f"venue={venue}" / f"symbol={symbol}" / f"date={date}"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"part-v{self.version:03d}.jsonl"
        path.write_bytes(self.serialise(rows))
        return path

    def regenerate(self, archive: RawArchive, norm_root: str | Path,
                   venue: Optional[str] = None) -> Dict[str, Path]:
        """Rebuild the normalised layer from raw.

        Routine, not heroic. If regenerating is a big operation nobody does it,
        and then the normalised layer becomes the source of truth by default.
        """
        by_partition: Dict[Tuple[str, str, str], List[Dict[str, Any]]] = {}
        for path in archive.parts(venue):
            for record in archive.read_part(path):
                date, _ = partition_for(str(record.get("venue", "")),
                                        str(record.get("stream", "")),
                                        int(record["local_recv_ts"]))
                key = (str(record.get("venue", "")), str(record.get("symbol", "")), date)
                by_partition.setdefault(key, []).append(dict(record))

        written: Dict[str, Path] = {}
        for (venue_name, symbol, date), records in sorted(by_partition.items()):
            rows = self.normalise(records)
            written[f"{venue_name}/{symbol}/{date}"] = self.write(
                norm_root, venue_name, symbol, rows, date
            )
        return written

    def is_deterministic(self, records: Sequence[Mapping[str, Any]]) -> bool:
        """The hard requirement, as a callable check.

        Re-running version N on the same raw bytes must produce byte-identical
        output. Verified in CI on a fixed sample.
        """
        first = self.serialise(self.normalise([dict(r) for r in records]))
        shuffled = list(reversed([dict(r) for r in records]))
        second = self.serialise(self.normalise(shuffled))
        return first == second
