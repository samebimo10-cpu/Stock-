from typer.testing import CliRunner

from stockselector.cli import app

runner = CliRunner()


def test_screen_and_select_sample():
    r = runner.invoke(app, ["screen", "--mode", "sample", "--exchange", "ngx", "--top", "5"])
    assert r.exit_code == 0, r.output
    assert "NGX screen" in r.output
    r = runner.invoke(app, ["select", "--mode", "sample", "--objective", "growth", "--picks", "4"])
    assert r.exit_code == 0, r.output
    assert "NYSE" in r.output and "NGX" in r.output


def test_allocate_with_export(tmp_path):
    r = runner.invoke(app, ["allocate", "--mode", "sample", "--objective", "income", "--risk", "2",
                            "--budget", "20000", "--currency", "USD", "--horizon", "3", "--target", "26000",
                            "--export", str(tmp_path)])
    assert r.exit_code == 0, r.output
    assert "Allocation summary" in r.output
    for f in ("summary.json", "orders.csv", "allocation.csv", "screen_scores.csv"):
        assert (tmp_path / f).exists()


def test_goals_file_roundtrip(tmp_path):
    g = tmp_path / "goals.yaml"
    r = runner.invoke(app, ["init-goals", str(g)])
    assert r.exit_code == 0 and g.exists()
    r = runner.invoke(app, ["allocate", "--goals", str(g), "--mode", "sample", "--picks", "4"])
    assert r.exit_code == 0, r.output
