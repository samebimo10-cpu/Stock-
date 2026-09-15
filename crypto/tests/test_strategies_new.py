"""The three strategies built to clear the cost gate, and what building them found.

Each of the "what the build found" tests pins a bug that cost real debugging
time. A test that only asserts the happy path lets the same bug back in on the
next refactor, and every one of these was invisible in review.
"""

from __future__ import annotations

import asyncio

import pytest

from tradesys.core.events import FeatureSnapshot
from tradesys.core.types import dec
from tradesys.layers.l2_features import trend as tf
from tradesys.layers.l3_strategy.base import declared_stop_distance
from tradesys.layers.l3_strategy.cascade import CascadeParams, LiquidationReversion
from tradesys.layers.l3_strategy.funding_dispersion import (
    DispersionParams, FundingDispersion,
)
from tradesys.layers.l3_strategy.trend import TimeSeriesMomentum, TrendParams
from tradesys.research.backtest import Backtester
from tradesys.research.registry import TrialRegistry
from tradesys.research.viability import COST_GATE, STRATEGY_PROFILES, assess
from tradesys.scenarios import (
    VENUE, VENUE_B, SYMBOL, build_carry_pipeline, build_cascade_pipeline,
    build_dispersion_pipeline, build_trend_pipeline, carry_events, cascade_events,
    dispersion_events, trend_events,
)

START = 1_700_000_000_000_000_000


def snap(venue=VENUE, symbol=SYMBOL, as_of=START, **features):
    return FeatureSnapshot(
        correlation_id="c", emitted_at=as_of, source="test",
        venue=venue, symbol=symbol, as_of=as_of, features=features)


# ------------------------------------------------------------------ features


def test_ewmac_is_normalised_by_the_size_of_a_typical_move():
    """Not by the standard deviation of moves about their mean.

    A steadily rising series has a large mean diff and near-zero deviation
    about it, so dividing by that standard deviation divides by roughly nothing
    and the signal explodes - on precisely the series a trend strategy most
    wants to be long.
    """
    steady = [dec(100 + i) for i in range(40)]
    assert tf.ewmac(steady) is not None
    assert tf.ewmac(steady) < dec(50), "a clean ramp must not produce an infinite signal"


def test_ewmac_is_signed_by_direction_and_none_when_flat():
    assert tf.ewmac([dec(100 + i) for i in range(40)]) > 0
    assert tf.ewmac([dec(100 - i) for i in range(40)]) < 0
    assert tf.ewmac([dec(100)] * 40) is None


def test_downside_volatility_ignores_upside():
    """Sizing off total volatility is under-sized in a melt-up and over-sized
    in a crash, which is exactly backwards."""
    assert tf.downside_volatility([dec(100), dec(110), dec(120)]) == 0
    assert tf.downside_volatility([dec(100), dec(90)]) > 0


def test_cascade_pressure_is_negative_for_forced_selling():
    """A long being liquidated is SOLD into the book. Getting the sign wrong
    fades the wrong way, which is worse than not trading."""
    assert tf.cascade_pressure([(dec(50), "sell")], dec(100)) < 0
    assert tf.cascade_pressure([(dec(50), "buy")], dec(100)) > 0


def test_cascade_pressure_refuses_to_divide_by_no_volume():
    assert tf.cascade_pressure([(dec(1), "sell")], dec(0)) is None


# --------------------------------------------------------------------- trend


def test_trend_declines_to_trade_without_a_trend():
    strategy = TimeSeriesMomentum(VENUE)
    assert strategy.on_features(snap(microprice=dec(100), ewmac=dec("0.2"),
                                     realised_volatility=dec("0.01"),
                                     atr=dec("0.01"))) == ()
    assert strategy.vetoes.get("no_trend") == 1


def test_trend_never_imputes_a_missing_feature():
    """Early in a session every feature is None. Treating missing as zero
    trades the warm-up period as though it were flat (SPEC section 5.3)."""
    strategy = TimeSeriesMomentum(VENUE)
    assert strategy.on_features(snap(microprice=dec(100), ewmac=None)) == ()
    assert strategy.vetoes.get("warming_up") == 1


