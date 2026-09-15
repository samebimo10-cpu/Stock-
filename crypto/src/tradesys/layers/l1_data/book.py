"""Local order book with sequence validation."""

from __future__ import annotations

from decimal import Decimal
from typing import Dict, Iterable, List, Optional, Tuple

from ...core.events import BookDelta, BookSnapshot
from ...core.types import Decimal as Dec, dec

__all__ = ["LocalBook"]


class LocalBook:
    """Price-level book maintained from a snapshot plus incremental deltas.

    Sequence handling lives in
    :class:`~tradesys.adapters.binance.BookSequencer`; this class holds the
    levels and answers the questions the feature layer asks of them.
    """

    __slots__ = ("symbol", "_bids", "_asks", "last_update_id")

    def __init__(self, symbol: str) -> None:
        self.symbol = symbol
        self._bids: Dict[Dec, Dec] = {}
        self._asks: Dict[Dec, Dec] = {}
        self.last_update_id: Optional[int] = None

    # -- maintenance -----------------------------------------------------

    def apply_snapshot(self, snap: BookSnapshot) -> None:
        self._bids = {dec(p): dec(q) for p, q in snap.bids if dec(q) > 0}
        self._asks = {dec(p): dec(q) for p, q in snap.asks if dec(q) > 0}
        self.last_update_id = snap.last_update_id

    def apply_delta(self, delta: BookDelta) -> None:
        """Apply one incremental update. Quantity zero deletes the level."""
        for price, qty in delta.bids:
            if qty == 0:
                self._bids.pop(price, None)
            else:
                self._bids[price] = qty
        for price, qty in delta.asks:
            if qty == 0:
                self._asks.pop(price, None)
            else:
                self._asks[price] = qty
        self.last_update_id = delta.final_update_id

    def clear(self) -> None:
        """Discard everything. Called on a sequence gap, before resync."""
        self._bids.clear()
        self._asks.clear()
        self.last_update_id = None

    # -- reading ---------------------------------------------------------

    @property
    def is_empty(self) -> bool:
        return not self._bids or not self._asks

    def bids(self, depth: Optional[int] = None) -> List[Tuple[Dec, Dec]]:
        levels = sorted(self._bids.items(), key=lambda kv: kv[0], reverse=True)
        return levels[:depth] if depth else levels

    def asks(self, depth: Optional[int] = None) -> List[Tuple[Dec, Dec]]:
        levels = sorted(self._asks.items(), key=lambda kv: kv[0])
        return levels[:depth] if depth else levels

    @property
    def best_bid(self) -> Optional[Dec]:
        return max(self._bids) if self._bids else None

    @property
    def best_ask(self) -> Optional[Dec]:
        return min(self._asks) if self._asks else None

    @property
    def mid(self) -> Optional[Dec]:
        b, a = self.best_bid, self.best_ask
        return (b + a) / 2 if b is not None and a is not None else None

    @property
    def is_crossed(self) -> bool:
        """Bid at or above ask. A data-quality incident, never a trading signal."""
        b, a = self.best_bid, self.best_ask
        return b is not None and a is not None and b >= a

    @property
    def spread(self) -> Optional[Dec]:
        b, a = self.best_bid, self.best_ask
        return a - b if b is not None and a is not None else None

    def microprice(self) -> Optional[Dec]:
        """Size-weighted fair value.

        Use this rather than mid (SPEC section 5.2). Mid is wrong whenever the
        book is imbalanced, which is most of the time: the weighting leans
        toward the side with less size, which is the side the next trade is
        more likely to move through.
        """
        b, a = self.best_bid, self.best_ask
        if b is None or a is None:
            return None
        bq, aq = self._bids[b], self._asks[a]
        total = bq + aq
        if total == 0:
            return None
        return (bq * a + aq * b) / total

    def imbalance(self, depth: int = 5) -> Optional[Dec]:
        """(bid size - ask size) / total, over ``depth`` levels. Range [-1, 1]."""
        bq = sum((q for _, q in self.bids(depth)), dec(0))
        aq = sum((q for _, q in self.asks(depth)), dec(0))
        total = bq + aq
        return (bq - aq) / total if total > 0 else None

    def depth_within_bps(self, bps: int) -> Optional[Tuple[Dec, Dec]]:
        """Quantity resting within ``bps`` of mid, per side.

        The liquidity a strategy can actually reach without moving the price
        more than it is willing to.
        """
        m = self.mid
        if m is None:
            return None
        band = m * dec(bps) / dec(10_000)
        bid_qty = sum((q for p, q in self.bids() if p >= m - band), dec(0))
        ask_qty = sum((q for p, q in self.asks() if p <= m + band), dec(0))
        return bid_qty, ask_qty

    def walk(self, side: str, quantity: Dec) -> Optional[Tuple[Dec, Dec]]:
        """Taker execution against real depth. Returns (filled, avg_price).

        ``None`` when the book cannot fill the size. That must propagate:
        filling the remainder at the last level's price models infinite
        liquidity at the worst possible moment (Annex B section 2).
        """
        levels = self.asks() if side == "buy" else self.bids()
        filled = dec(0)
        cost = dec(0)
        for price, qty in levels:
            take = min(qty, quantity - filled)
            cost += take * price
            filled += take
            if filled >= quantity:
                return filled, cost / filled
        return None
