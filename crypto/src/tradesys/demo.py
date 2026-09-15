"""A runnable demonstration scenario.

Lives in the package rather than in the tests because both the CLI and the
test suite need it, and a CLI command that imports from ``tests/`` breaks the
moment somebody installs the package without them.

The scenario is deliberately small and deterministic: forty quiet funding
periods followed by a spike. It exercises the whole path - L1 events through
features, strategy, netting, risk and execution - and it demonstrates the one
behaviour that matters most about this strategy, which is that it declines to
enter when funding cannot cover the round trip.
"""

from __future__ import annotations

import asyncio
from dataclasses import replace
from typing import Any, Dict, List, Mapping, Optional, Tuple

from .adapters.sim import SimAdapter
from .core.events import (
    BookSnapshot, FeeSchedule, Funding, MarketEvent, SymbolFilter, Trade,
)
from .core.types import Decimal as Dec, dec
from .costs import CostModel, FeeModel
from .layers.l3_strategy.base import StrategyState
from .layers.l3_strategy.funding_carry import FundingCarry, FundingCarryParams
from .layers.l5_risk.limits import LimitRegister
from .layers.l5_risk.service import RiskService
from .layers.l5_risk.state import PortfolioState
from .layers.l6_execution.executor import Executor
from .pipeline import DecisionRecorder, Pipeline

__all__ = ["build_events", "build_cycling_events", "build_pipeline",
           "default_limits", "make_backtest_runner", "START", "FUNDING_INTERVAL_NS"]

START = 1_700_000_000_000_000_000
FUNDING_INTERVAL_NS = 8 * 3600 * 1_000_000_000

SYMBOL = "BTCUSDT"
#: Two venues, because a basis trade is two legs on two venues. Spot and
#: perpetual are separate APIs at every real exchange, and a demo that pretends
#: otherwise cannot exercise the hedge or the unwinder.
PERP_VENUE = "sim-perp"
SPOT_VENUE = "sim-spot"
FILTERS = {SYMBOL: SymbolFilter(SYMBOL, dec("0.01"), dec("0.00001"), dec("10"))}


def default_limits() -> LimitRegister:
    """Load ``risk/limits.yaml`` from the repository, or fall back to defaults.

    The fallback matters for an installed package, where the YAML file is not
    on disk. It carries the same values, so a demo run behaves identically
    either way.
    """
    from pathlib import Path

    candidate = Path(__file__).resolve().parents[2] / "risk" / "limits.yaml"
    if candidate.exists():
        return LimitRegister.from_yaml(candidate)
    return LimitRegister.from_mapping(_FALLBACK_LIMITS)


_FALLBACK_LIMITS = {
    "schema_version": 1,
    "equity_definition": "cash_plus_unrealised_plus_accrued",
    "limits": {
        "per_trade_risk": {"value": 0.02, "action": "reject"},
        "daily_loss": {"value": 0.03, "action": "flatten_and_halt"},
        "weekly_loss": {"value": 0.07, "action": "flatten_and_halt"},
        "drawdown_amber": {"value": 0.06, "action": "alert"},
        "drawdown_soft": {"value": 0.08, "action": "halve_allocations"},
        "drawdown_hard": {"value": 0.12, "action": "full_stop"},
        "gross_exposure": {"value": 3.0, "action": "reject_new"},
        "asset_concentration": {"value": 0.25, "action": "reject"},
        "venue_concentration": {"value": 0.40, "action": "alert_and_sweep"},
        "liquidation_distance": {"value": 0.25, "action": "auto_deleverage"},
        "single_order_equity_frac": {"value": 0.02, "action": "reject"},
        "single_order_median_mult": {"value": 5.0, "action": "reject"},
        "order_rate": {"value": 0.7, "action": "throttle"},
        "consecutive_rejects": {"value": 5, "action": "disable_strategy"},
        "backtest_divergence_z": {"value": -2.0, "action": "disable_strategy"},
        "feed_staleness_s": {"value": 30.0, "action": "reject"},
        "clock_drift_ms": {"value": 100.0, "action": "halt"},
    },
    "bounds": {
        "per_trade_risk": [0.0001, 0.05], "daily_loss": [0.005, 0.10],
        "weekly_loss": [0.01, 0.20], "drawdown_amber": [0.01, 0.20],
        "drawdown_soft": [0.02, 0.20], "drawdown_hard": [0.05, 0.25],
        "gross_exposure": [1.0, 5.0], "asset_concentration": [0.05, 1.0],
        "venue_concentration": [0.10, 1.0], "liquidation_distance": [0.05, 0.90],
        "single_order_equity_frac": [0.0001, 0.10], "single_order_median_mult": [1.0, 50.0],
        "order_rate": [0.1, 0.95], "consecutive_rejects": [1, 50],
        "backtest_divergence_z": [-5.0, -1.0], "feed_staleness_s": [1.0, 300.0],
        "clock_drift_ms": [10.0, 1000.0],
    },
}


