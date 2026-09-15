"""Scenarios that exercise the trend and dislocation strategies.

Separate from :mod:`tradesys.demo`, which owns the carry scenario, because the
shapes are genuinely different: carry needs funding prints over many intervals,
trend needs a price path with a real move in it, and the cascade needs a
liquidation burst. Squeezing all three into one generator would produce a
scenario that exercises none of them properly.

**These are synthetic, and synthetic data validates nothing.** They exist to
prove the system does what the strategy specification says it does - that a
trend entry happens when the trend appears, that the stop fires, that a cascade
is faded only after it decelerates. They are the software equivalent of a bench
test. Whether the edge is real is a question for `tradesys validate` against
years of archived market data, and the harness reports INCONCLUSIVE until it
has them.
"""

from __future__ import annotations

from typing import Dict, List, Optional, Sequence, Tuple

from .adapters.sim import SimAdapter
from .core.events import (
    BookSnapshot, FeeSchedule, Funding, Liquidation, MarketEvent, SymbolFilter, Trade,
)
from .core.types import Decimal as Dec, dec
from .costs import CostModel, FeeModel
from .layers.l3_strategy.base import StrategyState
from .layers.l3_strategy.cascade import CascadeParams, LiquidationReversion
from .layers.l3_strategy.trend import TimeSeriesMomentum, TrendParams
from .layers.l5_risk.service import RiskService
from .layers.l5_risk.state import PortfolioState
from .layers.l6_execution.executor import Executor
from .pipeline import DecisionRecorder, Pipeline

__all__ = ["trend_events", "cascade_events", "dispersion_events", "carry_events",
           "build_carry_pipeline",
           "build_trend_pipeline", "build_cascade_pipeline",
           "build_dispersion_pipeline", "VENUE", "VENUE_B", "SYMBOL",
           "BAR_NS", "FUNDING_NS", "START"]

START = 1_700_000_000_000_000_000
#: One "bar" per hour. Short enough that a multi-week trend fits in a scenario
#: of a few hundred events, long enough that the features are not reading
#: microstructure noise as trend.
BAR_NS = 3600 * 1_000_000_000
VENUE = "sim-perp"
#: A second perpetual venue. Dispersion is a two-venue trade by definition:
#: the edge is the difference between what two venues pay, so a single-venue
#: scenario cannot exercise it at all.
VENUE_B = "sim-perp-b"
SYMBOL = "BTCUSDT"
FUNDING_NS = 8 * 3600 * 1_000_000_000
FILTERS = {SYMBOL: SymbolFilter(SYMBOL, dec("0.01"), dec("0.00001"), dec("10"))}


def _noise(state: int) -> Tuple[Dec, int]:
    """Deterministic jitter, so a scenario is identical on every machine."""
    state = (1103515245 * state + 12345) % 2147483648
    return dec(state % 200 - 100) / dec(100), state


def _bar(ts: int, index: int, price: Dec, venue: str = VENUE,
         depth: str = "50") -> List[MarketEvent]:
    """One book plus the trades that make a resting order fillable.

    The trades are not decoration. Without public volume at the price, a
    resting order never fills - which the simulator models correctly and which
    made every maker strategy look unfillable until it did.
    """
    events = [MarketEvent(
        correlation_id=f"c-book-{index}", emitted_at=ts, source="scenario",
        venue=venue, symbol=SYMBOL, kind="book_snapshot",
        exchange_ts=ts, local_recv_ts=ts, sequence=index,
        payload=BookSnapshot(bids=((price, dec(depth)),),
                             asks=((price + dec("1"), dec(depth)),),
                             last_update_id=index),
    )]
    for j in range(4):
        buy = j % 2 == 0
        events.append(MarketEvent(
            correlation_id=f"c-trade-{index}-{j}", emitted_at=ts + 1 + j,
            source="scenario", venue=venue, symbol=SYMBOL, kind="trade",
            exchange_ts=ts + 1 + j, local_recv_ts=ts + 1 + j,
            payload=Trade(price=price + (dec("1") if buy else dec("0")),
                          quantity=dec("5"),
                          aggressor_side="buy" if buy else "sell",
                          trade_id=index * 10 + j),
        ))
    return events


