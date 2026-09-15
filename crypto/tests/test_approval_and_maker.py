"""The two-person rule, and maker-preferred execution with a taker fallback."""

from __future__ import annotations

import asyncio
from pathlib import Path

import pytest
import yaml

from tradesys.core.events import BookSnapshot, Funding, MarketEvent, Trade
from tradesys.core.types import dec
from tradesys.demo import PERP_VENUE, SPOT_VENUE, build_cycling_events, build_pipeline
from tradesys.layers.l3_strategy.funding_carry import FundingCarryParams
from tradesys.layers.l5_risk.approval import (
    DELAYED_SINGLE_PERSON, TWO_PERSON, ApprovalChain, ApprovalRequired, config_digest,
)
from tradesys.layers.l5_risk.limits import LimitRegister
from tradesys.layers.l7_observability.audit import AuditLog
from tradesys.research.backtest import Backtester
from tradesys.research.registry import TrialRegistry

LIMITS = yaml.safe_load((Path(__file__).resolve().parents[1] / "risk" / "limits.yaml").read_text())


def chain(mode=TWO_PERSON, **kwargs):
    return ApprovalChain(mode, secrets={"sam": "s1", "alex": "s2"}, **kwargs)


# ------------------------------------------------------- the two-person rule


def test_an_unapproved_risk_config_does_not_load():
    """A limit change takes effect immediately and nothing downstream reviews it."""
    with pytest.raises(ApprovalRequired, match="no valid approval"):
        LimitRegister.from_mapping(LIMITS, chain())


def test_one_person_approving_twice_is_one_person():
    c = chain()
    c.approve("sam", LIMITS)
    c.approve("sam", LIMITS)
    with pytest.raises(ApprovalRequired, match="two are required"):
        LimitRegister.from_mapping(LIMITS, c)


def test_two_distinct_signers_load_the_config():
    c = chain()
    c.approve("sam", LIMITS)
    c.approve("alex", LIMITS)
    assert len(LimitRegister.from_mapping(LIMITS, c).names()) == 17


def test_an_approval_does_not_carry_to_a_different_config():
    """Otherwise a limit can be changed after the review that approved it."""
    c = chain()
    c.approve("sam", LIMITS)
    c.approve("alex", LIMITS)

    edited = yaml.safe_load(yaml.safe_dump(LIMITS))
    edited["limits"]["per_trade_risk"]["value"] = 0.04
    with pytest.raises(ApprovalRequired):
        LimitRegister.from_mapping(edited, c)


def test_reformatting_does_not_invalidate_an_approval():
    """Otherwise every whitespace edit re-approves, and people stop reading."""
    c = chain()
    c.approve("sam", LIMITS)
    c.approve("alex", LIMITS)
    reordered = dict(reversed(list(LIMITS.items())))
    assert config_digest(reordered) == config_digest(LIMITS)
    assert c.may_load(reordered)


def test_an_unregistered_approver_cannot_mint_an_approval():
    """Approvers are named in advance, so whoever is editing cannot self-approve."""
    with pytest.raises(ApprovalRequired, match="not a registered approver"):
        chain().approve("stranger", LIMITS)


def test_a_forged_signature_does_not_count():
    from tradesys.layers.l5_risk.approval import Approval

    c = chain()
    c.approve("sam", LIMITS)
    digest = config_digest(LIMITS)
    c._approvals[digest].append(
        Approval(signer="alex", digest=digest, at=0.0, signature="forged")
    )
    assert c.distinct_signers(LIMITS) == ["sam"]


def test_the_single_person_substitute_is_a_delay():
    """It does not prevent a bad decision. It prevents one made mid-incident."""
    clock = {"t": 0.0}
    c = chain(DELAYED_SINGLE_PERSON, delay_seconds=86400, clock=lambda: clock["t"])
    c.approve("sam", LIMITS)

    with pytest.raises(ApprovalRequired, match="takes effect in"):
        LimitRegister.from_mapping(LIMITS, c)

    clock["t"] = 86401
    assert LimitRegister.from_mapping(LIMITS, c)


def test_research_may_load_without_a_chain():
    """Passing no chain is for research and tests; production always passes one."""
    assert LimitRegister.from_mapping(LIMITS) is not None


def test_status_reports_who_has_signed():
    c = chain()
    c.approve("sam", LIMITS)
    status = c.status(LIMITS)
    assert status["signers"] == ["sam"]
    assert status["may_load"] is False


# ------------------------------------------------- maker-preferred execution


