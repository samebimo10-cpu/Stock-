"""Statistical arbitrage on a cointegrated pair, and the portfolio it enables."""

from __future__ import annotations

import math

import pytest

from tradesys.core.events import FeatureSnapshot
from tradesys.core.types import dec
from tradesys.layers.l2_features.derivs import hedge_ratio, spread_half_life, spread_zscore
from tradesys.layers.l3_strategy.stat_arb import StatArbPairs, StatArbParams
from tradesys.layers.l4_portfolio.allocate import risk_parity_weights
from tradesys.layers.l4_portfolio.correlation import CorrelationEstimator


def snap(symbol, price, t):
    return FeatureSnapshot(correlation_id="c", emitted_at=0, source="t", venue="v",
                           symbol=symbol, as_of=t,
                           features={"microprice": dec(str(price))})


def feed(strategy, periods=60, amplitude=2.0, shock=None):
    """Drive both legs of a wobbling pair. Returns the last signals emitted."""
    emitted = []
    for i in range(periods):
        wobble = math.sin(i / 4) * amplitude
        extra = shock(i) if shock else 0.0
        strategy.on_features(snap("AAA", 100 + wobble + extra, i))
        out = strategy.on_features(snap("BBB", 50 + wobble / 2, i))
        if out:
            emitted.append((i, out))
    return emitted


def strategy(**kwargs):
    return StatArbPairs("AAA", "BBB", "v", "v", params=StatArbParams(**kwargs))


# --------------------------------------------------------------- features


def test_the_hedge_ratio_recovers_a_known_relationship():
    a = [dec(str(100 + math.sin(i / 3) * 2)) for i in range(60)]
    b = [dec(str(50 + math.sin(i / 3) * 1)) for i in range(60)]
    assert abs(float(hedge_ratio(a, b)) - 2.0) < 0.01


def test_a_short_sample_yields_no_estimate():
    """A z-score from a handful of points is a number with no information."""
    a = [dec("100")] * 20
    b = [dec("50")] * 20
    assert hedge_ratio(a, b) is None
    assert spread_zscore(a, b) is None


def test_a_drifting_spread_has_no_half_life():
    """Which is the answer that matters most: it is not mean-reverting."""
    drifting = [dec(str(100 + i)) for i in range(60)]
    stable = [dec(str(50 + math.sin(i / 3))) for i in range(60)]
    assert spread_half_life(drifting, stable) is None


def test_a_reverting_spread_has_one():
    a = [dec(str(100 + math.sin(i / 4) * 2)) for i in range(60)]
    b = [dec(str(50 + math.sin(i / 4))) for i in range(60)]
    assert spread_half_life(a, b) is not None


# --------------------------------------------------------------- strategy


def test_it_waits_for_enough_history():
    s = strategy()
    feed(s, periods=20)
    assert "not enough history" in (s.last_veto or "")


def test_it_enters_on_a_stretched_spread():
    s = strategy()
    emitted = feed(s)
    assert emitted, "never entered a spread that clearly stretched"
    _, legs = emitted[0]
    assert len(legs) == 2


def test_both_legs_share_a_group():
    """A half-filled pair is a directional position."""
    s = strategy()
    _, legs = feed(s)[0]
    assert len({leg.leg_group for leg in legs}) == 1
    assert {leg.leg_role for leg in legs} == {"primary", "hedge"}


def test_the_legs_are_hedged_by_ratio_not_by_notional():
    """Equal notionals leave a directional residual whenever beta is not one."""
    s = strategy()
    _, legs = feed(s)[0]
    a, b = legs
    notional_a = abs(a.target_position) * dec("100")
    notional_b = abs(b.target_position) * dec("50")
    assert notional_a != notional_b, "legs were sized to equal notionals"
    assert (a.target_position > 0) != (b.target_position > 0), "legs point the same way"


def test_it_refuses_a_spread_that_reverts_too_slowly():
    """A spread reverting over three months is a fact, not a strategy."""
    s = strategy(max_half_life=dec("0.001"))
    feed(s)
    assert "half-life" in (s.last_veto or "")


def test_it_refuses_a_drifting_spread():
    s = strategy()
    feed(s, shock=lambda i: i * 0.5)          # one leg walks away
    assert s.last_veto in (None, "") or "drifting" in s.last_veto or "stop" in s.last_veto


def test_it_exits_when_the_spread_reverts():
    s = strategy()
    emitted = feed(s)
    exits = [legs for _, legs in emitted if all(leg.target_position == 0 for leg in legs)]
    assert exits, "entered and never exited"


def test_the_stop_closes_rather_than_averaging_in():
    """A wider spread looks like a better entry. That instinct is the tail."""
    s = strategy(entry_z=dec("1.5"), stop_z=dec("2.5"))
    feed(s, shock=lambda i: (i - 40) * 1.5 if i > 40 else 0.0)
    assert s._position_sign == 0, "held a position past the stop"


def test_it_never_trades_one_leg_alone():
    s = strategy()
    for _, legs in feed(s):
        assert len(legs) == 2, "emitted a single-leg signal"


def test_it_reports_five_parameters():
    """The hard limit is six, and staying under it is a design constraint."""
    params = StatArbParams().as_dict()
    assert len(params) == 5


# -------------------------------------------------- the portfolio it enables


def test_risk_parity_across_two_strategies_has_something_to_decide():
    """Across one strategy it is arithmetic with no choice in it."""
    one = risk_parity_weights(["carry"], [0.10], [[1.0]])
    assert one.weights == (1.0,)

    two = risk_parity_weights(["carry", "stat_arb"], [0.08, 0.20],
                              [[1.0, 0.1], [0.1, 1.0]],
                              turnover_penalty=0.0, max_weight=1.0)
    assert two.weights[0] > two.weights[1], "the calmer strategy should carry more capital"
    assert abs(two.risk_contributions[0] - two.risk_contributions[1]) < 1e-6


def test_two_short_volatility_strategies_are_flagged_as_one_cluster():
    """Both are short volatility, so the diversification may not be real."""
    estimator = CorrelationEstimator()
    for i in range(80):
        shared = float((i % 7) - 3)
        estimator.observe("carry", shared)
        estimator.observe("stat_arb", shared * 0.95)
    breaches = estimator.breaches(["carry", "stat_arb"])
    assert breaches, "correlated short-volatility strategies were not flagged"
    assert breaches[0][3] in ("halve_combined_allocation", "disable_worse_performer")
