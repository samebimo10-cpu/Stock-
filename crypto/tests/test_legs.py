"""Leg groups, the unwinder, and the hedged carry strategy.

The specification's instruction is to specify the unwinder before the
detector. These tests exist for the same reason: a multi-leg trade that fills
one side and not the other is holding exposure nobody sized, and the cost of
getting out routinely exceeds the profit the trade was chasing.
"""

from __future__ import annotations

import asyncio

import pytest

from tradesys.core.events import FeatureSnapshot, OrderStatus
from tradesys.core.types import dec
from tradesys.demo import PERP_VENUE, SPOT_VENUE, build_cycling_events, build_pipeline
from tradesys.layers.l3_strategy.base import StrategyState
from tradesys.layers.l3_strategy.funding_carry import FundingCarry, FundingCarryParams
from tradesys.layers.l6_execution.legs import (
    GroupStatus, LegState, Unwinder,
)
from tradesys.research.backtest import Backtester
from tradesys.research.registry import TrialRegistry


def group_of(unwinder, timeout=1000):
    g = unwinder.open("g1", "carry", 0)
    g.add_leg(LegState("ts_perp", PERP_VENUE, "BTCUSDT", "sell", dec("1")))
    g.add_leg(LegState("ts_spot", SPOT_VENUE, "BTCUSDT", "buy", dec("1")))
    return g


def snap(z, annual, venue=PERP_VENUE):
    return FeatureSnapshot(
        correlation_id="c", emitted_at=0, source="t", venue=venue, symbol="BTCUSDT",
        as_of=1000, features={"funding_zscore": dec(z), "annualised_funding": dec(annual),
                              "microprice": dec("60000")})


# ---------------------------------------------------------- leg groups


def test_a_complete_group_is_complete():
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    u.on_fill("ts_spot", dec("1"))
    assert g.evaluate(5000) == GroupStatus.COMPLETE


def test_a_group_is_pending_before_its_timeout():
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    assert g.evaluate(500) == GroupStatus.PENDING


def test_a_half_filled_group_breaks_after_its_timeout():
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    assert g.evaluate(2000) == GroupStatus.BROKEN
    assert g.naked_exposure == {(PERP_VENUE, "BTCUSDT"): dec("-1")}


def test_a_group_with_nothing_filled_is_abandoned_not_unwound():
    """Nothing filled means nothing to flatten. Cancel and walk away."""
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    assert g.evaluate(2000) == GroupStatus.ABANDONED
    assert g.unwind_orders() == []


def test_a_rejected_leg_breaks_the_group_without_waiting():
    """A leg that cannot fill has already broken the pair."""
    u = Unwinder(timeout_ns=10**12)
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    u.on_status("ts_spot", OrderStatus.REJECTED)
    assert g.evaluate(1) == GroupStatus.BROKEN


def test_the_unwind_flattens_the_filled_leg_and_cancels_the_other():
    """Chasing the missing leg is the tempting response and the wrong one."""
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    g.evaluate(2000)

    orders = g.unwind_orders()
    assert len(orders) == 1
    assert (orders[0].venue, orders[0].side, orders[0].quantity) == (PERP_VENUE, "buy", dec("1"))
    assert g.orders_to_cancel() == ["ts_spot"]


def test_a_partially_filled_leg_unwinds_only_what_filled():
    u = Unwinder(timeout_ns=1000)
    g = group_of(u)
    u.on_fill("ts_perp", dec("0.4"))
    g.evaluate(2000)
    assert g.unwind_orders()[0].quantity == dec("0.4")


def test_the_break_rate_is_visible():
    """A rising break rate means the legs stopped filling together."""
    u = Unwinder(timeout_ns=1000)
    assert u.break_rate() is None
    g = group_of(u)
    u.on_fill("ts_perp", dec("1"))
    u.mark_unwinding(g, 2000)
    assert u.break_rate() == 1.0


def test_a_timeout_shorter_than_the_data_cadence_is_refused():
    """Otherwise every group expires before its legs can fill.

    The symptom is a strategy that appears not to trade, which is exactly the
    kind of failure that gets diagnosed as the strategy rather than the wiring.
    """
    u = Unwinder(timeout_ns=1000)
    u.observe_cadence(5000)
    assert not u.timeout_is_workable()
    with pytest.raises(ValueError, match="not longer than the observed event cadence"):
        u.open("g2", "carry", 0)


# ------------------------------------------------------ the hedged strategy


