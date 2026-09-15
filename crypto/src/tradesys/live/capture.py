"""Writing down what arrived, so that months from now there is something to test.

This is the least interesting file in the system and the one that decides
whether any of the rest of it was worth building. Every strategy here is
unvalidated for exactly one reason: there is no archived market data to
validate against. The only way to get some is to start capturing, and the only
way capture is worth anything is if it runs unattended for months without
losing a day.

So the design goals are boring on purpose:

* **Raw, not decoded.** The bytes as they arrived, before any interpretation.
  A decoded archive can only ever answer the questions the decoder already
  understood, and the decoder is the part most likely to be wrong. SPEC section
  4.3: write-once raw, plus a deterministic versioned normalisation on top.
* **Survives a restart without losing or duplicating a day.** The archive is
  write-once and partitioned by hour, so a restart opens a new part file in the
  same partition. Deduplication is the normaliser's job, by sequence where one
  exists.
* **Refuses to fill the disk.** A capture process that fills the volume takes
  the machine down with it, and it does so at three in the morning after
  running fine for six weeks.
* **Flushes on time as well as on size.** A quiet symbol must not sit in a
  buffer for an hour; the buffered records are the ones lost to a crash.
"""

from __future__ import annotations

import json
import shutil
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Callable, Dict, List, Mapping, Optional, Tuple

from ..core.types import Nanos, now_ns
from ..layers.l1_data.archive import RawArchive

__all__ = ["CaptureConfig", "CaptureStats", "ArchiveWriter", "DiskFull"]


class DiskFull(RuntimeError):
    """Raised before the disk actually fills, not after.

    After is too late: the process that fills a volume takes everything else on
    the box with it, and it does so unattended.
    """


@dataclass(frozen=True)
class CaptureConfig:
    root: Path
    #: Flush when this many records are buffered.
    batch: int = 2_000
    #: Or when this long has passed, whichever comes first. A quiet symbol
    #: must not sit in a buffer for an hour - buffered records are exactly the
    #: ones a crash loses.
    flush_interval_ns: int = 60 * 1_000_000_000
    #: Stop capturing when free space falls below this. Stopping cleanly with a
    #: loud error beats filling the volume.
    min_free_bytes: int = 2 * 1024 ** 3
    #: How often to actually stat the filesystem. Checking on every record
    #: would dominate the cost of capture.
    disk_check_every: int = 10_000
    #: Never write a part smaller than this except on shutdown. A timer tick
    #: during a quiet minute would otherwise produce a three-record file, and
    #: over months part count is an operational constraint - inode tables and
    #: read performance both care.
    min_part_records: int = 100
    compress: bool = True


@dataclass
class CaptureStats:
    received: int = 0
    written: int = 0
    parts: int = 0
    bytes_written: int = 0
    flushes: int = 0
    dropped_unusable: int = 0
    first_ts: Optional[Nanos] = None
    last_ts: Optional[Nanos] = None
    by_stream: Dict[str, int] = field(default_factory=dict)

    @property
    def span_hours(self) -> float:
        if self.first_ts is None or self.last_ts is None:
            return 0.0
        return (self.last_ts - self.first_ts) / 1e9 / 3600

    def __str__(self) -> str:
        return (f"received={self.received} written={self.written} "
                f"parts={self.parts} MB={self.bytes_written / 1e6:.1f} "
                f"span={self.span_hours:.1f}h")


