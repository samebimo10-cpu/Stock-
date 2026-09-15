"""Assembles :class:`FeatureSnapshot` objects from L1 events.

The two properties that matter here are stamping and missingness:

* ``as_of`` is the timestamp of the **last input event**, never of
  computation. A consumer asserts ``decision_ts >= as_of``, which is what
  makes point-in-time correctness checkable instead of assumed.
* A missing input yields ``None``, never an imputed value. Imputation is a
  research convenience that becomes a production lie (SPEC section 5.3).
"""

from __future__ import annotations

from collections import deque
from decimal import Decimal
from typing import Deque, Dict, List, Mapping, Optional, Tuple

from ...core.events import FeatureSnapshot, MarketEvent, QualityFlags
from ...core.types import Decimal as Dec, Nanos, dec
from ..l1_data.book import LocalBook
from . import derivs, micro, trend
from .registry import REGISTRY

__all__ = ["FeatureEngine"]


class FeatureEngine:
    """Per-(venue, symbol) rolling state and snapshot production."""

    def __init__(self, venue: str, symbol: str, price_window: int = 64,
                 funding_window: int = 240, trade_window: int = 200,
                 cascade_window_ns: int = 60_000_000_000) -> None:
        self.venue = venue
        self.symbol = symbol
        self.book = LocalBook(symbol)
        self._prices: Deque[Dec] = deque(maxlen=price_window)
        self._funding: Deque[Dec] = deque(maxlen=funding_window)
        self._trades: Deque[Tuple[Dec, str]] = deque(maxlen=trade_window)
        self._oi: Deque[Dec] = deque(maxlen=price_window)
        self._spot: Optional[Dec] = None
        self._mark: Optional[Dec] = None
        self._funding_interval = 8
        #: Forced flow and ordinary flow over the same recent window, so the
        #: ratio between them means something. Kept with timestamps rather
        #: than as a fixed-length deque: a cascade is defined by how much
        #: arrived in a minute, not by how many events ago it started, and a
        #: count-based window silently stretches to hours in a quiet market.
        self._cascade_window_ns = cascade_window_ns
        self._liquidations: Deque[Tuple[Nanos, Dec, str]] = deque()
        self._recent_trades: Deque[Tuple[Nanos, Dec]] = deque()
        self.last_input_ts: Nanos = 0
        self.last_quality = QualityFlags()

    # -- ingestion -------------------------------------------------------

    def on_event(self, event: MarketEvent) -> None:
        """Absorb one L1 event. Pure state update, no output."""
        self.last_input_ts = max(self.last_input_ts, event.exchange_ts)
        self.last_quality = event.quality

        if event.kind == "book_snapshot":
            self.book.apply_snapshot(event.payload)
        elif event.kind == "book_delta":
            self.book.apply_delta(event.payload)
        elif event.kind == "trade":
            self._trades.append((event.payload.quantity, event.payload.aggressor_side))
            self._prices.append(event.payload.price)
            self._recent_trades.append((event.exchange_ts, event.payload.quantity))
            self._prune(event.exchange_ts)
            return
        elif event.kind == "liquidation":
            self._liquidations.append(
                (event.exchange_ts, event.payload.quantity, event.payload.side))
            self._prune(event.exchange_ts)
            return
        elif event.kind == "funding":
            self._funding.append(event.payload.rate)
            self._funding_interval = event.payload.interval_hours
            return
        elif event.kind == "oi":
            self._oi.append(event.payload.value)
            return
        elif event.kind == "mark":
            self._mark = event.payload.mark_price
            return

        mid = self.book.mid
        if mid is not None:
            self._prices.append(mid)
            self._spot = mid

    def _prune(self, now: Nanos) -> None:
        """Drop everything outside the cascade window, from both series.

        Both, always, in one place. Pruning one and not the other turns the
        ratio into a comparison between a minute of liquidations and an hour of
        volume, which reads as calm during a cascade.
        """
        cutoff = now - self._cascade_window_ns
        while self._liquidations and self._liquidations[0][0] < cutoff:
            self._liquidations.popleft()
        while self._recent_trades and self._recent_trades[0][0] < cutoff:
            self._recent_trades.popleft()

    @property
    def recent_volume(self) -> Dec:
        return sum((q for _, q in self._recent_trades), dec(0))

    # -- production ------------------------------------------------------

    def snapshot(self, correlation_id: str, emitted_at: Nanos) -> FeatureSnapshot:
        bids = self.book.bids(20)
        asks = self.book.asks(20)
        prices = list(self._prices)
        funding = list(self._funding)

        values: Dict[str, Optional[Dec]] = {
            "microprice": micro.microprice(bids, asks),
            "book_imbalance": micro.book_imbalance(bids, asks, 5),
            "book_imbalance_20": micro.book_imbalance(bids, asks, 20),
            "effective_spread_bps": micro.effective_spread_bps(bids, asks),
            "realised_volatility": micro.realised_volatility(prices),
            "trade_flow_imbalance": micro.trade_flow_imbalance(list(self._trades)),
            "funding_zscore": derivs.funding_zscore(funding),
            "annualised_funding": (
                derivs.annualised_funding(funding[-1], self._funding_interval) if funding else None
            ),
            "annualised_basis_bps": (
                derivs.annualised_basis_bps(self._spot, self._mark)
                if self._spot is not None and self._mark is not None else None
            ),
            "oi_price_divergence": derivs.oi_price_divergence(list(self._oi), prices),
            # Trend and dislocation. These are what a strategy with a chance of
            # clearing the cost gate is built on: a signal whose gross, when it
            # is right, is whole percentage points rather than basis points.
            "ewmac": trend.ewmac(prices),
            "breakout_position": trend.breakout_position(prices),
            "downside_volatility": trend.downside_volatility(prices),
            "atr": trend.atr(prices),
            "cascade_pressure": trend.cascade_pressure(
                [(q, side) for _, q, side in self._liquidations], self.recent_volume),
        }

        versions = REGISTRY.versions()
        used = {}
        for name in values:
            base = name.split("_20")[0] if name.endswith("_20") else name
            if base in versions:
                used[name] = versions[base]

        return FeatureSnapshot(
            correlation_id=correlation_id,
            emitted_at=emitted_at,
            source=f"l2:{self.venue}:{self.symbol}",
            venue=self.venue,
            symbol=self.symbol,
            # The last input event, not now(). This is the whole point.
            as_of=self.last_input_ts,
            features=values,
            feature_versions=used,
            inputs_complete=all(v is not None for v in values.values()),
        )