def test_trend_refuses_when_the_range_disagrees_with_the_crossover():
    """A crossover can be positive while price is in the bottom of its range:
    a retracement inside a trend that has already turned."""
    strategy = TimeSeriesMomentum(VENUE)
    assert strategy.on_features(snap(
        microprice=dec(100), ewmac=dec("2.0"), breakout_position=dec("-0.8"),
        realised_volatility=dec("0.01"), atr=dec("0.01"))) == ()
    assert strategy.vetoes.get("disagreement") == 1


def test_trend_sizes_smaller_when_volatility_is_higher():
    """The whole point of volatility targeting, and easy to invert.

    Both volatilities are high enough that the scaling, not the weight cap, is
    what binds. At ordinary crypto volatility the cap binds instead - the
    scaling wants about 29% of budget and the cap allows 18% - so a test using
    ordinary values would compare two capped numbers and pass whatever the
    scaling did, including nothing.
    """
    def target(vol):
        s = TimeSeriesMomentum(VENUE, budget=dec("10000"))
        out = s.on_features(snap(microprice=dec(100), ewmac=dec("2.0"),
                                 breakout_position=dec("0.5"),
                                 realised_volatility=vol, atr=dec("0.01")))
        return abs(out[0].target_position)

    assert target(dec("0.12")) < target(dec("0.04"))


def test_the_weight_cap_binds_at_ordinary_crypto_volatility():
    """Worth knowing rather than discovering later: with a 20% target and
    crypto's ~70% annualised volatility, the scaling asks for 29% of budget and
    the cap allows 18%. Volatility targeting only bites above roughly 110%
    annualised - it is protection against extremes, not the day-to-day sizer."""
    strategy = TimeSeriesMomentum(VENUE, budget=dec("10000"))
    # 70% annualised, expressed per eight-hour interval.
    ordinary = dec("0.70") / dec(str((3 * 365) ** 0.5))
    out = strategy.on_features(snap(microprice=dec(100), ewmac=dec("2.0"),
                                    breakout_position=dec("0.5"),
                                    realised_volatility=ordinary,
                                    atr=dec("0.01")))
    notional = abs(out[0].target_position) * dec(100)
    assert notional == dec("10000") * strategy.params.max_weight


def test_trend_caps_the_position_however_quiet_it_gets():
    """Dividing by a small volatility is how a quiet fortnight produces a
    position five times anything in the backtest."""
    strategy = TimeSeriesMomentum(VENUE, budget=dec("10000"),
                                  params=TrendParams(max_weight=dec("0.18")))
    out = strategy.on_features(snap(microprice=dec(100), ewmac=dec("2.0"),
                                    breakout_position=dec("0.5"),
                                    realised_volatility=dec("0.00001"),
                                    atr=dec("0.01")))
    assert abs(out[0].target_position) * dec(100) <= dec("10000") * dec("0.18")


def test_the_trend_stop_is_scaled_to_the_holding_horizon():
    """"4 x ATR" on hourly data is a 0.18% stop that noise clears in an
    afternoon. A stop for a position held for weeks has to be measured over
    weeks."""
    strategy = TimeSeriesMomentum(VENUE)
    per_bar = dec("0.001")
    distance = strategy._stop_distance_for(per_bar)          # noqa: SLF001
    assert distance > per_bar * strategy.params.stop_sigma * dec(4), (
        "the stop must be scaled up by the square root of the holding horizon")


def test_the_trend_stop_is_clamped_below_certainty():
    """A stop price that can never be reached is no stop at all - the position
    would be held to liquidation instead."""
    strategy = TimeSeriesMomentum(VENUE)
    assert strategy._stop_distance_for(dec("0.9")) <= dec("0.5")   # noqa: SLF001


