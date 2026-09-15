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

from ..core.events import Fill, MarketEvent
from ..core.types import Decimal as Dec, dec
from ..pipeline import DecisionRecorder, Pipeline
from .registry import RegistryRequired, TrialRegistry
from .validation import max_drawdown, sharpe

__all__ = ["Backtester", "BacktestResult"]


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
            )
            self.registry.finish(
                trial_id, sharpe=res.sharpe, max_drawdown=res.max_drawdown,
                trades=fills, outcome="complete",
            )
            return res

    def _mark_to_market(self) -> None:
        """Unrealised profit and loss at current marks.

        Mark price rather than last trade: last trade can be an outlier, and
        mark price is what the exchange liquidates against.
        """
        st = self.pipeline.risk.state
        total = dec(0)
        for (venue, symbol), pos in st.positions.items():
            mark = self.pipeline._marks.get(symbol)
            if mark is None:
                continue
            total += (mark - pos.avg_entry_price) * pos.quantity
        st.unrealised = total
        st.mark()
