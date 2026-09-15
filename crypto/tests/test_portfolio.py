"""Netting, correlation on short samples, and risk-parity allocation."""

from __future__ import annotations

import pytest

from tradesys.core.events import Signal
from tradesys.core.types import dec
from tradesys.layers.l4_portfolio.allocate import (
    MAX_WEIGHT, MIN_WEIGHT, risk_parity_weights,
)
from tradesys.layers.l4_portfolio.correlation import (
    CorrelationEstimator, MIN_OBSERVATIONS, PESSIMISTIC_PRIOR,
)
from tradesys.layers.l4_portfolio.netting import NettingError, net_targets


def sig(strategy, target, symbol="BTCUSDT"):
    return Signal(correlation_id="c", emitted_at=0, source="s", strategy_id=strategy,
                  venue="sim", symbol=symbol, target_position=dec(target), valid_until=1)


# --------------------------------------------------------------- netting


def test_offsetting_intentions_are_netted():
    """On a multi-strategy book this removes 20-40% of gross turnover."""
    result = net_targets([sig("A", "10"), sig("B", "-8")])
    assert result.targets[0].target == dec("2")
    assert result.turnover_saved == pytest.approx(dec("0.888888"), abs=dec("0.001"))


def test_netting_preserves_attribution():
    """An internal crossing must not distort who earned what."""
    result = net_targets([sig("A", "10"), sig("B", "-8")])
    contributions = result.targets[0].contributions
    assert contributions == {"A": dec("10"), "B": dec("-8")}


def test_netting_never_increases_a_position():
    for a, b in (("10", "5"), ("-10", "-5"), ("10", "-5"), ("0", "7")):
        result = net_targets([sig("A", a), sig("B", b)])
        assert abs(result.targets[0].target) <= abs(dec(a)) + abs(dec(b))


def test_different_symbols_are_not_netted_together():
    result = net_targets([sig("A", "10", "BTCUSDT"), sig("B", "-10", "ETHUSDT")])
    assert len(result.targets) == 2
    assert result.gross_after == dec("20")


def test_allocation_multiplier_scales_the_whole_book_evenly():
    """A drawdown reduces everything, not whichever strategy signalled last."""
    full = net_targets([sig("A", "10"), sig("B", "-4")])
    halved = net_targets([sig("A", "10"), sig("B", "-4")], multiplier=dec("0.5"))
    assert halved.targets[0].target == full.targets[0].target / 2


# ---------------------------------------------------------- correlation


def test_a_short_sample_falls_back_to_a_pessimistic_prior():
    """Costs a little diversification; stops the optimiser trusting a coincidence."""
    e = CorrelationEstimator()
    for i in range(MIN_OBSERVATIONS - 1):
        e.observe("A", float(i))
        e.observe("B", float(-i))
    rho, estimated = e.correlation("A", "B")
    assert rho == PESSIMISTIC_PRIOR
    assert not estimated                     # the caller can see it is an assumption


def test_a_long_sample_is_estimated():
    e = CorrelationEstimator()
    for i in range(80):
        v = float((i % 7) - 3)
        e.observe("A", v)
        e.observe("B", v)
    rho, estimated = e.correlation("A", "B")
    assert estimated
    assert rho > 0.8


def test_the_higher_of_two_windows_is_used():
    """Correlations rise in stress, and the stress estimate is the one that bites."""
    e = CorrelationEstimator(long_window=60, short_window=20, shrink_intensity=0.0)
    for i in range(60):
        e.observe("A", float((i % 5) - 2))
        e.observe("B", float(2 - (i % 5)))          # perfectly negative, long run
    for i in range(20):                             # recent stretch moves together
        e.observe("A", float(i))
        e.observe("B", float(i))
    rho, _ = e.correlation("A", "B")
    assert rho > 0.5                                 # the stressed window wins


def test_threshold_breaches_name_the_action():
    e = CorrelationEstimator()
    for i in range(80):
        v = float((i % 7) - 3)
        e.observe("A", v)
        e.observe("B", v)
    breaches = e.breaches(["A", "B"])
    assert breaches and breaches[0][3] == "disable_worse_performer"


# ---------------------------------------------------------- allocation


def test_equal_risk_contribution_is_achieved():
    result = risk_parity_weights(
        ["A", "B", "C"], [0.10, 0.20, 0.15],
        [[1, 0.2, 0.1], [0.2, 1, 0.3], [0.1, 0.3, 1]],
        turnover_penalty=0.0, max_weight=1.0,
    )
    assert result.converged
    assert result.max_contribution_spread < 1e-6
    assert all(abs(rc - 1 / 3) < 1e-6 for rc in result.risk_contributions)


def test_lower_volatility_earns_a_larger_weight():
    result = risk_parity_weights(["A", "B"], [0.10, 0.40], [[1, 0], [0, 1]],
                                 turnover_penalty=0.0, max_weight=1.0)
    assert result.weights[0] > result.weights[1]
    assert result.weights[0] == pytest.approx(0.8, abs=0.01)


def test_the_forty_percent_cap_is_infeasible_on_a_small_book():
    """Two strategies cannot both sit below 40% of a budget summing to 100%.

    The cap in SPEC section 7.1 assumes the 5-10 strategy book it is written
    for. On a Track A book it is arithmetically impossible, so it is relaxed
    to equal weight and the relaxation is reported: the binding constraint is
    "you do not have enough strategies", which is a portfolio problem rather
    than a solver problem.
    """
    result = risk_parity_weights(["A", "B"], [0.10, 0.40], [[1, 0], [0, 1]],
                                 turnover_penalty=0.0)
    assert result.cap_relaxed
    assert result.weights == pytest.approx((0.5, 0.5), abs=1e-6)


def test_the_cap_binds_on_a_book_large_enough_for_it():
    result = risk_parity_weights(
        ["A", "B", "C"], [0.05, 0.40, 0.40], [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
        turnover_penalty=0.0,
    )
    assert not result.cap_relaxed
    assert max(result.weights) <= MAX_WEIGHT + 1e-9
    assert min(result.weights) >= MIN_WEIGHT - 1e-9


def test_the_turnover_deadband_prevents_churn():
    """A reallocation must be worth more than its own transaction cost."""
    previous = {"A": 0.34, "B": 0.33, "C": 0.33}
    result = risk_parity_weights(
        ["A", "B", "C"], [0.10, 0.20, 0.15],
        [[1, 0.2, 0.1], [0.2, 1, 0.3], [0.1, 0.3, 1]],
        previous=previous, turnover_penalty=5.0,
    )
    assert result.as_dict() == pytest.approx(previous, abs=1e-9)


def test_infeasible_minimum_weight_is_refused():
    with pytest.raises(ValueError, match="cannot all be satisfied"):
        risk_parity_weights(["A"] * 30, [0.1] * 30, [[1.0] * 30] * 30, min_weight=0.05)


def test_single_strategy_book():
    result = risk_parity_weights(["A"], [0.2], [[1.0]])
    assert result.weights == (1.0,)
    assert result.cap_relaxed             # concentration is forced, not chosen
