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

from typing import List, Tuple

from .adapters.sim import SimAdapter
from .core.events import BookSnapshot, FeeSchedule, Funding, MarketEvent, SymbolFilter
from .core.types import Decimal as Dec, dec
from .layers.l3_strategy.base import StrategyState
from .layers.l3_strategy.funding_carry import FundingCarry, FundingCarryParams
from .layers.l5_risk.limits import LimitRegister
from .layers.l5_risk.service import RiskService
from .layers.l5_risk.state import PortfolioState
from .layers.l6_execution.executor import Executor
from .pipeline import DecisionRecorder, Pipeline

__all__ = ["build_events", "build_pipeline", "default_limits", "START", "FUNDING_INTERVAL_NS"]

START = 1_700_000_000_000_000_000
FUNDING_INTERVAL_NS = 8 * 3600 * 1_000_000_000

SYMBOL = "BTCUSDT"
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


def build_events(periods: int = 45, spike_after: int = 40,
                 quiet_rate: str = "0.0001", spike_rate: str = "0.0009") -> List[MarketEvent]:
    """A deterministic session of book snapshots and funding settlements.

    The funding z-score needs thirty observations *with some variance* before
    it exists at all, so the quiet stretch is part of what is being exercised
    rather than padding: the strategy must cope with a feature that is simply
    absent, and it does that explicitly rather than by imputing a value.
    """
    events: List[MarketEvent] = []
    ts = START
    for i in range(periods):
        price = dec("60000") + dec(i)
        events.append(MarketEvent(
            correlation_id=f"corr-book-{i}", emitted_at=ts, source="demo",
            venue="sim", symbol=SYMBOL, kind="book_snapshot",
            exchange_ts=ts, local_recv_ts=ts, sequence=i,
            payload=BookSnapshot(bids=((price, dec("5")),),
                                 asks=((price + dec("1"), dec("5")),),
                                 last_update_id=i),
        ))
        rate = dec(quiet_rate) if i < spike_after else dec(spike_rate)
        events.append(MarketEvent(
            correlation_id=f"corr-fund-{i}", emitted_at=ts + 1, source="demo",
            venue="sim", symbol=SYMBOL, kind="funding",
            exchange_ts=ts + 1, local_recv_ts=ts + 1,
            payload=Funding(rate=rate, interval_hours=8,
                            next_settlement=ts + FUNDING_INTERVAL_NS),
        ))
        ts += FUNDING_INTERVAL_NS
    return events


def build_pipeline(base_notional: str = "1000",
                   params: FundingCarryParams = None) -> Tuple[Pipeline, SimAdapter, DecisionRecorder]:
    """Wire the full stack against the simulator.

    The same wiring a live session uses; only the adapter differs.
    """
    adapter = SimAdapter(filters=FILTERS,
                         fees=FeeSchedule("sim", dec("0.0002"), dec("0.0005")))
    adapter.set_book(SYMBOL, [("60000", "5")], [("60001", "5")])
    adapter.set_balance("USDT", "100000")

    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("2000")
    state.mark()

    risk = RiskService(default_limits(), state)
    executor = Executor(adapter, FILTERS, clock=lambda: adapter.now)

    strategy = FundingCarry(
        params=params or FundingCarryParams(base_notional=dec(base_notional))
    )
    strategy.health.state = StrategyState.PAPER

    recorder = DecisionRecorder()
    return Pipeline([strategy], risk, executor, FILTERS, recorder=recorder), adapter, recorder
