"""Cost model, trial registry and validation arithmetic."""

from __future__ import annotations

import math

import pytest

from tradesys.core.types import dec
from tradesys.research.costmodel import (
    CostModel, FeeModel, carry_breakeven_periods, maker_edge_bps,
    market_impact_bps, slippage_cost,
)
from tradesys.research.registry import RegistryRequired, TrialRegistry
from tradesys.research.validation import (
    block_bootstrap_drawdown, bootstrap_expectancy_ci, deflated_sharpe,
    expected_max_sharpe, live_vs_backtest_z, max_drawdown, monte_carlo_drawdown,
    probability_of_backtest_overfitting, purged_kfold_splits, sharpe,
    time_to_significance_years,
)


# ------------------------------------------------------------ cost model


def test_slippage_walks_real_depth():
    book = [(dec("101"), dec("1")), (dec("102"), dec("1"))]
    assert slippage_cost(book, dec("2"), dec("100")) == dec("3")


def test_unfillable_size_returns_none_rather_than_filling():
    """Filling the remainder models infinite liquidity at the worst moment."""
    book = [(dec("101"), dec("1"))]
    assert slippage_cost(book, dec("5"), dec("100")) is None


def test_carry_breakeven_at_tier_zero_is_ten_days():
    """0.30% round trip against 0.01% per 8h needs 30 intervals.

    The number that decides whether to enter at all. A strategy that enters
    and exits on a two-day funding excursion loses money at tier 0 while
    appearing to collect funding the whole time.
    """
    periods = carry_breakeven_periods(dec("0.003"), dec("0.0001"))
    assert periods == dec("30")
    assert periods / 3 == dec("10")            # three settlements a day


def test_elevated_funding_shortens_the_breakeven():
    assert carry_breakeven_periods(dec("0.003"), dec("0.0003")) == dec("10")


def test_negative_funding_never_breaks_even():
    assert carry_breakeven_periods(dec("0.003"), dec("-0.0001")) is None


def test_market_making_is_negative_at_tier_zero():
    """Annex B section 5.1: about -5bp per round trip before any skill."""
    edge = maker_edge_bps(dec("0.5"), dec("1.5"), dec("2"))
    assert edge == dec("-5.0")
    assert edge < 0


def test_market_making_works_with_a_rebate():
    assert maker_edge_bps(dec("0.5"), dec("0.3"), dec("-0.1")) > 0


def test_impact_grows_with_the_square_root_of_size():
    small = market_impact_bps(dec("100"), dec("10000"), dec("200"))
    big = market_impact_bps(dec("400"), dec("10000"), dec("200"))
    assert big / small == pytest.approx(2.0, abs=0.01)


def test_fee_tier_is_a_function_of_volume():
    """A backtest assuming a tier the account will not reach overstates results."""
    fees = FeeModel(dec("0.001"), dec("0.001"),
                    tier_schedule=((dec("0"), dec("0.001"), dec("0.001")),
                                   (dec("1000000"), dec("0.0002"), dec("0.0004"))))
    assert fees.fee(dec("10000"), False, volume_30d=dec("0")) == dec("10")
    assert fees.fee(dec("10000"), False, volume_30d=dec("2000000")) == dec("4")


def test_the_thirty_percent_review_heuristic():
    ok, msg = CostModel.review_check(0.40, 0.35)
    assert not ok and "only 12.5%" in msg
    ok, _ = CostModel.review_check(0.40, 0.20)
    assert ok


# -------------------------------------------------------- trial registry


def test_a_backtest_without_a_registry_does_not_run():
    from tradesys.research.backtest import Backtester

    with pytest.raises(RegistryRequired):
        Backtester(pipeline=None, adapter=None, registry=None)


def test_abandoned_runs_still_count():
    """A run killed after five minutes is a trial: it informed the search."""
    reg = TrialRegistry()
    a = reg.start("carry", "hash", {}, "2024-01", "2024-06")
    reg.finish(a, sharpe=1.2)
    b = reg.start("carry", "hash", {"entry_z": 2}, "2024-01", "2024-06")
    reg.abandon(b)
    assert reg.count("carry") == 2


def test_errored_runs_still_count():
    reg = TrialRegistry()
    with pytest.raises(ZeroDivisionError):
        with reg.trial("carry", "h", {}, "a", "b"):
            1 / 0
    assert reg.count("carry") == 1
    assert reg.get(1).outcome == "error"


def test_holdout_reuse_is_visible():
    """Two reads for one strategy is a process failure, invisible unless logged."""
    reg = TrialRegistry()
    reg.record_holdout_access("carry", "sam", "final go/no-go")
    assert not reg.holdout_reused("carry")
    reg.record_holdout_access("carry", "sam", "just one more look")
    assert reg.holdout_reused("carry")


# ----------------------------------------------------------- validation


def test_expected_max_sharpe_grows_with_trials():
    """The best of N is high by construction, even when nothing works."""
    assert expected_max_sharpe(1000, 1.0) > expected_max_sharpe(10, 1.0) > 0


