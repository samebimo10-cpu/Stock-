"""The backtester.

Runs the **same** :class:`~tradesys.pipeline.Pipeline` as live, against
:class:`~tradesys.adapters.sim.SimAdapter` instead of a venue. That is the
whole design: there is no separate backtest engine to drift away from
production.

It refuses to run without a trial registry. A backtest that does not register
does not run (SPEC section 11.3), because deflated Sharpe is only as honest as
its trial count and self-reported counts are consistently low.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Iterable, List, Mapping, Optional, Sequence

from ..accounting import Books
from ..core.events import Fill, MarketEvent
from ..core.types import Decimal as Dec, dec
from ..costs import CostModel
from ..pipeline import DecisionRecorder, Pipeline
from .registry import RegistryRequired, TrialRegistry
from .validation import max_drawdown, sharpe

__all__ = ["Backtester", "BacktestResult", "CostImpact", "cost_impact"]


@dataclass
class BacktestResult:
    trial_id: int
    events: int
    signals: int
    orders: int
    fills: int
    rejections: int
    unknown: int
    equity_curve: List[float] = field(default_factory=list)
    recorder: Optional[DecisionRecorder] = None
    books: Optional[Books] = None
    modelled_costs: Mapping[str, Dec] = field(default_factory=dict)

    @property
    def gross_pnl(self) -> Dec:
        return sum((led.gross_pnl for led in self.books.strategies.values()), dec(0)) \
            if self.books else dec(0)

    @property
    def net_pnl(self) -> Dec:
        return sum((led.net_pnl for led in self.books.strategies.values()), dec(0)) \
            if self.books else dec(0)

    @property
    def total_costs(self) -> Dec:
        return sum((led.total_costs for led in self.books.strategies.values()), dec(0)) \
            if self.books else dec(0)

    @property
    def cost_ratio(self) -> Optional[Dec]:
        """Costs as a share of gross profit. The SPEC section 1.2 gate is 40%."""
        gross = self.gross_pnl
        if gross <= 0:
            return None
        return self.total_costs / gross

    @property
    def sharpe(self) -> float:
        rets = self.returns()
        return sharpe(rets) if len(rets) > 1 else 0.0

    @property
    def max_drawdown(self) -> float:
        return max_drawdown(self.equity_curve) if self.equity_curve else 0.0

    def returns(self) -> List[float]:
        out = []
        for a, b in zip(self.equity_curve, self.equity_curve[1:]):
            out.append((b - a) / a if a else 0.0)
        return out


class Backtester:
    """Drives a pipeline over recorded events."""

    def __init__(self, pipeline: Pipeline, adapter, registry: Optional[TrialRegistry],
                 strategy_name: str = "unnamed", parameters: Optional[Mapping] = None) -> None:
        if registry is None:
            raise RegistryRequired(
                "a backtest requires a trial registry. Deflated Sharpe uses the "
                "true trial count, and a run that does not register is a trial "
                "that silently does not count (SPEC section 11.3)."
            )
        self.pipeline = pipeline
        self.adapter = adapter
        self.registry = registry
        self.strategy_name = strategy_name
        self.parameters = dict(parameters or {})

    def _code_hash(self) -> str:
        material = "|".join(
            f"{type(s).__module__}.{type(s).__name__}:{sorted(s.parameters().items())}"
            for s in self.pipeline.strategies
        )
        return hashlib.blake2b(material.encode(), digest_size=8).hexdigest()

    async def run(self, events: Sequence[MarketEvent], data_start: str = "",
                  data_end: str = "") -> BacktestResult:
        with self.registry.trial(
            self.strategy_name, self._code_hash(), self.parameters,
            data_start or "unknown", data_end or "unknown",
        ) as trial_id:
            signals = orders = fills = rejections = unknown = 0
            equity: List[float] = []
            st = self.pipeline.risk.state

            for event in events:
                # The simulated venue sees the same events the strategy does.
                # If it does not, fills are decided against a stale book.
                if hasattr(self.adapter, "apply_market_event"):
                    self.adapter.apply_market_event(event)
                result = await self.pipeline.on_market_event(event)
                signals += len(result.signals)
                orders += len(result.submitted)
                rejections += len(result.rejected)
                unknown += len(result.unknown)

                # Match resting orders, then feed fills back through the same
                # path a live fill takes.
                for fill in self.adapter.step():
                    self.pipeline.on_fill(fill)
                    fills += 1

                self._mark_to_market()
                equity.append(float(st.equity))

            res = BacktestResult(
                trial_id=trial_id, events=len(events), signals=signals, orders=orders,
                fills=fills, rejections=rejections, unknown=unknown,
                equity_curve=equity, recorder=self.pipeline.recorder,
                books=self.pipeline.books,
                modelled_costs=dict(getattr(self.adapter, "modelled_costs", {})),
            )
            self.registry.finish(
                trial_id, sharpe=res.sharpe, max_drawdown=res.max_drawdown,
                trades=fills, outcome="complete",
            )
            return res

    def _mark_to_market(self) -> None:
        """Push the ledger's view into the risk service's state.

        No arithmetic here. Unrealised profit is computed once, in the books,
        against mark price rather than last trade - last trade can be an
        outlier, and mark price is what the exchange liquidates against.
        """
        self.pipeline.books.apply_to(self.pipeline.risk.state)


@dataclass(frozen=True)
class CostImpact:
    """The SPEC section 11.1 review heuristic, actually run.

    If modelling costs properly does not cut returns by at least 30%, the
    **model** is wrong - not the strategy. This runs the same events twice,
    once with the cost model and once without, and reports the cut.
    """

    gross_return: float
    net_return: float
    cut: float
    passes: bool
    message: str

    def __str__(self) -> str:
        return f"{'OK' if self.passes else 'SUSPECT'}: {self.message}"


async def cost_impact(pipeline_factory, events: Sequence[MarketEvent],
                      registry: TrialRegistry, strategy_name: str = "unnamed") -> CostImpact:
    """Run with and without costs, and apply the 30% review rule.

    ``pipeline_factory(with_costs: bool)`` returns a fresh ``(pipeline,
    adapter)`` pair. Both runs register as trials, because both are trials:
    a costless run informs the search exactly as much as any other, and the
    trial count that feeds deflated Sharpe has to include it.
    """
    results = {}
    for with_costs in (False, True):
        pipeline, adapter = pipeline_factory(with_costs)[:2]
        bt = Backtester(pipeline, adapter, registry,
                        strategy_name=f"{strategy_name}{'' if with_costs else ' (costless)'}")
        results[with_costs] = await bt.run(events)

    gross = _total_return(results[False])
    net = _total_return(results[True])
    passes, message = CostModel.review_check(gross, net)
    cut = (gross - net) / gross if gross > 0 else 0.0
    return CostImpact(gross, net, cut, passes, message)


def _total_return(result: BacktestResult) -> float:
    curve = result.equity_curve
    if len(curve) < 2 or curve[0] == 0:
        return 0.0
    return (curve[-1] - curve[0]) / curve[0]
