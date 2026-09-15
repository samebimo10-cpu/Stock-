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


def test_viability_says_what_the_strategy_would_need(capsys):
    """The command exists so "it fails the gate" has a next sentence."""
    assert cli.main(["viability"]) == 0
    out = capsys.readouterr().out
    assert "cost gate" in out
    assert "VIP 0" in out
    assert "baseline" in out
    assert "annualised" in out


def test_limits_prints_where_the_limits_came_from(capsys):
    """The question a stranger must be able to answer in one command."""
    assert cli.main(["limits"]) == 0
    out = capsys.readouterr().out
    assert "source" in out
    assert "limits.yaml" in out
    assert "drawdown_hard" in out
    assert "17 limits" in out


def test_limits_export_then_load_round_trips(tmp_path, capsys, monkeypatch):
    target = tmp_path / "risk" / "limits.yaml"
    assert cli.main(["limits", "--export", str(target)]) == 0
    capsys.readouterr()
    assert cli.main(["limits", "--path", str(target)]) == 0
    assert "drawdown_hard" in capsys.readouterr().out


def test_limits_export_refuses_to_overwrite(tmp_path, capsys):
    target = tmp_path / "limits.yaml"
    cli.main(["limits", "--export", str(target)])
    capsys.readouterr()
    assert cli.main(["limits", "--export", str(target)]) == 2
    assert "REFUSED" in capsys.readouterr().out


def test_doctor_reports_without_touching_the_network(capsys):
    assert cli.main(["doctor"]) == 0
    out = capsys.readouterr().out
    assert "python" in out and "limits" in out
    assert "pass --network" in out, "the network check must be opt-in"


def test_doctor_says_ready_is_not_the_same_as_should_trade(capsys):
    """The one thing an operator most needs not to conflate."""
    cli.main(["doctor"])
    assert "says nothing about whether" in capsys.readouterr().out


def test_doctor_fails_when_the_named_limits_file_is_missing(monkeypatch, capsys):
    from tradesys.config import LIMITS_ENV

    monkeypatch.setenv(LIMITS_ENV, "/nonexistent/limits.yaml")
    assert cli.main(["doctor"]) == 1
    out = capsys.readouterr().out
    assert "NOT READY" in out


def test_selfcheck_passes_with_no_repository_on_disk(monkeypatch, tmp_path, capsys):
    """An installed package has no risk/limits.yaml and no checkout.

    Three of the fifteen gates used to fail there, and selfcheck is the first
    thing the quickstart tells someone to run. A gate that fails because of
    where the code was installed teaches people to ignore gate failures, which
    costs more than the gate was ever worth.
    """
    from tradesys.config import LIMITS_ENV

    monkeypatch.delenv(LIMITS_ENV, raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("tradesys.config.repository_limits", lambda: None)
    assert cli.main(["selfcheck"]) == 0
    out = capsys.readouterr().out
    assert "RESULT: PASS" in out
    assert "built-in" in out, "it must say the limits were the built-in ones"


def test_capture_dry_run_says_what_it_would_collect(capsys):
    assert cli.main(["capture", "--dry-run", "--futures"]) == 0
    out = capsys.readouterr().out
    assert "forceOrder" in out, "the cascade strategy's only input must be named"
    assert "testnet data is NOT research data" in out


def test_capture_warns_that_spot_has_no_funding_or_liquidations(capsys):
    cli.main(["capture", "--dry-run"])
    assert "--futures" in capsys.readouterr().out


def test_archive_refuses_a_directory_that_is_not_there(capsys):
    assert cli.main(["archive", "--root", "/nonexistent-archive"]) == 2
    assert "REFUSED" in capsys.readouterr().out


def test_validate_refuses_an_archive_too_short_to_mean_anything(tmp_path, capsys):
    """A Sharpe ratio computed on three days is noise with a decimal point."""
    from tradesys.live.capture import ArchiveWriter, CaptureConfig

    writer = ArchiveWriter(
        "binance-futures",
        CaptureConfig(root=tmp_path, batch=5, compress=False, min_part_records=1),
        clock=lambda: 1_700_000_000_000_000_000)
    for i in range(20):
        writer.offer({"stream": "btcusdt@aggTrade",
                      "data": {"e": "aggTrade", "E": 1000 + i, "T": 1000 + i,
                               "s": "BTCUSDT", "p": "60000", "q": "1",
                               "m": False, "a": i}})
    writer.close()

    assert cli.main(["validate", "--from-archive", str(tmp_path)]) == 2
    out = capsys.readouterr().out
    assert "REFUSED" in out and "30" in out


def test_validate_refuses_an_empty_archive_with_the_command_to_fix_it(tmp_path, capsys):
    assert cli.main(["validate", "--from-archive", str(tmp_path)]) == 2
    assert "tradesys capture" in capsys.readouterr().out
