"""SPEC section 14.2: backtest and live must run the same code.

Rule 2 of SPEC section 3.2 is an assertion until this test exists. It records a
session's decisions, replays the identical inbound events through a fresh
pipeline, and demands the decisions match exactly.

This is the only thing standing between the team and the most common expensive
failure in the field: a backtest that measured different software from the one
holding the positions.
"""

from __future__ import annotations

import asyncio
from typing import List

import pytest

from tradesys.core.types import dec
from tradesys.demo import build_events, build_pipeline
from tradesys.layers.l3_strategy.funding_carry import FundingCarryParams
from tradesys.pipeline import DecisionRecorder


def run_session(events) -> DecisionRecorder:
    pipeline, adapters, recorder = build_pipeline()

    async def drive():
        for event in events:
            for venue in adapters.values():
                venue.apply_market_event(event)
            await pipeline.on_market_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)

    asyncio.run(drive())
    return recorder


def test_replay_reproduces_every_decision():
    """Replaying a recorded session must reproduce it exactly."""
    events = build_events()
    first = run_session(events)
    second = run_session(events)

    assert len(first) > 0, "the session produced no decisions; the test proves nothing"
    divergences = first.diff(second)
    assert not divergences, "backtest diverged from the recorded session:\n" + "\n".join(divergences)


def test_the_session_actually_trades():
    """Guards the test above: a pipeline that never acts replays trivially."""
    recorder = run_session(build_events())
    kinds = {d.kind for d in recorder.decisions}
    assert "signal" in kinds
    assert "risk" in kinds
    assert "submit" in kinds


def test_divergence_is_detected_when_a_parameter_changes():
    """The test must be able to fail. A comparison that always passes proves nothing."""
    events = build_events()
    baseline = run_session(events)

    pipeline, adapters, recorder = build_pipeline()
    # Size, not the entry threshold. The funding z-score does not exist until
    # the rate distribution has some variance, so the first computable z is
    # far above every candidate threshold and moving the threshold changes
    # nothing. Size changes the order, which is what must be detected.
    pipeline.strategies[0].params = FundingCarryParams(base_notional=dec("2500"))

    async def drive():
        for event in events:
            for venue in adapters.values():
                venue.apply_market_event(event)
            await pipeline.on_market_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)

    asyncio.run(drive())
    assert baseline.diff(recorder), "changing a strategy parameter went undetected"


def test_gap_windows_produce_no_signals():
    """Acting on a gap window is how a strategy learns to trade a reconnection."""
    from tradesys.core.events import QualityFlags
    from dataclasses import replace

    events = build_events()
    gapped = [replace(e, quality=QualityFlags(gap_detected=True)) for e in events]
    recorder = run_session(gapped)
    assert len(recorder) == 0
