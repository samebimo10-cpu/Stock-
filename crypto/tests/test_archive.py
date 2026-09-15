"""Raw archive and normalisation (SPEC section 4.3)."""

from __future__ import annotations

import json
import os
from pathlib import Path

import pytest

from tradesys.layers.l1_data.archive import (
    ArchiveError, ChecksumMismatch, ImmutableViolation, NORMALISER_VERSION,
    Normaliser, RawArchive, Retention, partition_for,
)

BASE = 1_700_000_000_000_000_000


def records(n=5, start_seq=100, symbol="BTCUSDT", t0=0):
    return [{
        "venue": "binance", "symbol": symbol, "stream": "depth", "kind": "book_delta",
        "exchange_ts": BASE + (t0 + i) * 1_000_000,
        "local_recv_ts": BASE + (t0 + i) * 1_000_000 + 5_000_000,
        "sequence": start_seq + i,
        "payload": {"b": [["60000.01", "1.5"]], "a": [["60000.02", "2.0"]]},
    } for i in range(n)]


# ------------------------------------------------------------ partitions


def test_partitions_are_utc():
    """Local time puts a daylight-saving transition inside the data."""
    assert partition_for("binance", "depth", BASE) == ("2023-11-14", "22")


def test_partition_path_layout(tmp_path):
    archive = RawArchive(tmp_path)
    directory = archive.partition_dir("binance", "depth", BASE)
    assert directory.relative_to(tmp_path).parts == (
        "venue=binance", "stream=depth", "date=2023-11-14", "hour=22",
    )


# --------------------------------------------------------------- writing


def test_write_and_read_round_trip(tmp_path):
    archive = RawArchive(tmp_path)
    rows = records()
    archive.write("binance", "depth", rows)
    assert archive.read_part(archive.parts()[0]) == rows


def test_every_record_needs_a_local_receive_timestamp(tmp_path):
    """The venue timestamp alone cannot say how late the data was."""
    archive = RawArchive(tmp_path)
    bad = [{"venue": "binance", "exchange_ts": BASE}]
    with pytest.raises(ArchiveError, match="local_recv_ts"):
        archive.write("binance", "depth", bad)


def test_an_empty_part_is_refused(tmp_path):
    with pytest.raises(ArchiveError, match="empty part"):
        RawArchive(tmp_path).write("binance", "depth", [])


def test_writes_never_overwrite(tmp_path):
    """Normalisation logic will change; raw data will not."""
    archive = RawArchive(tmp_path)
    first = archive.write("binance", "depth", records())
    second = archive.write("binance", "depth", records(start_seq=200))
    assert first != second
    assert len(archive.parts()) == 2


def test_parts_are_made_read_only(tmp_path):
    archive = RawArchive(tmp_path)
    path = archive.write("binance", "depth", records())
    assert not os.access(path, os.W_OK) or os.geteuid() == 0


def test_the_overwrite_guard_refuses_an_existing_path(tmp_path):
    archive = RawArchive(tmp_path)
    path = archive.write("binance", "depth", records())
    with pytest.raises(ImmutableViolation, match="write-once"):
        archive.overwrite_guard(path)


def test_compressed_parts_round_trip(tmp_path):
    archive = RawArchive(tmp_path, compress=True)
    rows = records()
    path = archive.write("binance", "depth", rows)
    assert path.name.endswith(".jsonl.gz")
    assert archive.read_part(path) == rows


# ------------------------------------------------------------ integrity


def test_checksums_verify(tmp_path):
    archive = RawArchive(tmp_path)
    archive.write("binance", "depth", records())
    checked, failures = archive.verify_all()
    assert checked == 1 and failures == []


def test_an_altered_part_fails_verification(tmp_path):
    archive = RawArchive(tmp_path)
    path = archive.write("binance", "depth", records())
    os.chmod(path, 0o644)
    path.write_text(path.read_text().replace("60000.01", "70000.01"))
    with pytest.raises(ChecksumMismatch, match="does not match its recorded digest"):
        archive.read_part(path)


def test_a_part_without_a_checksum_is_refused(tmp_path):
    archive = RawArchive(tmp_path)
    path = archive.write("binance", "depth", records())
    archive._checksum_path(path).unlink()
    with pytest.raises(ChecksumMismatch, match="no recorded checksum"):
        archive.read_part(path)


def test_verify_all_reports_failures_without_raising(tmp_path):
    archive = RawArchive(tmp_path)
    path = archive.write("binance", "depth", records())
    os.chmod(path, 0o644)
    path.write_text("{}\n")
    checked, failures = archive.verify_all()
    assert checked == 1 and len(failures) == 1