class ArchiveWriter:
    """Buffers raw messages and flushes them into the write-once archive.

    One writer per venue. Streams are partitioned inside it, because the
    archive's layout is venue/stream/date/hour and mixing streams into one part
    file would make a targeted re-read impossible.
    """

    def __init__(self, venue: str, config: CaptureConfig,
                 clock: Callable[[], Nanos] = now_ns,
                 archive: Optional[RawArchive] = None) -> None:
        self.venue = venue
        self.config = config
        self.clock = clock
        self.archive = archive or RawArchive(config.root, compress=config.compress)
        self.stats = CaptureStats()
        self._buffers: Dict[str, List[Dict[str, Any]]] = {}
        self._last_flush = clock()
        self._since_disk_check = 0

    # ------------------------------------------------------------------

    def offer(self, message: Mapping[str, Any], local_recv_ts: Optional[Nanos] = None,
              stream: Optional[str] = None) -> None:
        """Buffer one raw message exactly as it arrived.

        The only thing added is ``local_recv_ts``, and it is added because it
        cannot be recovered later: the venue's own timestamp says when the
        venue sent it, and the difference between the two is both the latency
        measurement and the data-quality signal. An archive without it is an
        archive that can never answer how late anything was.
        """
        recv = local_recv_ts if local_recv_ts is not None else self.clock()
        name = stream or str(message.get("stream") or _infer_stream(message))
        record = {
            "stream": name,
            "local_recv_ts": int(recv),
            "message": message,
        }
        self._buffers.setdefault(name, []).append(record)
        self.stats.received += 1
        self.stats.by_stream[name] = self.stats.by_stream.get(name, 0) + 1
        if self.stats.first_ts is None:
            self.stats.first_ts = recv
        self.stats.last_ts = recv

        self._since_disk_check += 1
        if self._since_disk_check >= self.config.disk_check_every:
            self._since_disk_check = 0
            self.check_disk()

        if self._should_flush():
            self.flush()

    def _should_flush(self) -> bool:
        """Wall clock, never the message's own timestamp.

        The first version compared ``local_recv_ts`` against a flush time taken
        from ``self.clock()``. Those are two different clocks, and mixing them
        means any skew between them reads as "the flush interval elapsed" - on
        every single record. It produced 1140 part files for 1200 records in
        the first end-to-end test, which over three months of real capture is
        millions of tiny files, an exhausted inode table, and an archive too
        slow to read back.

        The flush cadence is about how much data a crash would lose, which is a
        question about wall time.
        """
        if self.clock() - self._last_flush >= self.config.flush_interval_ns:
            return True
        return any(len(rows) >= self.config.batch for rows in self._buffers.values())

    def flush(self, force: bool = False) -> List[Path]:
        """Write every non-empty buffer. Safe to call at any time.

        Called on the timer, on the batch trigger, and on shutdown. The
        shutdown call is the one that matters: without it the last minute of
        capture is lost every time the process stops, including every
        deployment.

        A buffer below ``min_part_records`` is left alone unless ``force``, so
        a timer tick during a quiet minute does not write a three-record part
        file. Over months, part count is a real operational constraint rather
        than an aesthetic one.
        """
        written: List[Path] = []
        for stream, rows in list(self._buffers.items()):
            if not rows:
                continue
            if not force and len(rows) < self.config.min_part_records:
                continue
            self.check_disk()
            path = self.archive.write(self.venue, stream, rows)
            written.append(path)
            self.stats.parts += 1
            self.stats.written += len(rows)
            try:
                self.stats.bytes_written += path.stat().st_size
            except OSError:                                    # pragma: no cover
                pass
            self._buffers[stream] = []
        self._last_flush = self.clock()
        if written:
            self.stats.flushes += 1
        return written

    def check_disk(self) -> None:
        free = shutil.disk_usage(self.archive.root).free
        if free < self.config.min_free_bytes:
            raise DiskFull(
                f"{free / 1e9:.1f}GB free at {self.archive.root}, below the "
                f"{self.config.min_free_bytes / 1e9:.1f}GB floor. Stopping "
                "capture rather than filling the volume - a full disk takes "
                "the whole box down, unattended, at three in the morning."
            )

    @property
    def buffered(self) -> int:
        return sum(len(rows) for rows in self._buffers.values())

    def close(self) -> CaptureStats:
        """Flush everything, including short buffers. The last call before exit."""
        self.flush(force=True)
        return self.stats


def _infer_stream(message: Mapping[str, Any]) -> str:
    """A name for a payload that did not arrive in a combined-stream envelope.

    Falls back to the event type, then to ``unknown``. Never raises: a message
    we cannot name is still a message worth keeping, and refusing to archive it
    would lose exactly the surprising ones.
    """
    data = message.get("data", message)
    if isinstance(data, Mapping):
        kind = data.get("e")
        symbol = data.get("s")
        if kind and symbol:
            return f"{str(symbol).lower()}@{kind}"
        if kind:
            return str(kind)
    return "unknown"


def estimate_daily_bytes(stats: CaptureStats) -> Optional[float]:
    """Extrapolate the daily archive size from what has been written so far.

    Returned so an operator can answer "will this fit for six months" before
    finding out empirically. ``None`` until there is enough span to extrapolate
    from - a guess from ninety seconds of capture is worse than no guess.
    """
    if stats.span_hours < 0.25 or stats.bytes_written == 0:
        return None
    return stats.bytes_written / stats.span_hours * 24