def flat_market_events(periods: int = 50) -> list:
    """A market that does not trend, so a resting order can actually fill.

    The cycling scenario drifts during elevated funding, which is realistic and
    means a resting bid never gets hit. Both branches of maker-preferred need
    exercising, so this one stands still.
    """
    events = []
    ts = 1_700_000_000_000_000_000
    interval = 8 * 3600 * 1_000_000_000
    price = dec("60000")
    for i in range(periods):
        for venue, offset in ((PERP_VENUE, dec(0)), (SPOT_VENUE, dec("-2"))):
            base = price + offset
            events.append(MarketEvent(
                correlation_id=f"b-{venue}-{i}", emitted_at=ts, source="t",
                venue=venue, symbol="BTCUSDT", kind="book_snapshot",
                exchange_ts=ts, local_recv_ts=ts, sequence=i,
                payload=BookSnapshot(bids=((base, dec("50")),),
                                     asks=((base + dec(1), dec("50")),),
                                     last_update_id=i),
            ))
            for j in range(6):
                buy = j % 2 == 0
                events.append(MarketEvent(
                    correlation_id=f"t-{venue}-{i}-{j}", emitted_at=ts + 1 + j,
                    source="t", venue=venue, symbol="BTCUSDT", kind="trade",
                    exchange_ts=ts + 1 + j, local_recv_ts=ts + 1 + j,
                    payload=Trade(price=base + dec(1) if buy else base,
                                  quantity=dec("5"),
                                  aggressor_side="buy" if buy else "sell",
                                  trade_id=i * 10 + j),
                ))
        rate = dec("0.0001") + dec(i % 5) / dec("100000")
        if i >= 40:
            rate = dec("0.0009")
        events.append(MarketEvent(
            correlation_id=f"f-{i}", emitted_at=ts + 10, source="t",
            venue=PERP_VENUE, symbol="BTCUSDT", kind="funding",
            exchange_ts=ts + 10, local_recv_ts=ts + 10,
            payload=Funding(rate=rate, interval_hours=8, next_settlement=ts + interval),
        ))
        ts += interval
    return events


def run(events, audit_path=None, **kwargs):
    pipeline, adapters, _ = build_pipeline(**kwargs)
    if audit_path:
        pipeline.audit = AuditLog(audit_path)
    result = asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "fc").run(events))
    return pipeline, adapters, result


def test_maker_preferred_is_the_default_for_the_hedge():
    assert FundingCarryParams().hedge_urgency == "maker_preferred"


def test_the_hedge_rests_before_it_crosses(tmp_path):
    """Post, wait, cross only if it has not filled. The cheap route first."""
    pipeline, adapters, _ = run(flat_market_events(), tmp_path / "a.jsonl",
                                taker_fallback_intervals=8, leg_timeout_intervals=12)
    records = list(pipeline.audit.read())
    intents = [r for r in records if r["kind"] == "intent"]
    hedge_intents = [r for r in intents if r["payload"]["venue"] == SPOT_VENUE]
    assert hedge_intents, "the hedge leg never sent an order"
    assert any(r["payload"]["post_only"] for r in hedge_intents), (
        "the hedge crossed immediately instead of posting first"
    )


def test_a_resting_hedge_fills_as_maker_when_given_time_to_queue():
    """Both branches matter, and the timing between them is a real trade-off.

    Rest too briefly and every order crosses, which is the expensive outcome
    the maker path exists to avoid. Rest too long and the hedge is late, which
    is the risk the fallback exists to bound. Here the queue is given enough
    time to reach us.
    """
    pipeline, adapters, result = run(
        flat_market_events(), taker_fallback_intervals=8, leg_timeout_intervals=12,
    )
    assert result.fills >= 2
    assert result.books.maker_ratio() == dec("1"), (
        "the hedge crossed in a market that never moved away from it"
    )


def test_the_fallback_crosses_when_the_market_trends_away(tmp_path):
    """A resting bid does not get hit in a rising market.

    The maker attempt is correct and cheap; the fallback is what makes it safe.
    An order that only ever rests is not an execution style, it is a hope.
    """
    pipeline, adapters, result = run(build_cycling_events(), tmp_path / "b.jsonl")
    fallbacks = [r for r in pipeline.audit.read() if r["kind"] == "taker_fallback"]
    assert fallbacks, "the hedge rested forever instead of falling back"
    assert all(r["payload"]["accepted"] for r in fallbacks)
    assert result.books.maker_ratio() == dec("0.5"), "expected one maker leg per taker leg"


def test_the_replacement_joins_the_same_leg_group():
    """Otherwise the group waits on an order that no longer exists."""
    pipeline, adapters, result = run(build_cycling_events())
    assert pipeline.unwinder.completed_count > 0
    assert pipeline.unwinder.break_rate() == 0.0
    assert not result.books.positions


def test_crossing_immediately_costs_more_than_preferring_maker():
    """The comparison that justifies the extra machinery."""
    events = flat_market_events()
    _, _, preferred = run(events, taker_fallback_intervals=8, leg_timeout_intervals=12)
    _, _, crossing = run(
        events, taker_fallback_intervals=8, leg_timeout_intervals=12,
        params=FundingCarryParams(perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE,
                                  hedge_urgency="aggressive"),
    )
    assert crossing.books.total_fees() > preferred.books.total_fees()


def test_resting_too_briefly_makes_every_order_cross():
    """Which is the expensive outcome the maker path exists to avoid."""
    events = flat_market_events()
    _, _, impatient = run(events, taker_fallback_intervals=1, leg_timeout_intervals=3)
    assert impatient.books.maker_ratio() == dec("0.5"), (
        "expected the hedge to fall back to crossing"
    )


def test_a_filled_order_stops_waiting_on_its_fallback():
    pipeline, _, _ = run(flat_market_events(), taker_fallback_intervals=8,
                         leg_timeout_intervals=12)
    assert pipeline._fallbacks == {}, "a filled order was still queued to cross"
