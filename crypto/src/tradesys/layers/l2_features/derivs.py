"""Derivatives features.

Raw funding is not comparable across assets or regimes, which is why the
z-score rather than the rate is what a strategy consumes.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional, Sequence, Tuple

from ...core.types import Decimal as Dec, dec
from .registry import feature

__all__ = ["annualised_funding", "funding_zscore", "annualised_basis_bps",
           "oi_price_divergence"]


@feature("annualised_funding", lookback=1)
def annualised_funding(rate: Dec, interval_hours: int = 8) -> Dec:
    """Annualise a per-interval funding rate.

    Binance settles every 8 hours, so three settlements a day. A rate of
    0.01% per interval annualises to about 10.95%, which is the headline -
    and the headline is not the strategy (Annex B section 4).

    >>> annualised_funding(dec("0.0001"), 8)
    Decimal('0.1095')
    """
    per_day = dec(24) / dec(interval_hours)
    return rate * per_day * dec(365)


@feature("funding_zscore", lookback=30)
def funding_zscore(history: Sequence[Dec]) -> Optional[Dec]:
    """Current funding against its own trailing distribution.

    Needs at least 30 observations. Below that it returns ``None`` rather than
    a number computed from too little data - a missing feature that the
    strategy handles explicitly beats a confident-looking estimate built on
    eight points.
    """
    if len(history) < 30:
        return None
    n = len(history)
    mean = sum(history, dec(0)) / n
    var = sum(((h - mean) ** 2 for h in history), dec(0)) / n
    if var == 0:
        return None
    sd = dec(str(float(var) ** 0.5))
    return (history[-1] - mean) / sd


@feature("annualised_basis_bps", lookback=1)
def annualised_basis_bps(spot: Dec, perp_mark: Dec) -> Optional[Dec]:
    """Perp premium over spot, in basis points."""
    if spot <= 0:
        return None
    return (perp_mark - spot) / spot * dec(10_000)


@feature("oi_price_divergence", lookback=2)
def oi_price_divergence(oi: Sequence[Dec], price: Sequence[Dec]) -> Optional[Dec]:
    """Sign of open-interest change against price change.

    Positive means open interest and price moved together, which is new
    positioning; negative means they diverged, which is unwinding. The sign of
    the pair distinguishes the two, and they call for opposite responses.
    """
    if len(oi) < 2 or len(price) < 2 or oi[-2] == 0 or price[-2] == 0:
        return None
    d_oi = (oi[-1] - oi[-2]) / oi[-2]
    d_px = (price[-1] - price[-2]) / price[-2]
    return d_oi * d_px
