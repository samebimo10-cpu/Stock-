"""L1 book and quality gates, L2 features and the look-ahead audit."""

from __future__ import annotations

import pytest

from tradesys.core.events import BookDelta, BookSnapshot
from tradesys.core.types import dec
from tradesys.layers.l1_data.book import LocalBook
from tradesys.layers.l1_data.quality import QualityGrade, QualityMonitor, THRESHOLDS
from tradesys.layers.l2_features import derivs, micro
from tradesys.layers.l2_features.audit import (
    LookAheadError, assert_causal, assert_respects_lag, audit_registry,
)
from tradesys.layers.l2_features.registry import REGISTRY, FeatureRegistry, feature
from tradesys.adapters.binance import BookSequencer


def book():
    b = LocalBook("BTCUSDT")
    b.apply_snapshot(BookSnapshot(
        bids=((dec("100"), dec("3")), (dec("99"), dec("5"))),
        asks=((dec("101"), dec("1")), (dec("102"), dec("4"))),
        last_update_id=1,
    ))
    return b


# ------------------------------------------------------------------ book


def test_microprice_leans_toward_the_thin_side():
    """Mid is wrong whenever the book is imbalanced, which is most of the time."""
    b = book()
    assert b.mid == dec("100.5")
    assert b.microprice() == dec("100.75")       # more size on the bid, so it leans up


def test_walk_returns_none_when_the_book_is_too_thin():
    assert book().walk("buy", dec("99")) is None


def test_walk_averages_across_levels():
    filled, avg = book().walk("buy", dec("3"))
    assert filled == dec("3")
    assert dec("101") < avg < dec("102")


def test_delta_with_zero_quantity_deletes_a_level():
    b = book()
    b.apply_delta(BookDelta(bids=((dec("100"), dec("0")),), asks=(), first_update_id=2, final_update_id=2))
    assert b.best_bid == dec("99")


def test_crossed_book_is_detected():
    b = LocalBook("X")
    b.apply_snapshot(BookSnapshot(bids=((dec("101"), dec("1")),), asks=((dec("100"), dec("1")),),
                                  last_update_id=1))
    assert b.is_crossed


def test_depth_within_bps():
    """Liquidity reachable without moving the price more than we will accept."""
    bid_qty, ask_qty = book().depth_within_bps(100)     # +/- 1% of 100.5 -> [99.5, 101.5]
    assert bid_qty == dec("3")                          # 99 falls outside the band
    assert ask_qty == dec("1")                          # 102 falls outside the band
    wide_bid, wide_ask = book().depth_within_bps(300)   # +/- 3% -> everything
    assert wide_bid == dec("8") and wide_ask == dec("5")


# -------------------------------------------------------- sequence gaps


def test_sequence_gap_forces_a_resync():
    """A gap discards the book. Patching over it is how you trade a reconnection."""
    seq = BookSequencer()
    seq.reset_from_snapshot(100)
    assert seq.accept(101, 102)
    assert not seq.accept(200, 201)
    assert seq.gap_count == 1
    assert seq.resync_required


def test_stale_deltas_are_dropped_without_counting_as_gaps():
    seq = BookSequencer()
    seq.reset_from_snapshot(100)
    assert not seq.accept(95, 99)
    assert seq.gap_count == 0
    assert not seq.resync_required


# ------------------------------------------------------- quality gates


def test_thresholds_match_the_specification():
    assert THRESHOLDS["clock_drift_ms"].grade(5.0) == QualityGrade.GREEN
    assert THRESHOLDS["clock_drift_ms"].grade(25.0) == QualityGrade.AMBER
    assert THRESHOLDS["clock_drift_ms"].grade(60.0) == QualityGrade.RED


def test_a_red_day_is_excluded_from_research():
    q = QualityMonitor("binance", "depth")
    for _ in range(10):
        q.observe_gap(5.0)
    report = q.close_day("2026-09-14")
    assert report.grade == QualityGrade.RED
    assert not report.usable_for_research


def test_three_amber_days_escalate_to_red():
    """Catches the degradation that never quite trips a threshold."""
    q = QualityMonitor("binance", "depth", amber_escalation_days=3)
    grades = []
    for day in range(3):
        q.observe_gap(0.1)                      # 1 gap: amber, never red on its own
        grades.append(q.close_day(f"day{day}").grade)
    assert grades[0] == QualityGrade.AMBER
    assert grades[2] == QualityGrade.RED


def test_a_good_day_resets_the_amber_streak():
    q = QualityMonitor("binance", "depth", amber_escalation_days=3)
    q.observe_gap(0.1)
    q.close_day("d1")
    q.observe(0, 1_000_000)                     # clean day
    q.close_day("d2")
    q.observe_gap(0.1)
    assert q.close_day("d3").grade == QualityGrade.AMBER


def test_the_same_measurements_drive_the_kill_switch():
    """A red condition read live is a reason to stop trading right now."""
    q = QualityMonitor("binance", "depth")
    q.observe(0, 1_000_000)
    q.observe_clock_drift(200.0)
    assert "clock_drift_ms" in q.live_kill_conditions()


