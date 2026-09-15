"""Transaction cost analysis (SPEC section 9.6).

The closed loop between live TCA and the backtest cost model is what keeps the
cost model honest over time. Without it the model is calibrated once and
decays quietly, and the first sign of trouble is a backtest that stopped
describing reality months ago.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from statistics import median
from typing import Dict, List, Optional, Sequence

from ...core.events import Fill
from ...core.types import Decimal as Dec, dec

__all__ = ["TcaRecord", "implementation_shortfall_bps", "TcaBook"]


def implementation_shortfall_bps(side: str, arrival_price: Dec, execution_price: Dec) -> Dec:
    """Cost of execution against the price when the decision was made.

    Positive means the execution was worse than arrival, which is the usual
    case and the number to drive down. Signed by side so buys and sells are
    directly comparable.

    >>> implementation_shortfall_bps("buy", dec("100"), dec("100.1"))
    Decimal('10.000')
    >>> implementation_shortfall_bps("sell", dec("100"), dec("100.1"))
    Decimal('-10.000')
    """
    if arrival_price <= 0:
        raise ValueError("arrival price must be positive")
    diff = execution_price - arrival_price
    signed = diff if side == "buy" else -diff
    return signed / arrival_price * dec(10_000)


@dataclass(frozen=True)
class TcaRecord:
    client_order_id: str
    strategy_id: str
    symbol: str
    side: str
    quantity: Dec
    arrival_price: Optional[Dec]
    execution_price: Dec
    fee: Dec
    is_maker: bool
    shortfall_bps: Optional[Dec]
    modelled_cost: Optional[Dec] = None

    @property
    def realised_cost(self) -> Dec:
        """Fee plus shortfall, in quote currency."""
        slip = dec(0)
        if self.shortfall_bps is not None and self.arrival_price is not None:
            slip = self.quantity * self.arrival_price * self.shortfall_bps / dec(10_000)
        return self.fee + slip


class TcaBook:
    """Accumulates records and answers the weekly review question."""

    def __init__(self, divergence_threshold: Dec = dec("0.20")) -> None:
        self.records: List[TcaRecord] = []
        self.divergence_threshold = divergence_threshold

    def record(self, fill: Fill, modelled_cost: Optional[Dec] = None) -> TcaRecord:
        shortfall = None
        if fill.arrival_price is not None and fill.arrival_price > 0:
            shortfall = implementation_shortfall_bps(fill.side, fill.arrival_price, fill.price)
        rec = TcaRecord(
            client_order_id=fill.client_order_id,
            strategy_id=fill.strategy_id,
            symbol=fill.symbol,
            side=fill.side,
            quantity=fill.quantity,
            arrival_price=fill.arrival_price,
            execution_price=fill.price,
            fee=fill.fee,
            is_maker=fill.is_maker,
            shortfall_bps=shortfall,
            modelled_cost=modelled_cost,
        )
        self.records.append(rec)
        return rec

    def maker_ratio(self) -> Optional[Dec]:
        if not self.records:
            return None
        makers = sum(1 for r in self.records if r.is_maker)
        return dec(makers) / dec(len(self.records))

    def median_notional(self) -> Dec:
        if not self.records:
            return dec(0)
        vals = sorted(r.quantity * r.execution_price for r in self.records)
        mid = len(vals) // 2
        return vals[mid] if len(vals) % 2 else (vals[mid - 1] + vals[mid]) / 2

    def cost_divergence(self, strategy_id: Optional[str] = None) -> Optional[Dec]:
        """(realised - modelled) / modelled over records that have both.

        Divergence above 20% means the backtest cost model is wrong, which
        means every backtest is wrong. That is a research-halt condition, not
        a rounding issue.
        """
        rows = [r for r in self.records
                if r.modelled_cost is not None and r.modelled_cost != 0
                and (strategy_id is None or r.strategy_id == strategy_id)]
        if not rows:
            return None
        realised = sum((r.realised_cost for r in rows), dec(0))
        modelled = sum((r.modelled_cost for r in rows), dec(0))
        if modelled == 0:
            return None
        return (realised - modelled) / abs(modelled)

    def research_halt_required(self, strategy_id: Optional[str] = None) -> bool:
        d = self.cost_divergence(strategy_id)
        return d is not None and abs(d) > self.divergence_threshold