def test_trend_declares_its_stop_distance_to_the_risk_service():
    """RiskContext.stop_distance_frac was declared, checked and unit-tested,
    and nothing populated it - so every strategy was sized as though it had no
    stop. This is the wire that was missing."""
    strategy = TimeSeriesMomentum(VENUE)
    assert declared_stop_distance(strategy) is None, "nothing observed yet"
    strategy.on_features(snap(microprice=dec(100), ewmac=dec("0.1"),
                              atr=dec("0.002"), realised_volatility=dec("0.01")))
    distance = declared_stop_distance(strategy)
    assert distance is not None and 0 < distance <= 1


def test_the_pipeline_passes_stop_distances_into_the_risk_context():
    pipeline, _, _ = build_trend_pipeline()
    strategy = pipeline.strategies[0]
    strategy.on_features(snap(microprice=dec(100), ewmac=dec("0.1"),
                              atr=dec("0.002"), realised_volatility=dec("0.01")))
    distances = pipeline._stop_distances()                   # noqa: SLF001
    assert distances.get(strategy.strategy_id) is not None


def test_an_implausible_stop_declaration_is_ignored():
    """A distance above 1 is not a stop, and trusting it would size the
    position larger than no declaration at all."""

    class Liar:
        strategy_id = "liar"

        def stop_distance(self):
            return dec("5")

    assert declared_stop_distance(Liar()) is None


# ------------------------------------------------------------------- cascade


def cascade_feed(strategy, readings, price_path, atr=dec("0.004")):
    out = []
    for i, (pressure, price) in enumerate(zip(readings, price_path)):
        out.extend(strategy.on_features(snap(
            as_of=START + i * 60 * 10**9, microprice=price,
            cascade_pressure=pressure, atr=atr)))
    return out


def test_cascade_waits_for_the_flow_to_decay():
    strategy = LiquidationReversion(VENUE)
    signals = cascade_feed(strategy, [dec("-1.0")] * 3, [dec(100)] * 3)
    assert signals == []
    assert strategy.vetoes.get("still_falling")


def test_cascade_also_waits_for_price_to_turn():
    """Flow decay is necessary and not sufficient. Without this the strategy
    bought three times during a collapse, was stopped three times, and lost
    money in a scenario that recovered 60% of the drop."""
    strategy = LiquidationReversion(VENUE)
    # Pressure decays hard while price keeps falling.
    signals = cascade_feed(strategy,
                           [dec("-1.0"), dec("-0.2"), dec("-0.1")],
                           [dec(100), dec(96), dec(92)])
    assert signals == []
    assert strategy.vetoes.get("no_retracement")


def test_cascade_enters_once_flow_decays_and_price_turns():
    strategy = LiquidationReversion(VENUE)
    signals = cascade_feed(strategy,
                           [dec("-1.0"), dec("-0.8"), dec("-0.1")],
                           [dec(100), dec(92), dec(95)])
    assert len(signals) == 1
    assert signals[0].target_position > 0, "forced selling is faded by buying"
    assert signals[0].urgency == "aggressive"


def test_the_cascade_episode_survives_a_quiet_observation():
    """The entry condition is decay from a peak, so forgetting the peak when
    pressure falls forgets it at the moment the trade becomes available. The
    first version did exactly that and never entered anything."""
    strategy = LiquidationReversion(VENUE)
    cascade_feed(strategy, [dec("-1.0")], [dec(100)])
    assert strategy._peak.get(SYMBOL) == dec("1.0")          # noqa: SLF001
    cascade_feed(strategy, [dec(0)], [dec(101)])
    assert strategy._peak.get(SYMBOL) == dec("1.0"), (       # noqa: SLF001
        "one quiet observation must not wipe the episode")


def test_the_cascade_episode_does_expire_eventually():
    strategy = LiquidationReversion(
        VENUE, params=CascadeParams(max_hold_ns=60 * 10**9))
    strategy.on_features(snap(as_of=START, microprice=dec(100),
                              cascade_pressure=dec("-1.0"), atr=dec("0.004")))
    strategy.on_features(snap(as_of=START + 3600 * 10**9, microprice=dec(100),
                              cascade_pressure=dec(0), atr=dec("0.004")))
    assert SYMBOL not in strategy._peak                      # noqa: SLF001


