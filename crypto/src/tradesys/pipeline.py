"""The one pipeline, used by backtest, paper and live.

SPEC section 3.2 rule 2: same code path for backtest, paper and live; only the
venue adapter changes. If backtest and live run different code, backtest
results are fiction.

This module is how that rule is kept. There is exactly one implementation of
"market event in, order out", and both the backtester and the live driver call
it. Swapping :class:`~tradesys.adapters.sim.SimAdapter` for
:class:`~tradesys.adapters.binance.BinanceAdapter` is the only difference
between a backtest and a live session.

:class:`DecisionRecorder` captures every decision in order, which is what the
differential test of SPEC section 14.2 compares. Without that test the rule is
an intention rather than a property.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .core.errors import FilterViolation
from .core.events import (
    FeatureSnapshot,
    Fill,
    MarketEvent,
    OrderIntent,
    RiskDecision,
    Signal,
    SymbolFilter,
    TargetPosition,
)
from .accounting import Books
from .core.types import Decimal as Dec, Nanos, dec
from .layers.l2_features.engine import FeatureEngine
from .layers.l4_portfolio.netting import net_targets
from .layers.l5_risk.service import RiskContext, RiskService
from .layers.l6_execution.executor import Executor

__all__ = ["Pipeline", "DecisionRecorder", "Decision", "PipelineResult"]


@dataclass(frozen=True)
class Decision:
    """One recorded decision, in a form that compares cleanly across runs.

    Deliberately excludes wall-clock timestamps and correlation IDs: those
    differ between a live session and its replay by construction, and
    comparing them would make the differential test fail for reasons that
    carry no information. What must match is *what was decided*.
    """

    kind: str          # signal | target | intent | risk | submit
    key: str           # strategy:symbol, or the client order id
    detail: Tuple[Tuple[str, str], ...]

    @staticmethod
    def of(kind: str, key: str, **fields) -> "Decision":
        return Decision(kind, key, tuple(sorted((k, str(v)) for k, v in fields.items())))


class DecisionRecorder:
    """Ordered log of decisions, for the differential test."""

    def __init__(self) -> None:
        self.decisions: List[Decision] = []

    def add(self, kind: str, key: str, **fields) -> None:
        self.decisions.append(Decision.of(kind, key, **fields))

    def __len__(self) -> int:
        return len(self.decisions)

    def diff(self, other: "DecisionRecorder") -> List[str]:
        """Return human-readable divergences. Empty means identical."""
        out: List[str] = []
        a, b = self.decisions, other.decisions
        for i in range(max(len(a), len(b))):
            x = a[i] if i < len(a) else None
            y = b[i] if i < len(b) else None
            if x != y:
                out.append(f"[{i}] {x!r}\n      != {y!r}")
        return out


@dataclass
class PipelineResult:
    signals: List[Signal] = field(default_factory=list)
    targets: List[TargetPosition] = field(default_factory=list)
    intents: List[OrderIntent] = field(default_factory=list)
    decisions: List[RiskDecision] = field(default_factory=list)
    submitted: List[str] = field(default_factory=list)
    rejected: List[Tuple[str, str]] = field(default_factory=list)
    unknown: List[str] = field(default_factory=list)
    #: Targets that could not be expressed as an order: the delta rounded below
    #: a lot, or below the venue's minimum notional.
    unfillable: List[Tuple[str, str]] = field(default_factory=list)


class Pipeline:
    """L1 event in, orders out. The single path."""

    def __init__(
        self,
        strategies: Sequence,
        risk: RiskService,
        executor: Executor,
        filters: Optional[Mapping[str, SymbolFilter]] = None,
        audit=None,
        recorder: Optional[DecisionRecorder] = None,
        allocation_version: int = 1,
        books: Optional[Books] = None,
    ) -> None:
        self.strategies = list(strategies)
        self.risk = risk
        self.executor = executor
        self.filters = dict(filters or {})
        self.audit = audit
        # `recorder or DecisionRecorder()` would be wrong: an empty recorder
        # defines __len__ as 0 and is therefore falsy, so a caller's own
        # recorder would be silently discarded and every decision recorded
        # into an object nobody holds.
        self.recorder = DecisionRecorder() if recorder is None else recorder
        self.allocation_version = allocation_version
        self._engines: Dict[Tuple[str, str], FeatureEngine] = {}
        self._feed_last: Dict[str, Nanos] = {}
        self._marks: Dict[str, Dec] = {}
        #: The ledger. Positions live here and are pushed into the risk
        #: service's state, so the books and the risk layer cannot hold
        #: different views of the same account (SPEC section 12.1).
        self.books = books if books is not None else Books(risk.state.cash)
        self._last_funding_ts: Dict[Tuple[str, str], Nanos] = {}

    # -- state -----------------------------------------------------------

    def engine(self, venue: str, symbol: str) -> FeatureEngine:
        key = (venue, symbol)
        if key not in self._engines:
            self._engines[key] = FeatureEngine(venue, symbol)
        return self._engines[key]

    # -- the path --------------------------------------------------------

    async def on_market_event(self, event: MarketEvent) -> PipelineResult:
        result = PipelineResult()

        # L1 -> L2
        engine = self.engine(event.venue, event.symbol)
        engine.on_event(event)
        self._feed_last[event.symbol] = event.exchange_ts
        mid = engine.book.mid
        if mid is not None:
            self._marks[event.symbol] = mid
            self.books.mark(event.venue, event.symbol, mid)

        if event.kind == "funding":
            self._accrue_funding(event)

        if not event.quality.usable_for_research and event.quality.gap_detected:
            # A gap window produces no signals. The feature values across it
            # are not wrong so much as unknown, and acting on unknown is how a
            # strategy learns to trade a reconnection.
            self._record_audit("gap_skip", {"symbol": event.symbol}, event.correlation_id)
            return result

        snapshot = engine.snapshot(event.correlation_id, event.emitted_at)

        # L2 -> L3
        for strat in self.strategies:
            if not strat.health.may_trade:
                continue
            sig = strat.on_features(snapshot)
            if sig is None:
                continue
            result.signals.append(sig)
            self.recorder.add("signal", f"{sig.strategy_id}:{sig.symbol}",
                              target=sig.target_position, urgency=sig.urgency)
            self._record_audit("signal", sig, sig.correlation_id)

        if not result.signals:
            return result

        # L3 -> L4
        netted = net_targets(result.signals, self.allocation_version,
                             event.emitted_at, self.risk.allocation_multiplier())
        result.targets = list(netted.targets)
        for t in netted.targets:
            self.recorder.add("target", f"{t.venue}:{t.symbol}", target=t.target)
            self._record_audit("target", t, t.correlation_id or event.correlation_id)

        # L4 -> L5 -> L6
        for target in netted.targets:
            current = self.risk.state.position_qty(target.venue, target.symbol)
            # Orders already working count toward the position we are heading
            # for. Sizing from the held position alone re-sends the same order
            # on every event until one fills, and then all of them fill.
            in_flight = self.executor.in_flight(target.venue, target.symbol)
            delta = target.target - current - in_flight
            if delta == 0:
                continue
            side = "buy" if delta > 0 else "sell"
            price = self._marks.get(target.symbol)
            if price is None:
                continue

            try:
                intent = self.executor.build_intent(
                    strategy_id=_dominant(target),
                    venue=target.venue,
                    symbol=target.symbol,
                    side=side,
                    quantity=abs(delta),
                    correlation_id=event.correlation_id,
                    price=price,
                    order_type="limit",
                    post_only=True,
                )
            except FilterViolation as e:
                # The position is already within one lot of its target, or the
                # remaining delta is below the venue's minimum notional. There
                # is nothing to trade, which is a normal outcome and not an
                # error: a target that moves by less than a lot cannot be
                # expressed. Skipping is the safe degradation required by SPEC
                # section 3.2 rule 6 - no layer's failure path may result in a
                # new position, and crashing the pipeline on a rounding edge
                # would take the whole book down with it.
                result.unfillable.append((target.symbol, str(e)))
                self._record_audit("untradeable_delta",
                                   {"symbol": target.symbol, "delta": str(delta),
                                    "reason": str(e)},
                                   event.correlation_id)
                continue
            result.intents.append(intent)
            self.recorder.add("intent", intent.client_order_id,
                              side=intent.side, qty=intent.quantity, px=intent.price)
            self._record_audit("intent", intent, intent.correlation_id)

            ctx = RiskContext(
                now=event.emitted_at,
                feed_last_event=dict(self._feed_last),
                reconciliation_clean=self.executor.reconciliation_clean,
                rate_limit=self.executor.adapter.rate_limit_state(),
                filters=self.filters,
                mark_prices=dict(self._marks),
            )
            decision = self.risk.evaluate(intent, ctx)
            result.decisions.append(decision)
            self.recorder.add("risk", intent.client_order_id,
                              approved=decision.approved,
                              qty=decision.adjusted_quantity,
                              rejected_by=decision.rejected_by)
            self._record_audit("risk_decision", decision, decision.correlation_id)

            outcome = await self.executor.submit(intent, decision)
            self.recorder.add("submit", intent.client_order_id,
                              accepted=outcome.accepted, unknown=outcome.unknown)
            if outcome.accepted:
                result.submitted.append(intent.client_order_id)
            elif outcome.unknown:
                result.unknown.append(intent.client_order_id)
            else:
                result.rejected.append((intent.client_order_id, outcome.reason))
            self._record_audit("order", {"coid": intent.client_order_id,
                                         "accepted": outcome.accepted,
                                         "reason": outcome.reason},
                               event.correlation_id)

        return result

    def on_fill(self, fill: Fill) -> None:
        """Book a fill once, in the ledger, then push the result into risk.

        The position arithmetic lives in :mod:`tradesys.accounting` and nowhere
        else. Keeping a second copy here was how the pipeline and the books
        could disagree about what the account holds, which is the failure SPEC
        section 12.1 is written to prevent.
        """
        self.executor.on_fill(fill)
        self.books.on_fill(fill)
        self.books.apply_to(self.risk.state)
        self._record_audit("fill", fill, fill.correlation_id)

    def _accrue_funding(self, event: MarketEvent) -> None:
        """Accrue funding for the elapsed fraction of the interval, then settle.

        Continuous accrual rather than a lump at settlement. Lumpy booking puts
        step changes into the equity curve, and the drawdown and Sharpe numbers
        the whole validation protocol rests on are measured off that curve.
        """
        payload = event.payload
        key = (event.venue, event.symbol)
        interval_ns = payload.interval_hours * 3600 * 1_000_000_000
        last = self._last_funding_ts.get(key)
        self._last_funding_ts[key] = event.exchange_ts
        if last is None or interval_ns <= 0:
            return

        elapsed = event.exchange_ts - last
        fraction = dec(str(min(1.0, max(0.0, elapsed / interval_ns))))
        if fraction == 0:
            return

        position = self.books.positions.get(key)
        if position is None or position.quantity == 0:
            return
        strategy_id = self._position_owner(key)
        self.books.accrue_funding(event.venue, event.symbol, payload.rate,
                                  fraction, strategy_id)
        self.books.settle_funding(event.venue, event.symbol)
        self.books.apply_to(self.risk.state)

    def _position_owner(self, key: Tuple[str, str]) -> str:
        """Which strategy holds this position, for funding attribution."""
        for sid, led in self.books.strategies.items():
            if key in led.positions:
                return sid
        return "unattributed"

    # -- helpers ---------------------------------------------------------

    def _record_audit(self, kind: str, payload, correlation_id: str = "") -> None:
        if self.audit is None:
            return
        self.audit.record(kind, payload, correlation_id)


def _dominant(target: TargetPosition) -> str:
    """The strategy contributing most of a netted target, for attribution."""
    if not target.contributions:
        return "unattributed"
    return max(target.contributions.items(), key=lambda kv: abs(kv[1]))[0]