def test_the_checksum_covers_uncompressed_bytes(tmp_path):
    """So a file recompressed later still verifies."""
    plain = RawArchive(tmp_path / "plain")
    packed = RawArchive(tmp_path / "packed", compress=True)
    rows = records()
    a = json.loads(plain._checksum_path(plain.write("b", "d", rows)).read_text())
    b = json.loads(packed._checksum_path(packed.write("b", "d", rows)).read_text())
    assert a["sha256"] == b["sha256"]


# --------------------------------------------------------- normalisation


def test_normalisation_is_deterministic():
    """The hard requirement: same bytes, same version, byte-identical output."""
    n = Normaliser()
    assert n.is_deterministic(records(20))


def test_input_order_does_not_change_output():
    n = Normaliser()
    rows = records(10)
    assert n.serialise(n.normalise(rows)) == n.serialise(n.normalise(list(reversed(rows))))


def test_duplicates_are_removed_by_sequence():
    n = Normaliser()
    rows = records(5)
    assert len(n.normalise(rows + rows)) == 5


def test_records_without_a_sequence_deduplicate_by_content():
    n = Normaliser()
    rows = [{"venue": "v", "symbol": "s", "stream": "trades", "kind": "trade",
             "exchange_ts": BASE, "local_recv_ts": BASE + 1, "payload": {"p": "1"}}]
    assert len(n.normalise(rows + rows)) == 1


def test_gaps_are_annotated_not_repaired():
    """Research trained on a gap window learns to trade a reconnection."""
    n = Normaliser()
    # The second burst is later in time as well as in sequence: two bursts
    # overlapping in time would interleave and produce two gaps, which is
    # correct behaviour but a different thing to test.
    rows = records(3) + records(2, start_seq=200, t0=10)
    out = n.normalise(rows)
    flagged = [r for r in out if r.get("gap_before")]
    assert len(flagged) == 1
    assert flagged[0]["sequence"] == 200
    assert flagged[0]["gap_size"] == 97
    assert len(out) == 5, "the gap must not be filled in"


def test_transit_time_is_preserved():
    """Both a latency measurement and a data-quality signal."""
    out = Normaliser().normalise(records(1))
    assert out[0]["transit_ns"] == 5_000_000


def test_numbers_stay_as_strings():
    """Parsing to float here would round a price in the one exact file."""
    out = Normaliser().normalise(records(1))
    assert out[0]["payload"]["b"][0][0] == "60000.01"


def test_output_records_its_version():
    out = Normaliser().normalise(records(1))
    assert out[0]["normaliser_version"] == NORMALISER_VERSION


def test_a_new_version_writes_to_its_own_file(tmp_path):
    """Changing the computation never silently changes history."""
    rows = records(3)
    v1 = Normaliser(version=1)
    v2 = Normaliser(version=2)
    p1 = v1.write(tmp_path, "binance", "BTCUSDT", v1.normalise(rows), "2023-11-14")
    p2 = v2.write(tmp_path, "binance", "BTCUSDT", v2.normalise(rows), "2023-11-14")
    assert p1 != p2 and p1.exists() and p2.exists()


def test_regeneration_from_raw_is_routine(tmp_path):
    """If regenerating is heroic nobody does it, and norm becomes the truth."""
    archive = RawArchive(tmp_path / "raw")
    archive.write("binance", "depth", records(5))
    archive.write("binance", "depth", records(5, start_seq=200, t0=10))

    written = Normaliser().regenerate(archive, tmp_path / "norm")
    assert written
    path = next(iter(written.values()))
    lines = [json.loads(line) for line in path.read_text().splitlines()]
    assert len(lines) == 10
    assert any(row.get("gap_before") for row in lines)


def test_regeneration_is_reproducible(tmp_path):
    archive = RawArchive(tmp_path / "raw")
    archive.write("binance", "depth", records(8))

    first = Normaliser().regenerate(archive, tmp_path / "a")
    second = Normaliser().regenerate(archive, tmp_path / "b")
    for key in first:
        assert Path(first[key]).read_bytes() == Path(second[key]).read_bytes()


# ------------------------------------------------------------- retention


def test_raw_is_kept_indefinitely_by_default():
    """The only irreplaceable asset in the building."""
    r = Retention()
    assert not r.expired("raw", 10_000)
    assert not r.expired("norm", 10_000)


def test_features_expire_because_they_are_regenerable():
    r = Retention()
    assert not r.expired("feat", 89)
    assert r.expired("feat", 91)