def test_cascade_episode_state_is_not_shared_between_instances():
    """A mutable class attribute would have two strategies on two venues
    overwriting each other, and the symptom would be one of them occasionally
    fading the wrong way."""
    a, b = LiquidationReversion("v1"), LiquidationReversion("v2")
    a._signs["X"] = 1                                        # noqa: SLF001
    assert b._signs == {}                                    # noqa: SLF001


# ---------------------------------------------------------------- dispersion


def dispersion_feed(strategy, rate_a, rate_b, as_of=START, price=dec(60000)):
    strategy.on_features(snap(venue="a", as_of=as_of, microprice=price,
                              annualised_funding=rate_a * dec(3 * 365)))
    return strategy.on_features(snap(venue="b", as_of=as_of, microprice=price,
                                     annualised_funding=rate_b * dec(3 * 365)))


def dispersion() -> FundingDispersion:
    return FundingDispersion(SYMBOL, "a", "b")


def test_dispersion_needs_both_venues_before_it_will_act():
    """A spread built from rates observed hours apart is not a spread that
    existed at any moment."""
    strategy = dispersion()
    assert strategy.on_features(snap(venue="b", microprice=dec(60000),
                                     annualised_funding=dec("0.1"))) == ()
    assert strategy.vetoes.get("one_sided")


def test_dispersion_trades_the_difference_not_the_level():
    """Two venues both paying a lot, equally, is not an opportunity."""
    strategy = dispersion()
    assert dispersion_feed(strategy, dec("0.0020"), dec("0.0020")) == ()
    assert strategy.vetoes.get("spread_too_small")


def test_dispersion_enters_opposite_legs_on_the_two_venues():
    strategy = dispersion()
    legs = dispersion_feed(strategy, dec("0.0012"), dec("0.0001"))
    assert len(legs) == 2
    assert legs[0].target_position < 0, "short the venue that pays"
    assert legs[1].target_position > 0
    assert legs[0].leg_group == legs[1].leg_group, "one trade, not two"


def test_dispersion_refuses_a_spread_that_cannot_cover_its_round_trip():
    """The check the first carry strategy got backwards: a None meaning fine
    was read as a veto."""
    strategy = FundingDispersion(
        SYMBOL, "a", "b",
        params=DispersionParams(entry_spread=dec("0.0001"),
                                round_trip_cost=dec("0.05"),
                                max_hold_intervals=2))
    assert dispersion_feed(strategy, dec("0.0005"), dec("0")) == ()
    assert strategy.vetoes.get("below_breakeven")


def test_dispersion_closes_when_the_spread_converges():
    strategy = dispersion()
    dispersion_feed(strategy, dec("0.0012"), dec("0.0001"))
    legs = dispersion_feed(strategy, dec("0.0002"), dec("0.0002"),
                           as_of=START + 8 * 3600 * 10**9)
    assert len(legs) == 2
    assert all(leg.target_position == 0 for leg in legs)


def test_dispersion_rejects_rates_observed_too_far_apart():
    strategy = dispersion()
    strategy.on_features(snap(venue="a", as_of=START, microprice=dec(60000),
                              annualised_funding=dec("1.3")))
    out = strategy.on_features(snap(venue="b", as_of=START + 48 * 3600 * 10**9,
                                    microprice=dec(60000),
                                    annualised_funding=dec("0.1")))
    assert out == ()
    assert strategy.vetoes.get("stale_pair")


# --------------------------------------------------------- end to end, costs


def run(factory, events_fn, name):
    pipeline, adapters, _ = factory(True)
    return asyncio.run(
        Backtester(pipeline, adapters, TrialRegistry(), name).run(events_fn()))