# ---------------------------------------------------------- look-ahead


def test_full_sample_normalisation_is_caught():
    """The classic killer: a statistic computed over the whole column."""
    def leaky(series):
        mean = sum(series) / len(series)
        return [x - mean for x in series]

    with pytest.raises(LookAheadError, match="reads beyond its own timestamp"):
        assert_causal(leaky, [1, 2, 3, 9], name="full_sample_demean")


def test_expanding_statistics_are_causal():
    def expanding(series):
        return [x - sum(series[:i + 1]) / (i + 1) for i, x in enumerate(series)]

    assert_causal(expanding, [1, 2, 3, 9], name="expanding_demean")


def test_shift_minus_one_is_caught():
    """Using tomorrow's value at today's timestamp."""
    def peek(series):
        return [series[min(i + 1, len(series) - 1)] for i in range(len(series))]

    with pytest.raises(LookAheadError):
        assert_causal(peek, [1, 2, 3, 4], name="shift_minus_one")


def test_lag_violation_is_caught():
    with pytest.raises(LookAheadError, match="declares lag=1"):
        assert_respects_lag(lambda w: w[-1], [1, 2, 3], lag=1, name="reads_current_bar")


def test_a_properly_lagged_feature_passes():
    assert_respects_lag(lambda w: w[-2], [1, 2, 3], lag=1)


def _audit_sample(name: str):
    """A sample long enough and varied enough to actually exercise the feature.

    ``[1, 2, 3, 4]`` was enough when nothing declared a lag. It is not enough
    now: a feature with a 32-point lookback returns None on it, the audit
    compares None to None, and passes without having checked anything. An audit
    that cannot fail is the thing this repository keeps refusing to ship.
    """
    from tradesys.core.types import dec

    if name in ("ewmac", "breakout_position", "downside_volatility", "atr",
                "realised_volatility"):
        # A trending series with real variation: a flat or perfectly linear one
        # makes several of these return None, which audits nothing.
        return [dec(str(100 + i * 0.7 + (3 if i % 5 == 0 else -2))) for i in range(48)]
    if name == "cascade_pressure":
        return [(dec("5"), "sell"), (dec("3"), "sell")]
    return [dec(1), dec(2), dec(3), dec(4)]


def test_every_registered_feature_is_audited():
    """A feature nobody wrote a sample for is a feature nobody checked."""
    samples = {name: _audit_sample(name) for name in REGISTRY.names()}
    assert audit_registry(REGISTRY, samples) == []


def test_the_audit_catches_a_trend_feature_that_overstates_its_lag():
    """The trend features declare lag=0 because they read a live price series.

    The first draft declared 1, and the audit caught it. This pins that the
    audit really does cover them, rather than skipping them because lag=0 makes
    the lag check a no-op.
    """
    from tradesys.layers.l2_features import trend

    sample = _audit_sample("ewmac")
    # Claiming lag=1 is a claim not to read the latest price. It does.
    with pytest.raises(LookAheadError, match="declares lag=1"):
        assert_respects_lag(trend.ewmac, sample, lag=1, name="ewmac")


# ------------------------------------------------------------- features


def test_funding_annualises_over_three_settlements_a_day():
    """0.01% per 8h is about 10.95% a year. That is the headline, not the strategy."""
    assert derivs.annualised_funding(dec("0.0001"), 8) == dec("0.10950")


def test_funding_zscore_refuses_a_short_sample():
    """A missing feature beats a confident estimate built on eight points."""
    assert derivs.funding_zscore([dec("0.0001")] * 29) is None
    assert derivs.funding_zscore([dec("0.0001")] * 29 + [dec("0.0005")]) is not None


def test_imbalance_is_bounded():
    for depth in (1, 5, 20):
        v = micro.book_imbalance(book().bids(), book().asks(), depth)
        assert dec("-1") <= v <= dec("1")


def test_missing_inputs_yield_none_never_a_default():
    assert micro.microprice([], []) is None
    assert micro.realised_volatility([dec("100")]) is None
    assert derivs.annualised_basis_bps(dec("0"), dec("100")) is None


def test_feature_versions_change_when_the_code_changes():
    reg = FeatureRegistry()

    @feature("demo", registry=reg)
    def _v1(values):
        return values[-1]

    first = reg.get("demo").version

    reg2 = FeatureRegistry()

    @feature("demo", registry=reg2)
    def _v2(values):
        return values[-1] * 2       # different source, so a different version

    assert reg2.get("demo").version != first


def test_reregistering_with_different_code_is_refused():
    """Changing a computation must not silently change history."""
    reg = FeatureRegistry()

    @feature("dup", registry=reg)
    def _a(values):
        return values[-1]

    with pytest.raises(ValueError, match="already registered"):
        @feature("dup", registry=reg)
        def _b(values):
            return values[-1] + 1
