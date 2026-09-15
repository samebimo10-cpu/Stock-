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
from . import derivs, micro
from .registry import REGISTRY

__all__ = ["FeatureEngine"]


class FeatureEngine:
    """Per-(venue, symbol) rolling state and snapshot production."""

    def __init__(self, venue: str, symbol: str, price_window: int = 64,
                 funding_window: int = 240, trade_window: int = 200) -> None:
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
