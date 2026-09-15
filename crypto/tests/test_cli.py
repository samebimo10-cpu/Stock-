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