def test_deflated_sharpe_collapses_under_many_trials():
    """The same observed Sharpe means very different things at 1 and 500 trials."""
    one = deflated_sharpe(0.15, 500, 1, 0.01)
    many = deflated_sharpe(0.15, 500, 500, 0.01)
    assert one > 0.99
    assert many < 0.05
    assert one > many


def test_negative_skew_is_penalised():
    """Carry and market making earn steadily and lose suddenly.

    Tested above SR0 (about 0.19 here), which is the only regime where the
    question arises: below it the strategy has already failed regardless of
    its tails, and the penalty term correctly stops mattering.
    """
    symmetric = deflated_sharpe(0.30, 500, 20, 0.01, skew=0.0, kurtosis=3.0)
    fat_left = deflated_sharpe(0.30, 500, 20, 0.01, skew=-1.5, kurtosis=8.0)
    assert fat_left < symmetric


def test_below_the_null_maximum_the_tails_stop_mattering():
    """A documented property, asserted so nobody "fixes" the sign later."""
    assert expected_max_sharpe(20, 0.01) > 0.15
    below = deflated_sharpe(0.12, 500, 20, 0.01, skew=-1.5, kurtosis=8.0)
    assert below < 0.5          # fails the gate either way


def test_time_to_significance_matches_the_table():
    assert time_to_significance_years(1.5) == pytest.approx(1.71, abs=0.01)
    assert time_to_significance_years(2.0) == pytest.approx(0.96, abs=0.01)
    assert math.isinf(time_to_significance_years(0.0))


def test_ninety_days_cannot_establish_sharpe_one_point_five():
    """The correction behind SPEC section 15.1."""
    assert time_to_significance_years(1.5) > 0.25 * 4      # more than one year


def test_live_vs_backtest_gate_is_one_sided():
    bad = live_vs_backtest_z(0.2, 90, 2.0, 2000)
    good = live_vs_backtest_z(1.9, 90, 2.0, 2000)
    assert bad < -2.0
    assert good > -1.0


def test_purged_kfold_removes_overlapping_samples():
    splits = list(purged_kfold_splits(100, n_folds=5, purge=3, embargo=2))
    assert len(splits) == 5
    for train, test in splits:
        assert not set(train) & set(test)
        lo, hi = min(test), max(test)
        assert all(i < lo - 3 or i > hi + 3 + 2 - 1 for i in train)


def test_purged_kfold_without_purge_is_adjacent():
    splits = list(purged_kfold_splits(100, n_folds=5))
    train, test = splits[1]
    assert max(t for t in train if t < min(test)) == min(test) - 1


def test_monte_carlo_reports_a_worse_drawdown_than_observed():
    """The realised path was lucky in ways you cannot count on."""
    trades = [0.02] * 60 + [-0.03] * 40
    result = monte_carlo_drawdown(trades, iterations=2000)
    assert result.drawdown_p5 >= result.drawdown_median
    assert result.drawdown_p5 > 0


def test_block_bootstrap_exposes_clustered_losses():
    """Plain shuffling destroys the serial correlation that causes bad runs."""
    trades = [0.01] * 50 + [-0.02] * 25 + [0.01] * 50
    plain = monte_carlo_drawdown(trades, iterations=2000).drawdown_p5
    blocked = block_bootstrap_drawdown(trades, block=25, iterations=2000)
    assert blocked >= plain * 0.9


def test_expectancy_ci_lower_bound_gates_scaling():
    """A point estimate above zero with a lower bound below it is not an edge."""
    noisy = [0.1, -0.09, 0.11, -0.1, 0.12, -0.11] * 10
    lo, point, hi = bootstrap_expectancy_ci(noisy, iterations=2000)
    assert lo < 0 < hi
    assert point > 0                     # positive but not established

    solid = [0.05] * 60
    lo2, _, _ = bootstrap_expectancy_ci(solid, iterations=500)
    assert lo2 > 0


def test_pbo_detects_pure_noise():
    """When configurations are noise, the in-sample best ranks at random."""
    import random

    rng = random.Random(3)
    matrix = [[rng.gauss(0, 1) for _ in range(8)] for _ in range(10)]
    pbo = probability_of_backtest_overfitting(matrix, n_splits=8)
    assert 0.2 < pbo < 0.8


def test_pbo_is_low_for_a_genuinely_better_configuration():
    matrix = [[1.0] * 8] + [[0.0] * 8 for _ in range(9)]
    assert probability_of_backtest_overfitting(matrix, n_splits=8) == 0.0


def test_sharpe_annualises_on_365_days():
    """Crypto trades every day; using 252 overstates Sharpe by about 20%."""
    returns = [0.001, -0.0005, 0.002, 0.0001] * 90
    assert sharpe(returns, 365) > sharpe(returns, 252)


def test_max_drawdown():
    assert max_drawdown([100, 120, 90, 110]) == pytest.approx(0.25)
