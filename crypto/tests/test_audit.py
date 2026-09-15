"""Audit log: tamper evidence and the halt that protects reconstructability."""

from __future__ import annotations

import json

import pytest

from tradesys.core.types import dec
from tradesys.layers.l7_observability.alerts import AlertRouter, Severity
from tradesys.layers.l7_observability.audit import (
    AuditBufferFull, AuditLog, ChainBroken, verify_chain,
)


def test_chain_verifies(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl")
    for i in range(20):
        log.record("order", {"i": i, "qty": dec("1.5")}, f"corr{i}")
    assert log.verify()


def test_decimals_survive_the_round_trip(tmp_path):
    """A float round-trip would change the recorded number."""
    log = AuditLog(tmp_path / "audit.jsonl")
    log.record("fill", {"price": dec("60000.123456789012345678")}, "c")
    rec = next(iter(log.read()))
    assert rec["payload"]["price"] == "60000.123456789012345678"


def test_altering_a_record_breaks_the_chain(tmp_path):
    path = tmp_path / "audit.jsonl"
    log = AuditLog(path)
    for i in range(5):
        log.record("order", {"i": i}, "c")

    lines = path.read_text().splitlines()
    rec = json.loads(lines[2])
    rec["payload"]["i"] = 99
    lines[2] = json.dumps(rec, sort_keys=True, separators=(",", ":"))
    path.write_text("\n".join(lines) + "\n")

    with pytest.raises(ChainBroken, match="do not match its own hash"):
        verify_chain(AuditLog(path).read())


def test_removing_a_record_breaks_the_chain(tmp_path):
    path = tmp_path / "audit.jsonl"
    log = AuditLog(path)
    for i in range(5):
        log.record("order", {"i": i}, "c")
    lines = path.read_text().splitlines()
    del lines[2]
    path.write_text("\n".join(lines) + "\n")
    with pytest.raises(ChainBroken):
        verify_chain(AuditLog(path).read())


def test_losing_the_audit_path_halts_trading():
    """A system that cannot record what it is doing cannot be reconciled."""
    def dead_sink(line):
        raise IOError("audit sink unreachable")

    log = AuditLog(sink=dead_sink, buffer_limit=3)
    with pytest.raises(AuditBufferFull):
        for i in range(5):
            log.record("order", {"i": i})
    assert log.must_halt_trading


def test_buffered_records_drain_when_the_path_returns():
    state = {"up": False}
    written = []

    def flaky(line):
        if not state["up"]:
            raise IOError("down")
        written.append(line)

    log = AuditLog(sink=flaky, buffer_limit=100)
    for i in range(5):
        log.record("order", {"i": i})
    assert log.buffered == 5 and not written

    state["up"] = True
    log.record("order", {"i": 5})
    assert log.buffered == 0
    assert len(written) == 6


def test_recovery_requires_the_backlog_to_be_flushed():
    log = AuditLog(sink=lambda line: (_ for _ in ()).throw(IOError("down")), buffer_limit=2)
    with pytest.raises(AuditBufferFull):
        for i in range(3):
            log.record("x", {"i": i})
    with pytest.raises(AuditBufferFull, match="backlog not flushed"):
        log.recover()


# ---------------------------------------------------------------- alerts


def test_a_p1_must_claim_money_at_risk():
    """A P1 that fires without money at risk is a defect in the alert."""
    router = AlertRouter()
    with pytest.raises(ValueError, match="does not claim money at risk"):
        router.raise_alert(Severity.P1, "latency_high", "p99 3ms")


def test_p1_with_money_at_risk_is_accepted():
    router = AlertRouter()
    alert = router.raise_alert(Severity.P1, "kill_switch", "drawdown", money_at_risk=True)
    assert alert is not None
    assert router.pages()


def test_identical_open_alerts_are_deduplicated():
    """Alert fatigue is how the one real page gets ignored."""
    router = AlertRouter()
    router.raise_alert(Severity.P2, "feed_down", "binance")
    router.raise_alert(Severity.P2, "feed_down", "binance")
    assert len(router.sent) == 1
    assert router.deduplicated == 1
    router.resolve(Severity.P2, "feed_down")
    router.raise_alert(Severity.P2, "feed_down", "binance")
    assert len(router.sent) == 2
