"""Which limits are actually in force, and how you find out.

A system that silently falls back to built-in defaults when a file is missing
will trade all week on limits nobody chose, and the first sign of it is a
position larger than anyone expected. These tests pin down the search order and
the two places it refuses rather than guesses.
"""

from __future__ import annotations

import pytest

from tradesys.config import (
    BUILT_IN_LIMITS, LIMITS_ENV, export_limits, find_limits, load_limits,
)
from tradesys.layers.l5_risk.limits import LimitError, LimitRegister


def test_an_explicit_path_wins_over_everything(tmp_path, monkeypatch):
    exported = export_limits(tmp_path / "explicit.yaml")
    monkeypatch.setenv(LIMITS_ENV, str(export_limits(tmp_path / "env.yaml")))
    assert find_limits(exported).path == exported


def test_the_environment_variable_wins_over_the_working_directory(tmp_path, monkeypatch):
    chosen = export_limits(tmp_path / "chosen.yaml")
    monkeypatch.chdir(tmp_path)
    export_limits(tmp_path / "risk" / "limits.yaml")
    monkeypatch.setenv(LIMITS_ENV, str(chosen))
    assert find_limits().path == chosen


def test_a_missing_file_named_in_the_environment_is_refused(tmp_path, monkeypatch):
    """Silently using different limits than the ones you named is the worst
    possible response to a typo."""
    monkeypatch.setenv(LIMITS_ENV, str(tmp_path / "typo.yaml"))
    with pytest.raises(FileNotFoundError):
        find_limits()


def test_a_missing_explicit_path_is_refused(tmp_path):
    with pytest.raises(FileNotFoundError):
        find_limits(tmp_path / "nope.yaml")


def test_the_working_directory_is_searched(tmp_path, monkeypatch):
    monkeypatch.delenv(LIMITS_ENV, raising=False)
    monkeypatch.chdir(tmp_path)
    written = export_limits(tmp_path / "risk" / "limits.yaml")
    assert find_limits().path == written


def test_an_installed_package_with_no_file_still_starts(monkeypatch, tmp_path):
    """Refusing to start would be worse. It must be visible, not silent."""
    monkeypatch.delenv(LIMITS_ENV, raising=False)
    monkeypatch.chdir(tmp_path)
    monkeypatch.setattr("tradesys.config.repository_limits", lambda: None)
    source = find_limits()
    assert source.is_built_in
    assert load_limits().get("drawdown_hard") == LimitRegister.from_mapping(
        BUILT_IN_LIMITS).get("drawdown_hard")


def test_an_exported_register_loads_back_identically(tmp_path):
    """A round trip that loses a value would be found here and nowhere else."""
    written = export_limits(tmp_path / "limits.yaml")
    assert (LimitRegister.from_yaml(written).snapshot()
            == LimitRegister.from_mapping(BUILT_IN_LIMITS).snapshot())


def test_an_exported_register_keeps_its_bounds(tmp_path):
    """Export the values without the bounds and the next load refuses outright."""
    written = export_limits(tmp_path / "limits.yaml")
    register = LimitRegister.from_yaml(written)
    assert register.limit("drawdown_hard").bounds == (
        LimitRegister.from_mapping(BUILT_IN_LIMITS).limit("drawdown_hard").bounds)


def test_export_refuses_to_overwrite(tmp_path):
    """A clobbered limit file with local edits in it is unrecoverable."""
    written = export_limits(tmp_path / "limits.yaml")
    with pytest.raises(FileExistsError):
        export_limits(written)


def test_an_edited_export_that_breaks_a_bound_refuses_to_load(tmp_path):
    """The exported file is a real limit register, not a rendering of one."""
    written = export_limits(tmp_path / "limits.yaml")
    written.write_text(written.read_text().replace("value: 0.12", "value: 0.99"))
    with pytest.raises(LimitError):
        LimitRegister.from_yaml(written)


def test_a_limit_carries_the_bounds_it_was_validated_against():
    """So "how much room do I have here?" is answerable from the running system."""
    limit = load_limits().limit("per_trade_risk")
    assert limit.bounds is not None
    low, high = limit.bounds
    assert low <= limit.value <= high