def trend_events(flat_bars: int = 60, trend_bars: int = 90,
                 reversal_bars: int = 40, start_price: str = "60000",
                 drift_per_bar: str = "90") -> List[MarketEvent]:
    """Chop, then a sustained rally, then a sharp reversal.

    All three phases matter and the third is the one that decides whether the
    strategy is safe: a trend strategy that cannot be got out of is not a trend
    strategy. The reversal is deliberately faster than the rally, because real
    ones are.
    """
    events: List[MarketEvent] = []
    ts, index, state = START, 0, 7
    price = dec(start_price)

    for _ in range(flat_bars):
        jitter, state = _noise(state)
        # Chop: no direction, real movement. The strategy must decline to
        # trade here, and the vetoes counter is how we check that it did.
        price = dec(start_price) + jitter * dec("60")
        events.extend(_bar(ts, index, price))
        ts += BAR_NS
        index += 1

    for _ in range(trend_bars):
        jitter, state = _noise(state)
        price = price + dec(drift_per_bar) + jitter * dec("40")
        events.extend(_bar(ts, index, price))
        ts += BAR_NS
        index += 1

    for _ in range(reversal_bars):
        jitter, state = _noise(state)
        # Down twice as fast as it went up.
        price = price - dec(drift_per_bar) * dec(2) + jitter * dec("40")
        events.extend(_bar(ts, index, price))
        ts += BAR_NS
        index += 1

    return events


def cascade_events(calm_bars: int = 30, cascade_bars: int = 6,
                   recovery_bars: int = 30, start_price: str = "60000",
                   drop_per_bar: str = "600", liquidation_size: str = "40",
                   recover_fraction: str = "0.6") -> List[MarketEvent]:
    """Calm, a liquidation cascade, then a partial recovery.

    Partial rather than complete, on purpose. A scenario where price returns
    exactly to where it started rewards a strategy that targets a full
    reversion, and the strategy deliberately targets half - because the last
    third of a reversion is slow and thin and is where the edge is worst.
    A scenario that does not model that would validate the wrong exit rule.
    """
    events: List[MarketEvent] = []
    ts, index, state = START, 0, 11
    price = dec(start_price)

    for _ in range(calm_bars):
        jitter, state = _noise(state)
        price = dec(start_price) + jitter * dec("30")
        events.extend(_bar(ts, index, price))
        ts += BAR_NS
        index += 1

    # A cascade happens in minutes, not hours. Modelling it at the hourly
    # spacing the rest of the scenario uses put each liquidation outside the
    # next one's measurement window, so the forced flow never accumulated and
    # the pressure reading never rose above a single bar's worth. The
    # phenomenon has a time scale and a scenario has to use it.
    bottom = price
    step_ns = 30 * 1_000_000_000
    for step in range(cascade_bars):
        price = price - dec(drop_per_bar)
        bottom = min(bottom, price)
        events.extend(_bar(ts, index, price, depth="8"))
        # Forced selling, decaying as the cascade exhausts itself. The decay is
        # the signal: the strategy must wait for it, and a scenario with
        # constant pressure would never let it enter.
        size = dec(liquidation_size) / dec(2 ** step)
        events.append(MarketEvent(
            correlation_id=f"c-liq-{index}", emitted_at=ts + 10, source="scenario",
            venue=VENUE, symbol=SYMBOL, kind="liquidation",
            exchange_ts=ts + 10, local_recv_ts=ts + 10,
            payload=Liquidation(price=price, quantity=size, side="sell"),
        ))
        ts += step_ns
        index += 1

    target = bottom + (dec(start_price) - bottom) * dec(recover_fraction)
    # Front-loaded, on a square-root path rather than a straight line. A real
    # post-cascade bounce does most of its work in the first minutes - the
    # displaced liquidity comes back all at once - and then drifts. A linear
    # recovery is not merely less realistic: it retraces so slowly that no
    # confirmation-based entry can ever trigger inside its own patience
    # window, which made the strategy look broken when the scenario was.
    for step in range(recovery_bars):
        jitter, state = _noise(state)
        fraction = dec(str(((step + 1) / recovery_bars) ** 0.5))
        price = bottom + (target - bottom) * fraction + jitter * dec("20")
        events.extend(_bar(ts, index, price))
        ts += BAR_NS
        index += 1

    return events


# --------------------------------------------------------------------------
# Wiring
# --------------------------------------------------------------------------


def _cost_model(multiple: Dec = dec(1)) -> CostModel:
    return CostModel(
        fees=FeeModel(maker_rate=dec("0.0002") * multiple,
                      taker_rate=dec("0.0005") * multiple),
        adverse_selection_bps=dec("2") * multiple,
        impact_y=dec(1),
    )


def _venue(name: str, with_costs: bool) -> SimAdapter:
    adapter = SimAdapter(
        filters=FILTERS,
        order_latency_ns=25_000_000 if with_costs else 0,
        fill_latency_ns=15_000_000 if with_costs else 0,
        fees=FeeSchedule(name, dec("0.0002"), dec("0.0005")) if with_costs
        else FeeSchedule(name, dec("0"), dec("0")),
        cost_model=_cost_model() if with_costs else None,
        daily_volume={SYMBOL: dec("500")},
        daily_vol_bps=dec("300"),
    )
    adapter.name = name
    adapter.set_book(SYMBOL, [("60000", "50")], [("60001", "50")])
    adapter.set_balance("USDT", "100000")
    return adapter


