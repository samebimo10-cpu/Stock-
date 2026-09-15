"""Replay from the audit log (SPEC section 10.4, rule 3 of section 3.2).

Distinct from the same-code-path test. That one replays market events and
compares two runs. This one asks whether the *record* of what happened is
complete enough to reconstruct it, which is the guarantee that matters on a
bad day.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from tradesys.core.types import dec
from tradesys.demo import build_events, build_pipeline
from tradesys.layers.l7_observability.audit import AuditLog
from tradesys.research.backtest import Backtester
from tradesys.research.registry import TrialRegistry
from tradesys.research.replay import (
    AUDITED_DECISIONS, compare_decisions, extract_decisions, reconstruct_state,
)


def audited_session(tmp_path, events=None, **pipeline_kwargs):
    events = events if events is not None else build_events()
    pipeline, adapters, recorder = build_pipeline(**pipeline_kwargs)
    pipeline.audit = AuditLog(tmp_path / "audit.jsonl")
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "funding_carry").run(events))
    return pipeline, recorder, list(pipeline.audit.read())


# ------------------------------------------------- the log is complete


def test_the_log_records_every_decision_kind(tmp_path):
    _, _, records = audited_session(tmp_path)
    kinds = {r["kind"] for r in records}
    for required in AUDITED_DECISIONS:
        assert required in kinds, f"the log never recorded a {required}"


def test_the_chain_still_verifies_after_a_session(tmp_path):
    pipeline, _, _ = audited_session(tmp_path)
    assert pipeline.audit.verify()


# ------------------------------------------ state from the log alone


def test_positions_reconstruct_from_the_log(tmp_path):
    """Event-sourced state is how you debug a bad day."""
    pipeline, _, records = audited_session(tmp_path)
    state = reconstruct_state(records)

    live = {k: v.quantity for k, v in pipeline.books.positions.items()}
    assert state.positions == live


def test_fees_reconstruct_from_the_log(tmp_path):
    pipeline, _, records = audited_session(tmp_path)
    assert reconstruct_state(records).fees == pipeline.books.total_fees()


def test_reconstruction_uses_no_running_system(tmp_path):
    """Reading the file back is the whole test: nothing else is available."""
    pipeline, _, _ = audited_session(tmp_path)
    lines = (tmp_path / "audit.jsonl").read_text().splitlines()
    records = [json.loads(line) for line in lines]
    state = reconstruct_state(records)
    assert state.fills >= 1
    assert state.signals >= 1


def test_a_closing_fill_clears_the_position():
    records = [
        {"kind": "fill", "correlation_id": "c", "payload": {
            "venue": "sim", "symbol": "BTCUSDT", "side": "buy",
            "quantity": "1", "price": "60000", "fee": "10"}},
        {"kind": "fill", "correlation_id": "c", "payload": {
            "venue": "sim", "symbol": "BTCUSDT", "side": "sell",
            "quantity": "1", "price": "61000", "fee": "10"}},
    ]
    state = reconstruct_state(records)
    assert state.positions == {}
    assert state.fees == dec("20")
    assert state.fills == 2


def test_decimals_survive_the_log_round_trip():
    """The writer stores them as strings so a float cannot change a number."""
    records = [{"kind": "fill", "correlation_id": "c", "payload": {
        "venue": "sim", "symbol": "BTCUSDT", "side": "buy",
        "quantity": "0.123456789012345678", "price": "60000.000000000000000001",
        "fee": "0"}}]
    state = reconstruct_state(records)
    assert state.positions[("sim", "BTCUSDT")] == dec("0.123456789012345678")


def test_an_unknown_order_is_visible_in_the_reconstruction():
    records = [{"kind": "order", "correlation_id": "c", "payload": {
        "coid": "ts_x", "accepted": False,
        "reason": "simulated timeout AFTER the venue accepted the order"}}]
    state = reconstruct_state(records)
    assert state.unknown_orders == ["ts_x"]
    assert state.rejections == 1


def test_correlation_ids_are_collected():
    """One identifier carried end to end is what makes 'why did we buy that' answerable."""
    records = [{"kind": "signal", "correlation_id": "corr-1", "payload": {}},
               {"kind": "order", "correlation_id": "corr-1", "payload": {"coid": "a"}}]
    assert reconstruct_state(records).correlation_ids == {"corr-1"}


# --------------------------------------------- decisions reproduce


def test_the_log_reproduces_the_decisions_of_a_fresh_run(tmp_path):
    events = build_events()
    _, _, records = audited_session(tmp_path, events)

    pipeline, adapters, recorder = build_pipeline()
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "funding_carry").run(events))

    divergences = compare_decisions(records, recorder.decisions)
    assert not divergences, "\n".join(str(d) for d in divergences)


def test_a_truncated_log_is_detected(tmp_path):
    """A comparison that cannot fail proves nothing."""
    events = build_events()
    _, _, records = audited_session(tmp_path, events)

    pipeline, adapters, recorder = build_pipeline()
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "funding_carry").run(events))

    # Drop the last recorded *decision*, not merely the last record: the tail
    # of a session is often a fill, and removing one of those proves nothing
    # about whether the comparison can detect a missing decision.
    keep = [r for r in records if r["kind"] in AUDITED_DECISIONS]
    truncated = [r for r in records if r is not keep[-1]]
    assert compare_decisions(truncated, recorder.decisions)


def test_a_different_decision_is_detected(tmp_path):
    events = build_events()
    _, _, records = audited_session(tmp_path, events)

    # A run at a different size makes different decisions.
    pipeline, adapters, recorder = build_pipeline(base_notional="4000")
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "funding_carry").run(events))

    assert compare_decisions(records, recorder.decisions)


def test_extract_decisions_ignores_non_decision_records():
    records = [{"kind": "fill", "correlation_id": "c", "payload": {}},
               {"kind": "gap_skip", "correlation_id": "c", "payload": {}},
               {"kind": "signal", "correlation_id": "c",
                "payload": {"strategy_id": "s", "symbol": "X",
                            "target_position": "1", "urgency": "passive"}}]
    extracted = extract_decisions(records)
    assert len(extracted) == 1
    assert extracted[0][0] == "signal"


def test_the_comparison_ignores_timestamps_and_correlation_ids(tmp_path):
    """They differ between a session and its replay by construction."""
    events = build_events()
    _, _, records = audited_session(tmp_path, events)
    for record in records:
        record["recorded_at"] = 0
        record["correlation_id"] = "rewritten"

    pipeline, adapters, recorder = build_pipeline()
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "funding_carry").run(events))
    assert not compare_decisions(records, recorder.decisions)
