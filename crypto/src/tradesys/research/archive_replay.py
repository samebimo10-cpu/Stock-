"""Reading a captured archive back as market events.

The other half of :mod:`tradesys.live.capture`. Capture writes the bytes as
they arrived; this turns them back into the same
:class:`~tradesys.core.events.MarketEvent` objects a scenario produces, so the
backtester and the validation harness consume real captured data through
exactly the path they already use.

That sameness is the point, and it is SPEC section 3.4's "one code path"
reaching its last unclaimed corner. A separate loader for real data would be a
second implementation of decoding, and the two would diverge - quietly, in the
direction that flatters the backtest, because that is the version nobody
double-checks.

So the decoder here is **the live decoder**. `BinanceFeed.decode` is the same
object the live runner uses. A bug in it shows up identically in research and
in production, which is the only arrangement under which research results mean
anything about production.

One deliberate limitation: depth deltas cannot be replayed into a book without
the REST snapshots that were never archived, because a snapshot is a REST call
rather than a stream message. Replay therefore reconstructs the book from the
deltas it has and marks the warm-up window unusable, rather than pretending.
See :func:`replay_events`.
"""

from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Dict, Iterable, Iterator, List, Mapping, Optional, Sequence

from ..core.events import MarketEvent
from ..core.types import Nanos
from ..layers.l1_data.archive import Normaliser, RawArchive

__all__ = ["ArchiveSource", "ReplayReport", "read_raw", "replay_events"]


@dataclass
class ReplayReport:
    parts: int = 0
    records: int = 0
    events: int = 0
    undecodable: int = 0
    gap_windows: int = 0
    venues: Dict[str, int] = field(default_factory=dict)
    first_ts: Optional[Nanos] = None
    last_ts: Optional[Nanos] = None

    @property
    def span_days(self) -> float:
        if self.first_ts is None or self.last_ts is None:
            return 0.0
        return (self.last_ts - self.first_ts) / 1e9 / 86400

    def __str__(self) -> str:
        return (f"{self.parts} parts, {self.records} records, {self.events} events, "
                f"{self.span_days:.1f} days, {self.undecodable} undecodable")


class ArchiveSource:
    """Reads one venue's captured parts, verified, in time order.

    Verification is on by default and should stay on. The archive's whole
    claim is that the bytes are the bytes that arrived; a read that skips the
    checksum is a read that cannot distinguish a corrupted part from a quiet
    market.
    """

    def __init__(self, root: str | Path, venue: str, verify: bool = True) -> None:
        self.archive = RawArchive(root)
        self.venue = venue
        self.verify = verify

    def parts(self, stream: Optional[str] = None) -> List[Path]:
        """Every part for this venue, in partition order.

        Sorted by path, which sorts by date then hour then part index because
        the partition layout was designed that way. Sorting by modification
        time would reorder anything recompressed or restored from backup.
        """
        return sorted(self.archive.parts(self.venue, stream))

    def records(self, stream: Optional[str] = None) -> Iterator[Dict[str, Any]]:
        for path in self.parts(stream):
            for record in self.archive.read_part(path, verify=self.verify):
                yield record


def read_raw(root: str | Path, venue: str, stream: Optional[str] = None,
             verify: bool = True) -> List[Dict[str, Any]]:
    """Every captured record for a venue, as written."""
    return list(ArchiveSource(root, venue, verify).records(stream))


async def replay_events(root: str | Path, venue: str,
                        feed_venue: Optional[str] = None,
                        stream: Optional[str] = None,
                        verify: bool = True,
                        report: Optional[ReplayReport] = None) -> List[MarketEvent]:
    """Captured archive to market events, through the live decoder.

    ``feed_venue`` renames the venue on the emitted events, which is how a
    capture from ``binance-futures`` drives a scenario wired for a different
    venue name without editing either.

    **Depth deltas produce no book until a snapshot exists**, and snapshots are
    REST calls that the stream capture never saw. The decoder handles this the
    same way it handles a cold start in production: the first delta requests a
    resync, no adapter is present to serve one, and the book stays empty until
    enough deltas have accumulated. The affected events carry
    ``resync_in_progress`` and research excludes them.

    Capturing periodic REST snapshots alongside the stream would remove the
    limitation. That is a real gap and it is named here rather than papered
    over, because a replay that silently starts its book from the first delta
    would be a replay whose early trades are priced against a book with holes.
    """
    from ..live.binance_live import BinanceFeed

    rep = report if report is not None else ReplayReport()
    source = ArchiveSource(root, venue, verify)
    rep.parts = len(source.parts(stream))

    feed = BinanceFeed(feed_venue or venue, adapter=None)
    out: List[MarketEvent] = []

    for record in source.records(stream):
        rep.records += 1
        recv = int(record.get("local_recv_ts", 0))
        message = record.get("message")
        if not isinstance(message, Mapping):
            rep.undecodable += 1
            continue
        if rep.first_ts is None:
            rep.first_ts = recv
        rep.last_ts = recv
        try:
            events = await feed.decode(message, local_recv_ts=recv)
        except Exception:                                      # noqa: BLE001
            # A message the decoder cannot handle is counted, not raised.
            # Six months of capture will contain a handful of malformed or
            # unrecognised payloads, and aborting the whole replay on one of
            # them is how a research run becomes impossible to complete.
            rep.undecodable += 1
            continue
        for event in events:
            if event.quality.gap_detected:
                rep.gap_windows += 1
            rep.events += 1
            rep.venues[event.venue] = rep.venues.get(event.venue, 0) + 1
            out.append(event)

    # Order by the venue's clock, not by arrival. Two streams on one connection
    # can arrive out of order relative to each other, and a backtest fed in
    # arrival order sees a trade before the book update that caused it.
    out.sort(key=lambda e: (e.exchange_ts, e.sequence or 0))
    return out


def normalised_rows(root: str | Path, venue: str,
                    stream: Optional[str] = None) -> List[Dict[str, Any]]:
    """The archive through the versioned normaliser.

    Used for the research primitive and for checking determinism; the event
    replay above goes through the live decoder instead, on purpose.
    """
    return Normaliser().normalise(read_raw(root, venue, stream))