def _stack(strategy, with_costs: bool):
    from .config import load_limits

    adapters = {VENUE: _venue(VENUE, with_costs)}
    adapter = adapters[VENUE]
    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("2000")
    state.mark()
    risk = RiskService(load_limits(), state)
    executor = Executor(adapters, FILTERS, clock=lambda: adapter.now)
    strategy.health.state = StrategyState.PAPER
    recorder = DecisionRecorder()
    pipeline = Pipeline([strategy], risk, executor, FILTERS, recorder=recorder,
                        # Single-leg strategies, so the leg machinery is idle -
                        # but the taker fallback is not: a maker-preferred entry
                        # that never fills is the failure mode ADR 0004 found,
                        # and four bars is long enough to be patient without
                        # being asleep.
                        leg_timeout_ns=8 * BAR_NS,
                        taker_fallback_ns=4 * BAR_NS)
    return pipeline, adapters, recorder


def build_trend_pipeline(with_costs: bool = True,
                         params: Optional[TrendParams] = None,
                         budget: str = "20000"):
    strategy = TimeSeriesMomentum(VENUE, (SYMBOL,), budget=dec(budget),
                                  params=params,
                                  signal_ttl_ns=4 * BAR_NS)
    return _stack(strategy, with_costs)


def build_cascade_pipeline(with_costs: bool = True,
                           params: Optional[CascadeParams] = None,
                           base_notional: str = "1500"):
    strategy = LiquidationReversion(
        VENUE, (SYMBOL,),
        params=params or CascadeParams(base_notional=dec(base_notional),
                                       max_hold_ns=12 * BAR_NS),
        signal_ttl_ns=2 * BAR_NS)
    return _stack(strategy, with_costs)


def dispersion_events(intervals: int = 40, spread_from: int = 12,
                      spread_until: int = 30,
                      base_rate: str = "0.0001",
                      wide_rate: str = "0.0011",
                      start_price: str = "60000") -> List[MarketEvent]:
    """Two venues quoting the same perpetual, with funding that diverges and
    converges.

    Both venues print funding every interval. For a stretch in the middle,
    venue A's rate blows out while venue B's stays at baseline - which is what
    dispersion is: not high funding, but *different* funding, because each
    venue clears its own order flow and its own crowd.

    Price moves on both venues together, and by design it moves **while the
    dispersion is open**. That is the test that matters: the whole claim for
    this strategy over the hedged carry is that a trending market does not
    break it, because both legs are the same instrument and neither has to
    chase the other.
    """
    events: List[MarketEvent] = []
    ts, index, state = START, 0, 23
    price = dec(start_price)
    #: Bars per funding interval. One bar per interval was the first version,
    #: and it made the taker fallback unobservable: the fallback deadline can
    #: only fire on an event, so with events eight hours apart the second leg
    #: crossed eight hours late and the "cost" that measured was price drift,
    #: not spread. A scenario whose resolution is coarser than the mechanism it
    #: is testing measures the scenario.
    bars = 8

    for interval in range(intervals):
        widened = spread_from <= interval < spread_until

        for step in range(bars):
            jitter, state = _noise(state)
            # A steady uptrend through the whole scenario. This is the
            # condition that broke the hedged carry (ADR 0004) and the
            # condition this strategy claims to survive.
            price = price + dec("15") + jitter * dec("8")
            for venue in (VENUE, VENUE_B):
                events.extend(_bar(ts + step * BAR_NS, index, price, venue=venue))
            index += 1

        rate_a = dec(wide_rate) if widened else dec(base_rate)
        rate_b = dec(base_rate)
        settle = ts + (bars - 1) * BAR_NS + 20
        for venue, rate in ((VENUE, rate_a), (VENUE_B, rate_b)):
            events.append(MarketEvent(
                correlation_id=f"c-fund-{venue}-{index}", emitted_at=settle,
                source="scenario", venue=venue, symbol=SYMBOL, kind="funding",
                exchange_ts=settle, local_recv_ts=settle,
                payload=Funding(rate=rate, interval_hours=8,
                                next_settlement=settle + FUNDING_NS),
            ))
        ts += FUNDING_NS
    return events