def _emit(schedule: List[str], quiet_rate: str, spike_rate: str,
          seed: int, drift: bool, depth: str) -> List[MarketEvent]:
    """Emit one two-venue scenario from a phase schedule.

    Both scenario builders route through here. They used to have their own
    copies of this loop, and the copies drifted: one kept emitting on a single
    venue after the system became two-venue, so the perpetual's feature engine
    never saw a book and the strategy silently stopped signalling. Duplicated
    emission logic is how a fixture quietly stops matching the system.
    """
    events: List[MarketEvent] = []
    ts = START
    index = 0
    state = seed
    price = dec("60000")

    def noise() -> Dec:
        """Deterministic jitter, so events are identical on every machine."""
        nonlocal state
        state = (1103515245 * state + 12345) % 2147483648
        return dec(state % 9 - 4) / dec("100000")

    for phase in schedule:
        if drift:
            # Price and funding move together, which is the economically
            # correct correlation and the one that makes carry hard: funding
            # is elevated because longs are crowded and price is rising, and a
            # rising price is what hurts the short perpetual leg.
            price += dec(12) if phase == "elevated" else dec(-8)
        else:
            price = dec("60000") + dec(index)

        for venue, offset in ((PERP_VENUE, dec(0)), (SPOT_VENUE, dec("-2"))):
            # Spot trades below the perpetual, which is what a positive basis
            # looks like and what the funding is paying for.
            book_price = price + offset
            events.append(MarketEvent(
                correlation_id=f"corr-book-{venue}-{index}", emitted_at=ts, source="demo",
                venue=venue, symbol=SYMBOL, kind="book_snapshot",
                exchange_ts=ts, local_recv_ts=ts, sequence=index,
                payload=BookSnapshot(bids=((book_price, dec(depth)),),
                                     asks=((book_price + dec(1), dec(depth)),),
                                     last_update_id=index),
            ))

        # Public trades, so a resting order can advance in the queue. Without
        # them a maker order never fills, which is the honest outcome: nothing
        # traded where we were quoting.
        for j in range(6):
            # Buyers lift the ask, sellers hit the bid. Trading both at mid
            # would let a resting order fill against volume that never reached
            # its price.
            buy_side = j % 2 == 0
            for venue, offset in ((PERP_VENUE, dec(0)), (SPOT_VENUE, dec("-2"))):
                base = price + offset
                events.append(MarketEvent(
                    correlation_id=f"corr-trade-{venue}-{index}-{j}",
                    emitted_at=ts + 1 + j, source="demo", venue=venue,
                    symbol=SYMBOL, kind="trade",
                    exchange_ts=ts + 1 + j, local_recv_ts=ts + 1 + j,
                    payload=Trade(price=base + dec(1) if buy_side else base,
                                  quantity=dec("5"),
                                  aggressor_side="buy" if buy_side else "sell",
                                  trade_id=index * 10 + j),
                ))

        base_rate = dec(spike_rate) if phase == "elevated" else dec(quiet_rate)
        rate = base_rate + (noise() if drift else dec(0))
        events.append(MarketEvent(
            correlation_id=f"corr-fund-{index}", emitted_at=ts + 10, source="demo",
            venue=PERP_VENUE, symbol=SYMBOL, kind="funding",
            exchange_ts=ts + 10, local_recv_ts=ts + 10,
            payload=Funding(rate=rate, interval_hours=8,
                            next_settlement=ts + FUNDING_INTERVAL_NS),
        ))

        ts += FUNDING_INTERVAL_NS
        index += 1

    return events


def build_events(periods: int = 45, spike_after: int = 40,
                 quiet_rate: str = "0.0001", spike_rate: str = "0.0009") -> List[MarketEvent]:
    """A short session: a long quiet stretch, then one funding spike.

    The funding z-score needs thirty observations *with some variance* before
    it exists at all, so the quiet stretch is part of what is being exercised
    rather than padding: the strategy must cope with a feature that is simply
    absent, and it does so explicitly rather than by imputing a value.
    """
    schedule = ["calm"] * spike_after + ["elevated"] * max(0, periods - spike_after)
    return _emit(schedule, quiet_rate, spike_rate, seed=11, drift=False, depth="5")


def build_cycling_events(cycles: int = 12, warmup: int = 40, elevated: int = 5,
                         calm: int = 5, seed: int = 11) -> List[MarketEvent]:
    """A scenario with real round trips.

    :func:`build_events` produces a single entry and never exits, which makes
    every cost figure derived from it meaningless: a strategy that enters once
    and holds pays roughly half the costs it would actually pay, so the SPEC
    section 11.1 review heuristic has nothing to measure.

    This alternates elevated and calm funding so the strategy enters and exits
    repeatedly, with the price drifting against the short leg while funding is
    generous. The warm-up funding is noisy rather than constant: a constant
    series has zero variance, so its z-score is undefined and the strategy
    would never see a signal at all.
    """
    schedule: List[str] = ["calm"] * warmup
    for _ in range(cycles):
        schedule.extend(["elevated"] * elevated)
        schedule.extend(["calm"] * calm)
    return _emit(schedule, "0.0001", "0.0009", seed=seed, drift=True, depth="50")


