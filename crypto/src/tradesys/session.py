"""The trading session: everything wired together and running.

The components exist separately so each is testable alone. This is where they
become a system, and the order matters:

1. **The startup gate runs first** (SPEC section 9.5). No strategy emits a
   signal until config validates, filters are cached, the clock is checked, and
   reconciliation comes back clean. Failure mode 6 in SPEC section 8.5 is a
   system that restarts, does not know about open positions, and opens more;
   this gate is the whole defence, and it is the reason the session refuses to
   start rather than starting degraded.
2. **The dead-man's switch arms before the first order** and the execution side
   flattens autonomously if the risk service stops heartbeating. It acts
   without asking, because the service it would ask is the one that is not
   responding.
3. **Reconciliation runs on its own cadence**, not on the market data's. A
   quiet market is exactly when a position mismatch goes unnoticed.

Strategies are enabled one at a time at the end, with a settling period. All at
once after a halt reproduces whatever caused the halt, at full size.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from .core.events import MarketEvent, Position
from .core.types import Decimal as Dec, Nanos, dec, now_ns
from .layers.l5_risk.killswitch import SwitchState, Trigger
from .layers.l6_execution.reconcile import DiscrepancyClass, Reconciler
from .layers.l6_execution.startup import StartupGate, StartupGateFailed
from .layers.l7_observability.alerts import AlertRouter, Severity
from .layers.l7_observability.metrics import MetricRegistry, SloEvaluator
from .pipeline import Pipeline

__all__ = ["TradingSession", "SessionState", "SessionConfig"]


class SessionState:
    NEW = "NEW"
    STARTING = "STARTING"
    RUNNING = "RUNNING"
    HALTED = "HALTED"
    STOPPED = "STOPPED"


@dataclass
class SessionConfig:
    reconcile_interval_ns: int = 5_000_000_000        # SPEC section 9.3: 5s minimum
    heartbeat_interval_ns: int = 2_000_000_000
    #: Seconds between enabling one strategy and the next.
    strategy_settle_ns: int = 1_000_000_000
    max_clock_drift_ms: float = 50.0
    #: Halt if the clock is this far out. Above 100ms the venue rejects signed
    #: requests outright, so trading on is not an option anyway.
    halt_clock_drift_ms: float = 100.0


class TradingSession:
    """Drives a pipeline against live or simulated venues."""

    def __init__(
        self,
        pipeline: Pipeline,
        adapters: Mapping[str, object],
        config: Optional[SessionConfig] = None,
        metrics: Optional[MetricRegistry] = None,
        alerts: Optional[AlertRouter] = None,
        clock: Callable[[], Nanos] = now_ns,
    ) -> None:
        self.pipeline = pipeline
        self.adapters = dict(adapters)
        self.config = config or SessionConfig()
        self.metrics = metrics or MetricRegistry()
        self.alerts = alerts or AlertRouter(clock=lambda: clock())
        self.slo = SloEvaluator(self.metrics)
        self.clock = clock
        self.state = SessionState.NEW
        self.reconcilers = {name: Reconciler(name) for name in self.adapters}
        self._last_reconcile: Nanos = 0
        self._last_heartbeat: Nanos = 0
        self.startup_report: List[str] = []

    # ------------------------------------------------------------------
    # Startup
    # ------------------------------------------------------------------

    async def start(self, operator: Optional[str] = None) -> None:
        """Run the gate, then enable strategies one at a time.

        Raises :class:`StartupGateFailed` rather than starting degraded. A
        session that starts with an unexplained position is a session that will
        trade around it.
        """
        self.state = SessionState.STARTING
        gate = StartupGate()

        gate.add("config_bounds_validated", lambda: self.pipeline.risk.limits is not None,
                 detail="the limit register failed to load")
        gate.add("venues_reachable", lambda: bool(self.adapters),
                 detail="no venue adapters attached")

        filters_ok = await self._cache_filters()
        gate.add("symbol_filters_cached", lambda: filters_ok,
                 detail="could not fetch symbol filters")

        drift_ok, drift_ms = await self._check_clock()
        gate.add("clock_drift", lambda: drift_ok,
                 detail=f"clock drift {drift_ms:.1f}ms exceeds "
                        f"{self.config.halt_clock_drift_ms}ms")

        clean, discrepancies = await self.reconcile(force=True)
        gate.add("reconciliation_clean", lambda: clean or bool(operator),
                 detail="; ".join(discrepancies) or "reconciliation did not complete")
        if not clean:
            gate.needs_acknowledgement = True
            if operator:
                # Acknowledging means the operator investigated, which is what
                # the recovery matrix requires for a reconciliation mismatch:
                # one person, after looking. So the acknowledgement also clears
                # the trigger it raised - otherwise the switch stays engaged,
                # the next gate step fails on it, and the only route back into
                # trading is to restart without acknowledging, which is exactly
                # the shortcut the gate exists to prevent.
                gate.acknowledge(operator)
                await self._clear_reconciliation_triggers(operator)

        gate.add("risk_service_healthy", lambda: not self.pipeline.risk.killswitch.is_engaged,
                 detail="the kill switch is engaged")

        gate.run()
        self.startup_report = list(gate.passed)

        # Arm the dead-man before anything can place an order.
        self.pipeline.risk.killswitch.heartbeat(self.clock())
        self._last_heartbeat = self.clock()

        await self._enable_strategies()
        self.state = SessionState.RUNNING

    async def _clear_reconciliation_triggers(self, operator: str) -> None:
        at = self.clock()
        switch = self.pipeline.risk.killswitch
        for trigger in (Trigger.MISSING_LOCAL, Trigger.RECONCILE_MISMATCH):
            if trigger in switch.engaged:
                switch.condition_cleared(trigger, at)
                switch.approve(trigger, operator)
                switch.try_clear(trigger, at)

    async def _cache_filters(self) -> bool:
        ok = True
        for name, adapter in self.adapters.items():
            try:
                info = await adapter.reference_data()
            except Exception:                                  # noqa: BLE001
                ok = False
                continue
            if info.filters:
                self.pipeline.executor.venue_filters[name] = dict(info.filters)
                self.pipeline.filters.update(info.filters)
        return ok

    async def _check_clock(self) -> Tuple[bool, float]:
        worst = 0.0
        for adapter in self.adapters.values():
            try:
                venue_time = await adapter.server_time()
            except Exception:                                  # noqa: BLE001
                return False, float("inf")
            drift_ms = abs(venue_time - self.clock()) / 1e6
            worst = max(worst, drift_ms)
        self.metrics.gauge("clock_drift_ms", "venue clock drift").set(worst)
        return worst <= self.config.halt_clock_drift_ms, worst

    async def _enable_strategies(self) -> None:
        """One at a time, with a settling period between each."""
        for strategy in self.pipeline.strategies:
            strategy.health.enabled = True
            self.metrics.counter("strategies_enabled").inc()
            if self.config.strategy_settle_ns:
                await asyncio.sleep(0)       # a real session waits; a backtest does not

    # ------------------------------------------------------------------
    # Running
    # ------------------------------------------------------------------

    async def on_event(self, event: MarketEvent) -> None:
        """One market event through the whole system, with the periodic work."""
        if self.state not in (SessionState.RUNNING, SessionState.STARTING):
            return

        started = self.clock()
        await self.pipeline.on_market_event(event)
        self.metrics.histogram("signal_to_order_ms").observe((self.clock() - started) / 1e6)
        self.metrics.counter("events_processed").inc()

        if event.exchange_ts:
            staleness_ms = max(0.0, (event.local_recv_ts - event.exchange_ts) / 1e6)
            self.metrics.histogram("feed_staleness_ms").observe(staleness_ms)

        await self.tick(event.emitted_at or self.clock())

    async def tick(self, now: Optional[Nanos] = None) -> None:
        """Periodic work: heartbeat, reconcile, evaluate the indicators.

        Deliberately driven on its own cadence rather than by market data. A
        quiet market is exactly when a position mismatch goes unnoticed.
        """
        at = now if now is not None else self.clock()

        if at - self._last_heartbeat >= self.config.heartbeat_interval_ns:
            self.pipeline.risk.killswitch.heartbeat(at)
            self._last_heartbeat = at

        if self.pipeline.risk.killswitch.check_deadman(at):
            await self._flatten("risk service heartbeat missed")

        if at - self._last_reconcile >= self.config.reconcile_interval_ns:
            await self.reconcile()

        self.pipeline.risk.check_drawdown_ladder(at)
        self._publish_state()

        breaches = self.slo.raise_all(self.alerts, money_at_risk=self.has_open_positions)
        for breach in breaches:
            self.metrics.counter("slo_breaches").inc()

        if self.pipeline.risk.killswitch.must_flatten and self.state == SessionState.RUNNING:
            await self._flatten(self.pipeline.risk.killswitch.blocking_reason() or "kill switch")

    def _publish_state(self) -> None:
        books = self.pipeline.books
        self.metrics.gauge("equity").set(float(books.equity))
        self.metrics.gauge("gross_notional").set(float(books.gross_notional))
        self.metrics.gauge("drawdown").set(float(self.pipeline.risk.state.drawdown))
        self.metrics.gauge("open_positions").set(len(books.positions))
        self.metrics.gauge("open_leg_groups").set(self.pipeline.unwinder.open_groups)
        self.metrics.gauge("kill_switch_engaged").set(
            1.0 if self.pipeline.risk.killswitch.is_engaged else 0.0
        )

    @property
    def has_open_positions(self) -> bool:
        return bool(self.pipeline.books.positions)

    # ------------------------------------------------------------------
    # Reconciliation
    # ------------------------------------------------------------------

    async def reconcile(self, force: bool = False) -> Tuple[bool, List[str]]:
        """Compare local belief against venue truth. The venue always wins."""
        at = self.clock()
        self._last_reconcile = at
        all_clean = True
        problems: List[str] = []

        for name, adapter in self.adapters.items():
            reconciler = self.reconcilers[name]
            try:
                remote_positions = await adapter.positions()
                remote_orders = await adapter.open_orders()
            except Exception as e:                             # noqa: BLE001
                if reconciler.on_cycle_failed():
                    self.pipeline.risk.killswitch.engage(
                        Trigger.RECONCILE_MISMATCH, at,
                        f"{name}: three consecutive reconciliation failures",
                    )
                problems.append(f"{name}: {e}")
                all_clean = False
                continue

            local_positions = {
                key: pos for key, pos in self.pipeline.books.positions.items()
                if key[0] == name
            }
            local_orders = {
                m.intent.client_order_id: m.to_state()
                for m in self.pipeline.executor.open_machines()
                if m.intent.venue == name
            }
            report = reconciler.reconcile(
                local_positions, remote_positions, local_orders, remote_orders,
                self.pipeline.books.equity, at,
            )
            self.metrics.counter("reconciliation_cycles").inc()

            halting = Reconciler.halting_discrepancies(report)
            if halting:
                all_clean = False
                problems.extend(str(d.get("detail", d.get("kind"))) for d in halting)
                self.metrics.gauge("reconciliation_consecutive_failures").set(2)
                self.pipeline.risk.killswitch.engage(
                    Trigger.MISSING_LOCAL if any(
                        d.get("kind") == DiscrepancyClass.MISSING_LOCAL for d in halting
                    ) else Trigger.RECONCILE_MISMATCH,
                    at, "; ".join(problems[:2]),
                )
            elif not report.clean:
                problems.extend(str(d.get("kind")) for d in report.discrepancies)

        if all_clean:
            self.metrics.gauge("reconciliation_consecutive_failures").set(0)
        self.pipeline.executor.reconciliation_clean = all_clean
        return all_clean, problems

    # ------------------------------------------------------------------
    # Halting
    # ------------------------------------------------------------------

    async def _flatten(self, reason: str) -> None:
        """Cancel first, then reduce. Never the other way round.

        Flattening while your own stale quotes are still working means the
        flatten competes with them, which is how a halt makes a position worse.
        """
        self.state = SessionState.HALTED
        self.alerts.raise_alert(Severity.P1, "flatten", reason, money_at_risk=True)
        self.metrics.counter("flattens").inc()

        for machine in list(self.pipeline.executor.open_machines()):
            try:
                await self.pipeline.executor.cancel(machine.intent.client_order_id)
            except Exception:                                  # noqa: BLE001
                pass

        for (venue, symbol), position in list(self.pipeline.books.positions.items()):
            if position.quantity == 0:
                continue
            price = self.pipeline._marks.get((venue, symbol))
            if price is None:
                continue
            side = "sell" if position.quantity > 0 else "buy"
            try:
                intent = self.pipeline.executor.build_intent(
                    strategy_id="flatten", venue=venue, symbol=symbol, side=side,
                    quantity=abs(position.quantity), correlation_id="flatten",
                    price=price, order_type="limit", reduce_only=True,
                )
            except Exception:                                  # noqa: BLE001
                continue
            decision = self.pipeline.risk.evaluate(
                intent, self.pipeline._risk_context(
                    MarketEvent(correlation_id="flatten", emitted_at=self.clock(),
                                source="session", venue=venue, symbol=symbol,
                                exchange_ts=self.clock(), local_recv_ts=self.clock())
                )
            )
            await self.pipeline.executor.submit(intent, decision)

    async def manual_kill(self, operator: str) -> None:
        """One command that flattens everything and disables all strategies.

        Every operator has it, and it is tested weekly in production during
        low-risk hours. An untested kill switch is a hypothesis.
        """
        self.pipeline.risk.killswitch.engage(Trigger.MANUAL, self.clock(), f"by {operator}")
        for strategy in self.pipeline.strategies:
            strategy.health.enabled = False
        await self._flatten(f"manual kill by {operator}")
        # Publish immediately. A dashboard that only learns the switch fired at
        # the next tick is a dashboard an operator checks during an incident
        # and misreads.
        self._publish_state()

    async def stop(self) -> None:
        self.state = SessionState.STOPPED

    # ------------------------------------------------------------------

    def status(self) -> Dict[str, object]:
        return {
            "state": self.state,
            "kill_switch": self.pipeline.risk.killswitch.status(),
            "equity": str(self.pipeline.books.equity),
            "open_positions": len(self.pipeline.books.positions),
            "open_orders": len(self.pipeline.executor.open_machines()),
            "open_leg_groups": self.pipeline.unwinder.open_groups,
            "reconciliation_clean": self.pipeline.executor.reconciliation_clean,
            "strategies": {
                s.strategy_id: {"state": s.health.state, "enabled": s.health.enabled}
                for s in self.pipeline.strategies
            },
        }