def build_dispersion_pipeline(with_costs: bool = True, params=None,
                              base_notional: str = "1000",
                              fallback_bars: int = 1, timeout_bars: int = 4):
    from .config import load_limits
    from .layers.l3_strategy.funding_dispersion import (
        DispersionParams, FundingDispersion,
    )

    adapters = {VENUE: _venue(VENUE, with_costs), VENUE_B: _venue(VENUE_B, with_costs)}
    adapter = adapters[VENUE]
    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("2000")
    state.mark()
    risk = RiskService(load_limits(), state)
    executor = Executor(adapters, FILTERS, clock=lambda: adapter.now)
    strategy = FundingDispersion(
        SYMBOL, VENUE, VENUE_B,
        params=params or DispersionParams(base_notional=dec(base_notional)),
        interval_ns=FUNDING_NS, signal_ttl_ns=FUNDING_NS)
    strategy.health.state = StrategyState.PAPER
    recorder = DecisionRecorder()
    # One hour to rest, four to complete. Not one funding interval: a two-leg
    # trade's second leg has to be on within minutes of the first, because the
    # cost of arriving late is price drift rather than spread, and drift over
    # eight hours dwarfs any spread. Measured at an eight-hour fallback the
    # strategy spent 64% of gross on costs; the spread was never the problem.
    pipeline = Pipeline([strategy], risk, executor, FILTERS, recorder=recorder,
                        # The timeout must exceed the fallback, or the group is
                        # unwound before the fallback can fire and the run
                        # measures the unwinder rather than the execution.
                        leg_timeout_ns=max(timeout_bars, fallback_bars + 2) * BAR_NS,
                        taker_fallback_ns=fallback_bars * BAR_NS)
    return pipeline, adapters, recorder


# --------------------------------------------------------------------------
# Re-testing the carry strategy at a resolution that can see its execution
# --------------------------------------------------------------------------


def carry_events(intervals: int = 70, spike_after: int = 36, spike_until: int = 50,
                 quiet_rate: str = "0.0001", spike_rate: str = "0.0009",
                 start_price: str = "60000", bars: int = 8) -> List[MarketEvent]:
    """The hedged-carry scenario, with bars inside each funding interval.

    The original carry demo emits one book per eight-hour funding interval.
    That is fine for testing the funding logic and wrong for testing the
    execution: a taker fallback can only fire on an event, so with events eight
    hours apart the hedge leg crossed eight hours late and what got measured as
    "cost" was mostly price drift over those hours.

    The quiet stretch before the spike is long on purpose: the funding z-score
    refuses to report on fewer than thirty observations, so a scenario that
    spikes at interval twelve produces no signal at all and looks like a broken
    strategy rather than a short scenario.

    Funding rises and then falls again, so the strategy completes real round
    trips. A scenario that enters and never exits measures entry costs only,
    which flatters the ratio by about half.

    This exists to re-measure the strategy's 69% cost ratio at a resolution
    that can distinguish spread from drift.
    """
    events: List[MarketEvent] = []
    ts, index, state = START, 0, 31
    price = dec(start_price)

    for interval in range(intervals):
        elevated = spike_after <= interval < spike_until
        for step in range(bars):
            jitter, state = _noise(state)
            # Funding is elevated because longs are crowded, and longs are
            # crowded while price rises. The correlation is the strategy's
            # whole problem and the scenario has to carry it.
            price = price + (dec("4") if elevated else dec("-1")) + jitter * dec("6")
            for venue, offset in ((VENUE, dec(0)), (VENUE_B, dec("-2"))):
                events.extend(_bar(ts + step * BAR_NS, index, price + offset,
                                   venue=venue))
            index += 1

        settle = ts + (bars - 1) * BAR_NS + 20
        events.append(MarketEvent(
            correlation_id=f"c-fund-{index}", emitted_at=settle, source="scenario",
            venue=VENUE, symbol=SYMBOL, kind="funding",
            exchange_ts=settle, local_recv_ts=settle,
            payload=Funding(rate=dec(spike_rate) if elevated else dec(quiet_rate),
                            interval_hours=8, next_settlement=settle + FUNDING_NS),
        ))
        ts += FUNDING_NS
    return events


def build_carry_pipeline(with_costs: bool = True,
                         fallback_bars: int = 1, timeout_bars: int = 4,
                         base_notional: str = "1000"):
    """The carry strategy, wired like the others: fast second leg, fine bars."""
    from .config import load_limits
    from .layers.l3_strategy.funding_carry import FundingCarry, FundingCarryParams

    adapters = {VENUE: _venue(VENUE, with_costs), VENUE_B: _venue(VENUE_B, with_costs)}
    adapter = adapters[VENUE]
    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("2000")
    state.mark()
    risk = RiskService(load_limits(), state)
    executor = Executor(adapters, FILTERS, clock=lambda: adapter.now)
    strategy = FundingCarry(params=FundingCarryParams(
        base_notional=dec(base_notional), perp_venue=VENUE, spot_venue=VENUE_B))
    strategy.health.state = StrategyState.PAPER
    recorder = DecisionRecorder()
    pipeline = Pipeline([strategy], risk, executor, FILTERS, recorder=recorder,
                        leg_timeout_ns=timeout_bars * BAR_NS,
                        taker_fallback_ns=fallback_bars * BAR_NS)
    return pipeline, adapters, recorder
