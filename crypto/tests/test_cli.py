"""The CLI, including that selfcheck can actually fail."""

from __future__ import annotations

import pytest

from tradesys import cli


def test_selfcheck_passes(capsys):
    assert cli.main(["selfcheck"]) == 0
    out = capsys.readouterr().out
    assert "RESULT: PASS" in out
    assert "FAIL" not in out.split("RESULT")[0]


def test_selfcheck_exits_non_zero_when_a_gate_fails(monkeypatch, capsys):
    """A gate nobody can fail is a gate that gets waived."""
    monkeypatch.setattr(cli, "GATES", [("demo.always_fails", lambda: (False, "by design"))])
    assert cli.main(["selfcheck"]) == 1
    assert "RESULT: FAIL" in capsys.readouterr().out


def test_a_gate_that_raises_counts_as_failed(monkeypatch, capsys):
    def explode():
        raise RuntimeError("boom")

    monkeypatch.setattr(cli, "GATES", [("demo.raises", explode)])
    assert cli.main(["selfcheck"]) == 1
    assert "RuntimeError" in capsys.readouterr().out


def test_demo_runs(capsys):
    assert cli.main(["demo"]) == 0
    assert "events replayed" in capsys.readouterr().out


def test_verify_audit_detects_a_broken_chain(tmp_path, capsys):
    import json

    from tradesys.layers.l7_observability.audit import AuditLog

    path = tmp_path / "audit.jsonl"
    log = AuditLog(path)
    for i in range(4):
        log.record("order", {"i": i}, "c")
    assert cli.main(["verify-audit", str(path)]) == 0

    lines = path.read_text().splitlines()
    rec = json.loads(lines[1])
    rec["payload"]["i"] = 404
    lines[1] = json.dumps(rec, sort_keys=True, separators=(",", ":"))
    path.write_text("\n".join(lines) + "\n")

    assert cli.main(["verify-audit", str(path)]) == 1
    assert "CHAIN BROKEN" in capsys.readouterr().out


def test_validate_reports_the_demo_strategy_as_unvalidated(capsys):
    """Exits non-zero, because an unvalidated strategy must not read as fine."""
    assert cli.main(["validate"]) == 1
    out = capsys.readouterr().out
    assert "INCONCLUSIVE" in out
    assert "NOT validated" in out


def test_validate_can_spend_the_holdout(capsys):
    assert cli.main(["validate", "--holdout", "sam"]) == 1
    assert "holdout" in capsys.readouterr().out


def test_selfcheck_covers_adapter_conformance(capsys):
    cli.main(["selfcheck"])
    assert "data.multi_venue" in capsys.readouterr().out


def test_live_defaults_to_testnet_and_shadow(capsys, monkeypatch):
    """The defaults are what runs when somebody is in a hurry."""
    monkeypatch.setenv("BINANCE_API_KEY", "k")
    monkeypatch.setenv("BINANCE_API_SECRET", "s")
    assert cli.main(["live", "--dry-run"]) == 0
    out = capsys.readouterr().out
    assert "testnet" in out
    assert "mode       shadow" in out
    assert "recorded locally, never sent" in out


def test_live_refuses_production_orders_without_an_acknowledgement(capsys, monkeypatch):
    monkeypatch.setenv("BINANCE_API_KEY", "k")
    monkeypatch.setenv("BINANCE_API_SECRET", "s")
    assert cli.main(["live", "--mode", "live", "--production", "--dry-run"]) == 2
    assert "REFUSED" in capsys.readouterr().out


def test_live_refuses_to_start_without_credentials(capsys, monkeypatch):
    monkeypatch.delenv("BINANCE_API_KEY", raising=False)
    monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
    assert cli.main(["live", "--dry-run"]) == 2
    out = capsys.readouterr().out
    assert "REFUSED" in out
    assert "withdrawals DISABLED" in out


def test_live_says_plainly_when_orders_would_be_real(capsys, monkeypatch):
    monkeypatch.setenv("BINANCE_API_KEY", "k")
    monkeypatch.setenv("BINANCE_API_SECRET", "s")
    cli.main(["live", "--mode", "live", "--production", "--confirm-live", "--dry-run"])
    out = capsys.readouterr().out
    assert "THE VENUE" in out
    assert "passed validation" in out, "the warning must name the actual blocker"
