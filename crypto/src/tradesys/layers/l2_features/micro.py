"""Microstructure features. Pure functions of book and trade history."""

from __future__ import annotations

from decimal import Decimal
from typing import List, Optional, Sequence, Tuple

from ...core.types import Decimal as Dec, dec
from .registry import feature

__all__ = ["microprice", "book_imbalance", "realised_volatility",
           "trade_flow_imbalance", "effective_spread_bps"]

Level = Tuple[Dec, Dec]


@feature("microprice", lookback=1)
def microprice(bids: Sequence[Level], asks: Sequence[Level]) -> Optional[Dec]:
    """Size-weighted fair value. Use instead of mid (SPEC section 5.2)."""
    if not bids or not asks:
        return None
    (bp, bq), (ap, aq) = bids[0], asks[0]
    total = bq + aq
    if total == 0:
        return None
    return (bq * ap + aq * bp) / total


@feature("book_imbalance", lookback=1)
def book_imbalance(bids: Sequence[Level], asks: Sequence[Level], depth: int = 5) -> Optional[Dec]:
    """(bid size - ask size) / total over ``depth`` levels. Range [-1, 1]."""
    bq = sum((q for _, q in bids[:depth]), dec(0))
    aq = sum((q for _, q in asks[:depth]), dec(0))
    total = bq + aq
    return (bq - aq) / total if total > 0 else None


@feature("realised_volatility", lookback=2)
def realised_volatility(prices: Sequence[Dec]) -> Optional[Dec]:
    """Root-mean-square of simple returns over the window.

    Simple returns rather than log returns so the computation stays in
    Decimal. Over the short windows this is used on, the difference is far
    below the noise in the estimate itself, and keeping Decimal end-to-end
    matters more than the third decimal place of a volatility number.
    """
    if len(prices) < 2:
        return None
    rets: List[Dec] = []
    for prev, cur in zip(prices, prices[1:]):
        if prev == 0:
            return None
        rets.append((cur - prev) / prev)
    if not rets:
        return None
    mean_sq = sum((r * r for r in rets), dec(0)) / len(rets)
    return dec(str(float(mean_sq) ** 0.5))


@feature("trade_flow_imbalance", lookback=1)
def trade_flow_imbalance(trades: Sequence[Tuple[Dec, str]]) -> Optional[Dec]:
    """Signed volume over the window, normalised. ``trades`` is (qty, side)."""
    if not trades:
        return None
    buy = sum((q for q, s in trades if s == "buy"), dec(0))
    sell = sum((q for q, s in trades if s == "sell"), dec(0))
    total = buy + sell
    return (buy - sell) / total if total > 0 else None


@feature("effective_spread_bps", lookback=1)
def effective_spread_bps(bids: Sequence[Level], asks: Sequence[Level]) -> Optional[Dec]:
    """Quoted spread in basis points of mid."""
    if not bids or not asks:
        return None
    bp, ap = bids[0][0], asks[0][0]
    mid = (bp + ap) / 2
    if mid <= 0:
        return None
    return (ap - bp) / mid * dec(10_000)
