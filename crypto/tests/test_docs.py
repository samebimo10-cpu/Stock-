"""The documents the specification requires to exist.

A runbook that does not exist is discovered at 3am, and a strategy without a
written specification is one nobody had to explain before coding it. Both are
hard requirements, so both are checked.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RUNBOOKS = ROOT / "ops" / "runbooks"
STRATEGIES = ROOT / "docs" / "strategies"

#: SPEC section 13.3 names these eight.
REQUIRED_RUNBOOKS = (
    "exchange-outage", "feed-disconnection", "position-mismatch",
    "unexpected-drawdown", "key-compromise", "forced-liquidation",
    "clock-drift", "audit-failure",
)


@pytest.mark.parametrize("name", REQUIRED_RUNBOOKS)
def test_every_required_runbook_exists(name):
    assert (RUNBOOKS / f"{name}.md").exists(), f"SPEC section 13.3 requires a {name} runbook"


@pytest.mark.parametrize("name", REQUIRED_RUNBOOKS)
def test_every_runbook_says_what_to_do_first(name):
    """The 3am ordering: act, then understand. Exposure does not wait."""
    text = (RUNBOOKS / f"{name}.md").read_text().lower()
    assert "first action" in text
    assert "diagnose" in text
    assert "recover" in text


@pytest.mark.parametrize("name", REQUIRED_RUNBOOKS)
def test_every_runbook_states_a_severity(name):
    text = (RUNBOOKS / f"{name}.md").read_text()
    assert re.search(r"\*\*Severity:\*\*", text), f"{name} does not state a severity"


def test_the_runbook_index_lists_them_all():
    index = (RUNBOOKS / "README.md").read_text()
    for name in REQUIRED_RUNBOOKS:
        assert f"{name}.md" in index, f"{name} is missing from the index"


def test_no_runbook_instructs_disabling_risk_to_resume():
    """If the path back runs through switching off a control, the incident is
    now worse than whatever caused it.

    Mentions are allowed when they are prohibitions - the index says "never
    disable risk to get trading working again", which is the rule rather than
    a violation of it. What must not appear is the phrase as an instruction.
    """
    negations = ("never", "not ", "n't", "avoid", "refuse", "prohibit")
    for path in RUNBOOKS.glob("*.md"):
        text = path.read_text().lower()
        for phrase in ("disable risk", "turn off risk", "bypass the risk",
                       "skip reconciliation", "raise recvwindow"):
            index = text.find(phrase)
            while index != -1:
                preceding = text[max(0, index - 60):index]
                assert any(n in preceding for n in negations), (
                    f"{path.name} appears to instruct {phrase!r}: "
                    f"...{text[max(0, index - 60):index + 40]}..."
                )
                index = text.find(phrase, index + 1)


# ---------------------------------------------------- strategy specs


STRATEGY_SPECS = ("funding_carry", "stat_arb")


@pytest.mark.parametrize("name", STRATEGY_SPECS)
def test_every_strategy_has_a_written_specification(name):
    """SPEC section 6.1: no strategy is coded before its specification exists."""
    assert (STRATEGIES / f"{name}.md").exists()


@pytest.mark.parametrize("name", STRATEGY_SPECS)
def test_every_strategy_specification_fills_every_section(name):
    text = (STRATEGIES / f"{name}.md").read_text()
    for heading in ("Economic rationale", "Mechanics", "Parameters", "Risk profile",
                    "Capacity", "Costs", "Validation results", "Kill criteria",
                    "Monitoring"):
        assert heading in text, f"{name} has no {heading!r} section"


@pytest.mark.parametrize("name", STRATEGY_SPECS)
def test_every_specification_states_what_would_end_the_edge(name):
    """"The backtest works" is not a rationale, and neither is "it persists"."""
    text = (STRATEGIES / f"{name}.md").read_text()
    assert "What would end it" in text


@pytest.mark.parametrize("name", STRATEGY_SPECS)
def test_no_specification_claims_more_than_six_parameters(name):
    text = (STRATEGIES / f"{name}.md").read_text()
    assert "hard limit is six" in text or "limit is six" in text


def test_the_specification_names_the_counterparty():
    """'The market' is not a counterparty, and the template rejects it."""
    text = (STRATEGIES / "funding_carry.md").read_text()
    assert "Who is the counterparty?" in text
    assert "Leveraged long holders" in text


def test_the_specification_records_that_capacity_is_unestimated():
    """A strategy without a capacity number is not approved for live capital."""
    text = (STRATEGIES / "funding_carry.md").read_text()
    assert "Not yet estimated" in text


def test_the_specification_does_not_claim_validation_it_has_not_done():
    text = (STRATEGIES / "funding_carry.md").read_text()
    assert "Nothing in this section has been run" in text