def cost_model() -> CostModel:
    """Tier-0 economics, deliberately pessimistic.

    ``adverse_selection_bps`` is positive because it always is for a naive
    maker: you are filled preferentially when the price is about to move
    against you. An estimate of zero means the estimator is wrong, not that
    the market is being kind.
    """
    return CostModel(
        fees=FeeModel(maker_rate=dec("0.0002"), taker_rate=dec("0.0005")),
        adverse_selection_bps=dec("1.5"),
        impact_y=dec("1"),
    )


def build_pipeline(base_notional: str = "1000",
                   params: FundingCarryParams = None,
                   with_costs: bool = True,
                   cost_multiple: Dec = None,
                   taker_fallback_intervals: int = 1,
                   leg_timeout_intervals: int = 3) -> Tuple[Pipeline, Dict[str, SimAdapter], DecisionRecorder]:
    """Wire the full stack against the simulator.

    The same wiring a live session uses; only the adapter differs.

    ``with_costs=False`` builds the costless twin used by the SPEC section 11.1
    review heuristic. It is not a faster mode or a debugging convenience - it
    exists only to be compared against, and running it alone would produce
    exactly the flattering backtest the specification warns about.
    """
    multiple = cost_multiple if cost_multiple is not None else dec(1)
    model = cost_model() if with_costs else None
    if model is not None and multiple != 1:
        # Cost sensitivity (SPEC section 11.2 item 8): a strategy that dies at
        # 1.5x costs is one fee-tier change from dead.
        model = replace(model, adverse_selection_bps=model.adverse_selection_bps * multiple)

    def venue(name: str) -> SimAdapter:
        a = SimAdapter(
            filters=FILTERS,
        # A backtest left at zero latency is not modelling reality. These are
        # placeholders shaped like a Tokyo-region deployment; in a real system
        # they come from the measured distribution (SPEC section 11.1), not
        # from a guess like this one.
            order_latency_ns=25_000_000 if with_costs else 0,
            fill_latency_ns=15_000_000 if with_costs else 0,
            fees=FeeSchedule(name, dec("0.0002") * multiple, dec("0.0005") * multiple)
            if with_costs else FeeSchedule(name, dec("0"), dec("0")),
            cost_model=model,
            daily_volume={SYMBOL: dec("500")},
            daily_vol_bps=dec("300"),
        )
        a.name = name
        a.set_book(SYMBOL, [("60000", "50")], [("60001", "50")])
        a.set_balance("USDT", "100000")
        return a

    adapters = {PERP_VENUE: venue(PERP_VENUE), SPOT_VENUE: venue(SPOT_VENUE)}
    adapter = adapters[PERP_VENUE]

    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("2000")
    state.mark()

    risk = RiskService(default_limits(), state)
    executor = Executor(adapters, FILTERS, clock=lambda: adapter.now)

    strategy = FundingCarry(
        params=params or FundingCarryParams(
            base_notional=dec(base_notional),
            perp_venue=PERP_VENUE, spot_venue=SPOT_VENUE,
        )
    )
    strategy.health.state = StrategyState.PAPER

    recorder = DecisionRecorder()
    # Three funding intervals. The legs of a carry pair are not latency
    # sensitive, and a timeout shorter than the data's own cadence expires
    # every group before it can fill.
    pipeline = Pipeline([strategy], risk, executor, FILTERS, recorder=recorder,
                        leg_timeout_ns=leg_timeout_intervals * FUNDING_INTERVAL_NS,
                        # Rest, then cross. Shorter than the leg timeout, or
                        # the group breaks before the fallback can fire. How
                        # long to rest is a real trade-off: too short and every
                        # order crosses, too long and the hedge is late.
                        taker_fallback_ns=taker_fallback_intervals * FUNDING_INTERVAL_NS)
    return pipeline, adapters, recorder


def make_backtest_runner(registry, strategy_name: str = "funding_carry"):
    """Adapt the demo wiring to the signature the validation harness wants.

    The harness stays agnostic about how a backtest is built, so the same
    protocol can be run against a different engine without rewriting the
    protocol. This is the adapter for this one.

    Every call registers a trial, including every sweep configuration and every
    cost-stressed variant. That is the point: those are trials, they informed
    the search, and deflated Sharpe is only honest if they are counted.
    """
    from .research.backtest import Backtester

    def run(events, parameters: Optional[Mapping[str, Any]] = None,
            cost_multiple: float = 1.0):
        params = FundingCarryParams()
        for key, value in (parameters or {}).items():
            if hasattr(params, key):
                params = replace(params, **{key: value})
        pipeline, adapters, _ = build_pipeline(
            params=params, cost_multiple=dec(str(cost_multiple)),
        )
        bt = Backtester(pipeline, adapters, registry, strategy_name,
                        pipeline.strategies[0].parameters())
        return asyncio.run(bt.run(list(events)))

    return run