@pytest.mark.parametrize("name,factory,events_fn", [
    ("trend", build_trend_pipeline, trend_events),
    ("cascade", build_cascade_pipeline, cascade_events),
    ("funding_dispersion", build_dispersion_pipeline, dispersion_events),
])
def test_each_strategy_actually_trades_its_own_scenario(name, factory, events_fn):
    """A strategy that emits nothing is not passing, it is absent."""
    result = run(factory, events_fn, name)
    assert result.fills >= 2, f"{name} never completed a round trip"


@pytest.mark.parametrize("name,factory,events_fn", [
    ("trend", build_trend_pipeline, trend_events),
    ("cascade", build_cascade_pipeline, cascade_events),
    ("funding_dispersion", build_dispersion_pipeline, dispersion_events),
])
def test_each_strategy_clears_the_cost_gate_on_its_scenario(name, factory, events_fn):
    """Synthetic, so this is evidence about cost structure and nothing else -
    the fills are real fills through the shared cost model. It is NOT evidence
    the strategy makes money."""
    result = run(factory, events_fn, name)
    assert result.cost_ratio is not None
    assert result.cost_ratio <= COST_GATE, (
        f"{name} spends {float(result.cost_ratio) * 100:.1f}% of gross on costs")


def test_the_cost_ratio_measured_on_synthetic_data_measures_the_scenario():
    """The most important finding of the strategy work, pinned.

    The same carry code measures 68.7% in `tradesys demo` and about 11% here.
    The demo emits one bar per eight-hour funding interval, so the second leg
    crossed eight hours late and price drift was charged as though it were
    spread. Neither number is a property of the strategy (ADR 0007).
    """
    result = run(build_carry_pipeline, carry_events, "funding_carry")
    assert result.cost_ratio is not None
    assert result.cost_ratio < dec("0.40"), (
        "at a resolution that can see the execution, carry's measured cost "
        "ratio is nothing like the demo's 68.7%")


def test_a_slow_second_leg_costs_far_more_than_the_spread():
    """ADR 0007. The deadline, not the spread, is what the cost was.

    The leg timeout moves with the fallback on purpose. Leaving it fixed means
    the group is unwound before the slow fallback can fire, and the comparison
    measures the unwinder instead of the execution.
    """
    def share(fallback_bars):
        pipeline, adapters, _ = build_dispersion_pipeline(
            True, fallback_bars=fallback_bars, timeout_bars=fallback_bars + 2)
        result = asyncio.run(
            Backtester(pipeline, adapters, TrialRegistry(), "d")
            .run(dispersion_events()))
        return result.cost_ratio

    fast, slow = share(1), share(8)
    assert fast is not None and slow is not None
    assert fast < slow, "arriving late with the second leg has to cost more"


# -------------------------------------------------------------- the profiles


def test_every_strategy_has_a_written_down_edge_profile():
    """A strategy whose author cannot say what the average winner is, how often
    it wins, and how many fills a round trip takes has a backtest rather than a
    strategy."""
    names = {p.name for p in STRATEGY_PROFILES}
    assert {"trend", "cascade", "funding_dispersion", "funding_carry"} <= names


def test_the_profiles_agree_with_the_gate_they_claim_to_clear():
    verdicts = {p.name: assess(p).clears for p in STRATEGY_PROFILES}
    assert verdicts["trend"] and verdicts["cascade"]
    assert verdicts["funding_dispersion"]
    assert not verdicts["funding_carry"], (
        "carry collects the funding LEVEL against a fixed round trip; that "
        "conclusion is arithmetic and survives any scenario")


def test_a_profile_with_no_edge_reports_no_cost_share_rather_than_a_ratio():
    """A ratio against a negative denominator is not a cost share."""
    from tradesys.research.viability import EdgeProfile

    hopeless = EdgeProfile("hopeless", dec("0.01"), dec("0.05"), dec("0.3"),
                           fills=2, crossing_legs=1, trips_per_year=10)
    result = assess(hopeless)
    assert result.cost_share is None
    assert not result.clears
    assert "NEGATIVE EDGE" in str(result)