def test_an_unhedged_carry_refuses_to_run_past_research():
    """Without the spot leg this is a short perpetual, not carry."""
    s = FundingCarry(params=FundingCarryParams())      # no spot venue
    s.health.state = StrategyState.PAPER
    assert s.on_features(snap("2.0", "0.40")) == ()
    assert "unhedged carry is not approved" in s.last_veto


def test_an_unhedged_carry_may_run_in_research():
    """Research may exercise the pipeline; nothing past research may."""
    s = FundingCarry(params=FundingCarryParams())
    s.health.state = StrategyState.RESEARCH
    assert len(s.on_features(snap("2.0", "0.40"))) == 1


def test_a_hedged_entry_emits_two_legs():
    s = FundingCarry(params=FundingCarryParams(perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE))
    legs = s.on_features(snap("2.0", "0.40"))
    assert len(legs) == 2
    assert {leg.venue for leg in legs} == {PERP_VENUE, SPOT_VENUE}
    assert len({leg.leg_group for leg in legs}) == 1, "legs must share one group"


def test_the_legs_are_equal_and_opposite():
    """What is left after the hedge is the funding, which is the whole point."""
    s = FundingCarry(params=FundingCarryParams(perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE))
    perp, spot = s.on_features(snap("2.0", "0.40"))
    assert perp.target_position == -spot.target_position
    assert perp.target_position < 0, "the perpetual leg is the short one"


def test_the_hedge_is_more_urgent_than_the_primary():
    """A resting bid does not get hit in a rising market.

    Legging into a hedge passively fills the perpetual, leaves the spot
    behind, and turns a market-neutral pair into a directional short. The
    hedge therefore posts and then crosses, rather than only posting.
    """
    s = FundingCarry(params=FundingCarryParams(perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE))
    perp, spot = s.on_features(snap("2.0", "0.40"))
    assert perp.urgency == "passive"
    assert spot.urgency == "maker_preferred"


def test_the_hedge_can_be_forced_to_cross_immediately():
    """Certain and expensive. Available when certainty is worth the spread."""
    s = FundingCarry(params=FundingCarryParams(
        perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE, hedge_urgency="aggressive"))
    _, spot = s.on_features(snap("2.0", "0.40"))
    assert spot.urgency == "aggressive"


def test_the_exit_also_emits_both_legs():
    s = FundingCarry(params=FundingCarryParams(perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE))
    s.on_features(snap("2.0", "0.40"))
    exits = s.on_features(snap("0.1", "0.40"))
    assert len(exits) == 2
    assert all(leg.target_position == 0 for leg in exits)


# ------------------------------------------------------------ end to end


def test_the_hedged_strategy_ends_flat_with_no_broken_groups():
    pipeline, adapters, _ = build_pipeline()
    result = asyncio.run(
        Backtester(pipeline, adapters, TrialRegistry(), "fc").run(build_cycling_events())
    )
    assert result.fills >= 8
    assert not result.books.positions, f"left holding {result.books.positions}"
    assert pipeline.unwinder.completed_count > 0
    assert pipeline.unwinder.break_rate() == 0.0


def test_the_hedge_pays_taker_fees_and_the_primary_does_not():
    """Paying the spread on one leg is the price of actually being hedged."""
    pipeline, adapters, _ = build_pipeline()
    result = asyncio.run(
        Backtester(pipeline, adapters, TrialRegistry(), "fc").run(build_cycling_events())
    )
    ratio = result.books.maker_ratio()
    assert ratio is not None
    assert dec("0.3") < ratio < dec("0.7"), "expected roughly one maker leg per taker leg"


def test_both_venues_trade():
    pipeline, adapters, _ = build_pipeline()
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "fc").run(build_cycling_events()))
    assert adapters[PERP_VENUE].fills, "the perpetual leg never traded"
    assert adapters[SPOT_VENUE].fills, "the spot leg never traded"


def test_the_book_is_delta_neutral_while_a_position_is_open():
    """The two legs offset. What remains is funding, not price direction."""
    pipeline, adapters, _ = build_pipeline()
    events = build_cycling_events()
    seen_neutral = False

    async def drive():
        nonlocal seen_neutral
        for event in events:
            for venue in adapters.values():
                venue.apply_market_event(event)
            await pipeline.on_market_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)
            positions = pipeline.books.positions
            if len(positions) == 2:
                net = sum((p.quantity for p in positions.values()), dec(0))
                assert abs(net) < dec("0.0001"), f"not neutral: {positions}"
                seen_neutral = True

    asyncio.run(drive())
    assert seen_neutral, "never held both legs, so neutrality was never tested"
