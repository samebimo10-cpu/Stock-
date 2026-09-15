"""What the carry strategy would need, as arithmetic rather than opinion.

"It fails the cost gate" is where the last increment stopped. These tests pin
down the next question - by how much, and what would have to change - because
the answer is either a specification for the next thing to build or a proof
that nothing reachable supplies it.
"""

from __future__ import annotations

import pytest

from tradesys.core.types import dec
from tradesys.research.viability import (
    BINANCE_FUTURES_TIERS, COST_GATE, OBSERVED_FUNDING, CostStructure,
    carry_requirement, survey,
)


def tier0(**over):
    kw = {"maker_rate": dec("0.0002"), "taker_rate": dec("0.0005")}
    kw.update(over)
    return CostStructure(**kw)


def test_a_carry_round_trip_is_four_fills_not_two():
    """Two legs, each opened and closed.

    Modelling it as two is the most common way a carry backtest halves its own
    costs, and it halves them in the direction that keeps the strategy alive.
    """
    assert tier0().fills == 4


def test_crossing_every_leg_costs_more_than_resting_every_leg():
    crossing = tier0(crossing_legs=2).round_trip_fraction()
    resting = tier0(crossing_legs=0).round_trip_fraction()
    assert crossing > resting


def test_resting_still_pays_adverse_selection():
    """A maker fill is not free, it is differently priced.

    A model where resting costs nothing makes passive execution look like a
    solution to a cost problem, which is exactly the mistake ADR 0004 records.
    """
    assert tier0(crossing_legs=0, adverse_selection_bps=dec("2")).round_trip_fraction() > 0


def test_the_required_rate_is_the_gate_solved_for_funding():
    """N x rate >= 2.5c, so rate >= 2.5c / N. Nothing more than that."""
    structure = tier0(crossing_legs=1)
    requirement = carry_requirement(structure, hold_intervals=21)
    expected = structure.round_trip_fraction() / COST_GATE / dec(21)
    assert requirement.required_rate == expected


def test_a_longer_hold_lowers_the_bar_proportionally():
    short = carry_requirement(tier0(), hold_intervals=10).required_rate
    long_ = carry_requirement(tier0(), hold_intervals=20).required_rate
    assert short == long_ * 2


def test_a_zero_length_hold_is_refused():
    """It collects no funding, so the required rate would be infinite."""
    with pytest.raises(ValueError):
        carry_requirement(tier0(), hold_intervals=0)


def test_baseline_funding_does_not_clear_the_gate_at_any_fee_tier():
    """The finding, pinned.

    Even at VIP 9 - four billion USDT of 30-day volume, which is not a tier
    this operation will reach - baseline funding is short of what the gate
    needs. Fee tier is not the lever.
    """
    baseline = dec("0.0001")
    for requirement in survey(BINANCE_FUTURES_TIERS, hold_intervals=21,
                              crossing_legs=1, observed_rate=baseline):
        assert not requirement.clears, f"{requirement.structure.label} unexpectedly clears"


def test_a_crowded_market_does_clear_it():
    """So the strategy is not hopeless - it is conditional, on a specific thing.

    That condition is checkable in advance, which makes it a filter rather than
    a hope.
    """
    crowded = dict(OBSERVED_FUNDING)["mildly crowded"]
    requirement = carry_requirement(tier0(crossing_legs=1), hold_intervals=21,
                                    observed_rate=crowded)
    assert requirement.clears


def test_the_required_rate_annualises_to_something_comparable():
    """A per-interval funding rate is a number nobody has intuition about."""
    requirement = carry_requirement(tier0(crossing_legs=1), hold_intervals=21)
    assert requirement.required_annualised == requirement.required_rate * dec(3 * 365)
    assert dec("0.20") < requirement.required_annualised < dec("0.35")


def test_intervals_needed_at_baseline_exceeds_the_strategy_s_own_hold_limit():
    """The two halves of the same finding agree.

    The strategy caps holding at 21 intervals; at baseline funding the gate
    needs far more than that. A strategy whose cost gate needs a longer hold
    than its own risk limit permits cannot clear it by waiting.
    """
    requirement = carry_requirement(tier0(crossing_legs=1), hold_intervals=21,
                                    observed_rate=dec("0.0001"))
    assert requirement.intervals_at_observed > 21


def test_lower_fees_help_but_do_not_close_the_gap():
    """Quantifies how much of the problem is fees. It is under half of it."""
    top = survey(BINANCE_FUTURES_TIERS, crossing_legs=1)[-1]
    bottom = survey(BINANCE_FUTURES_TIERS, crossing_legs=1)[0]
    assert top.required_rate < bottom.required_rate
    assert top.required_rate > dec("0.0001"), "still above baseline funding"
