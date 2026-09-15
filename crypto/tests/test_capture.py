"""Capture and replay: the step everything else is waiting on.

Every strategy in this repository is unvalidated because there is no archived
data to validate against. These tests cover the machinery that produces some,
and the machinery that reads it back - and in particular the failure modes that
only show up after weeks of running, which is exactly when nobody is watching.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from tradesys.core.types import dec
from tradesys.layers.l1_data.archive import RawArchive
from tradesys.live.capture import (
    ArchiveWriter, CaptureConfig, DiskFull, estimate_daily_bytes,
)
from tradesys.research.archive_replay import (
    ArchiveSource, ReplayReport, read_raw, replay_events,
)

START = 1_700_000_000_000_000_000


def writer(tmp_path, clock=None, **overrides):
    # min_part_records defaults to 100 in production, which would swallow every
    # flush in a test that writes a handful of records. Tests that care about
    # the floor set it explicitly.
    kw = {"root": tmp_path, "batch": 50, "compress": False, "min_part_records": 1}
    kw.update(overrides)
    return ArchiveWriter("binance-futures", CaptureConfig(**kw),
                         clock=clock or (lambda: START))


def trade(i):
    return {"stream": "btcusdt@aggTrade",
            "data": {"e": "aggTrade", "E": 1000 + i, "T": 1000 + i, "s": "BTCUSDT",
                     "p": "60000", "q": "1", "m": i % 2 == 0, "a": i}}


# ------------------------------------------------------------------- writing


def test_capture_writes_the_message_exactly_as_it_arrived(tmp_path):
    """Raw, not decoded. A decoded archive can only answer the questions the
    decoder already understood, and the decoder is the part most likely to be
    wrong."""
    w = writer(tmp_path)
    w.offer(trade(1))
    w.close()
    records = read_raw(tmp_path, "binance-futures")
    assert records[0]["message"] == trade(1)


def test_capture_stamps_the_local_receive_time(tmp_path):
    """The venue's timestamp says when the venue sent it. The difference is
    both the latency measurement and the data-quality signal, and it cannot be
    recovered later."""
    w = writer(tmp_path)
    w.offer(trade(1), local_recv_ts=START + 7)
    w.close()
    assert read_raw(tmp_path, "binance-futures")[0]["local_recv_ts"] == START + 7


def test_the_flush_trigger_uses_wall_time_not_the_message_timestamp(tmp_path):
    """Mixing the two clocks reads as "the interval elapsed" on every record.

    The first version did, and produced 1140 part files for 1200 records - over
    three months of real capture that is millions of tiny files, an exhausted
    inode table, and an archive too slow to read back.
    """
    now = {"t": START}
    w = writer(tmp_path, clock=lambda: now["t"], batch=500)
    for i in range(400):
        now["t"] += 500_000_000
        # Message timestamps far from the wall clock, which is the case that
        # broke it: a replayed capture, a skewed venue clock, or any feed
        # whose timestamps are not in the same epoch as ours.
        w.offer(trade(i), local_recv_ts=START + i * 10**9 * 3600)
    w.close()
    assert w.stats.parts <= 10, f"{w.stats.parts} parts for 400 records"


def test_a_quiet_minute_does_not_produce_a_three_record_part(tmp_path):
    now = {"t": START}
    w = writer(tmp_path, clock=lambda: now["t"], batch=500, min_part_records=100)
    for i in range(3):
        w.offer(trade(i))
    now["t"] += 10 * 60 * 10**9          # ten minutes later
    w.offer(trade(99))
    assert w.stats.parts == 0, "a timer tick must not flush a near-empty buffer"


def test_shutdown_flushes_even_a_short_buffer(tmp_path):
    """Without it the last minute is lost on every stop, including every
    deployment - which over months is a great deal of data lost to tidiness."""
    w = writer(tmp_path, batch=500, min_part_records=100)
    w.offer(trade(1))
    assert w.stats.parts == 0
    w.close()
    assert w.stats.parts == 1
    assert len(read_raw(tmp_path, "binance-futures")) == 1


def test_streams_are_partitioned_separately(tmp_path):
    """Mixing streams into one part file makes a targeted re-read impossible."""
    w = writer(tmp_path, batch=1)
    w.offer(trade(1))
    w.offer({"stream": "btcusdt@forceOrder",
             "data": {"e": "forceOrder", "E": 1, "o": {"s": "BTCUSDT"}}})
    w.close()
    streams = {p.parts[-4] for p in RawArchive(tmp_path).parts()}
    assert streams == {"stream=btcusdt@aggTrade", "stream=btcusdt@forceOrder"}


def test_an_unnamed_message_is_still_archived(tmp_path):
    """A message we cannot name is still worth keeping - refusing would lose
    exactly the surprising ones."""
    w = writer(tmp_path, batch=1)
    w.offer({"something": "unrecognised"})
    w.close()
    assert w.stats.written == 1


def test_capture_stops_before_the_disk_fills(tmp_path):
    """After is too late: the process that fills a volume takes everything
    else on the box with it, unattended."""
    w = writer(tmp_path, min_free_bytes=10 ** 18)      # more than any real disk
    with pytest.raises(DiskFull):
        w.check_disk()


def test_the_archive_is_write_once(tmp_path):
    """Checked through the guard rather than through file permissions.

    A test that relies on a read-only bit silently passes nothing when the
    suite runs as root, which is exactly how CI runs in a container.
    """
    from tradesys.layers.l1_data.archive import ImmutableViolation

    w = writer(tmp_path, batch=1)
    w.offer(trade(1))
    w.close()
    archive = RawArchive(tmp_path)
    part = archive.parts()[0]
    with pytest.raises(ImmutableViolation):
        archive.overwrite_guard(part)


def test_daily_size_is_not_extrapolated_from_ninety_seconds(tmp_path):
    """A guess from too little span is worse than no guess."""
    w = writer(tmp_path, batch=1)
    w.offer(trade(1))
    w.close()
    assert estimate_daily_bytes(w.stats) is None


# ------------------------------------------------------------------ replaying


def capture_some(tmp_path, count=60):
    w = writer(tmp_path, batch=25)
    for i in range(count):
        w.offer(trade(i), local_recv_ts=START + i * 10 ** 9)
    w.close()
    return w


def test_replay_produces_the_same_events_the_live_decoder_would(tmp_path):
    """The decoder IS the live decoder. A separate loader for research data
    would be a second implementation that diverges in the direction that
    flatters the backtest."""
    capture_some(tmp_path)
    report = ReplayReport()
    events = asyncio.run(replay_events(tmp_path, "binance-futures", report=report))
    assert len(events) == 60
    assert {e.kind for e in events} == {"trade"}
    assert report.undecodable == 0


def test_replay_orders_by_the_venue_clock_not_by_arrival(tmp_path):
    """Two streams on one connection can arrive out of order relative to each
    other, and a backtest fed in arrival order sees a trade before the book
    update that caused it."""
    capture_some(tmp_path)
    events = asyncio.run(replay_events(tmp_path, "binance-futures"))
    stamps = [e.exchange_ts for e in events]
    assert stamps == sorted(stamps)


def test_replay_can_rename_the_venue(tmp_path):
    """So a capture drives a scenario wired for a different venue name without
    editing either."""
    capture_some(tmp_path, count=30)
    events = asyncio.run(replay_events(tmp_path, "binance-futures",
                                       feed_venue="sim-perp"))
    assert {e.venue for e in events} == {"sim-perp"}


def test_one_malformed_payload_does_not_abort_a_six_month_replay(tmp_path):
    """Six months of capture will contain a handful of unrecognised payloads,
    and aborting on one is how a research run becomes impossible to finish."""
    w = writer(tmp_path, batch=1)
    w.offer(trade(1))
    w.offer({"stream": "btcusdt@depth",
             "data": {"e": "depthUpdate", "s": "BTCUSDT"}})   # no U or u
    w.offer(trade(2))
    w.close()
    report = ReplayReport()
    events = asyncio.run(replay_events(tmp_path, "binance-futures", report=report))
    assert report.undecodable == 1
    assert len(events) == 2


def test_replay_verifies_checksums_by_default(tmp_path):
    """A read that skips the checksum cannot distinguish a corrupted part from
    a quiet market."""
    capture_some(tmp_path, count=30)
    part = RawArchive(tmp_path).parts()[0]
    part.chmod(0o644)
    part.write_text(json.dumps({"stream": "x", "local_recv_ts": 1}) + "\n")
    with pytest.raises(Exception):
        asyncio.run(replay_events(tmp_path, "binance-futures"))


def test_an_empty_archive_replays_to_nothing_rather_than_raising(tmp_path):
    assert asyncio.run(replay_events(tmp_path, "binance-futures")) == []


def test_liquidations_survive_the_round_trip(tmp_path):
    """The cascade strategy's only input. A forced sale looks exactly like a
    voluntary one in the trade feed, so if this is not captured it cannot be
    reconstructed from anything else."""
    w = writer(tmp_path, batch=1)
    w.offer({"stream": "btcusdt@forceOrder",
             "data": {"e": "forceOrder", "E": 1568014460893,
                      "o": {"s": "BTCUSDT", "S": "SELL", "q": "0.014",
                            "ap": "9496.5", "T": 1568014460893}}})
    w.close()
    events = asyncio.run(replay_events(tmp_path, "binance-futures"))
    assert [e.kind for e in events] == ["liquidation"]
    assert events[0].payload.side == "sell"
    assert events[0].payload.quantity == dec("0.014")


def test_the_source_lists_parts_in_partition_order(tmp_path):
    """Sorted by path, which sorts by date then hour then index because the
    layout was designed that way. Modification time would reorder anything
    recompressed or restored from backup."""
    capture_some(tmp_path, count=80)          # batch 25, so several parts
    parts = ArchiveSource(tmp_path, "binance-futures").parts()
    assert parts == sorted(parts)
    assert len(parts) >= 2
