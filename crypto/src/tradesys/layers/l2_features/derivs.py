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


@feature("hedge_ratio", lookback=30)
def hedge_ratio(a: Sequence[Dec], b: Sequence[Dec]) -> Optional[Dec]:
    """Least-squares slope of ``a`` on ``b``, for a spread.

    The ratio that makes the pair's spread stationary. Re-estimated on a
    rolling window rather than fixed: a hedge ratio that was right last quarter
    is a directional position this quarter, and that is how a pairs book
    quietly stops being market-neutral.
    """
    n = min(len(a), len(b))
    if n < 30:
        return None
    a, b = list(a[-n:]), list(b[-n:])
    mean_a = sum(a, dec(0)) / n
    mean_b = sum(b, dec(0)) / n
    covariance = sum(((x - mean_a) * (y - mean_b) for x, y in zip(a, b)), dec(0))
    variance = sum(((y - mean_b) ** 2 for y in b), dec(0))
    if variance == 0:
        return None
    return covariance / variance


@feature("spread_zscore", lookback=30)
def spread_zscore(a: Sequence[Dec], b: Sequence[Dec],
                  ratio: Optional[Dec] = None) -> Optional[Dec]:
    """Standardised spread between two series.

    ``None`` below thirty observations or at zero variance. A z-score computed
    from a handful of points is a number with no information in it, and the
    strategy handles its absence explicitly rather than trading on it.
    """
    n = min(len(a), len(b))
    if n < 30:
        return None
    beta = ratio if ratio is not None else hedge_ratio(a, b)
    if beta is None:
        return None
    spread = [x - beta * y for x, y in zip(a[-n:], b[-n:])]
    mean = sum(spread, dec(0)) / n
    variance = sum(((s - mean) ** 2 for s in spread), dec(0)) / n
    if variance <= 0:
        return None
    sd = dec(str(float(variance) ** 0.5))
    return (spread[-1] - mean) / sd


@feature("spread_half_life", lookback=30)
def spread_half_life(a: Sequence[Dec], b: Sequence[Dec],
                     ratio: Optional[Dec] = None) -> Optional[Dec]:
    """Half-life of mean reversion, in observations.

    Fitted from the AR(1) coefficient of the spread. This is the number that
    decides whether the pair is tradeable at all: a spread reverting over three
    months is a fact about the world, not a strategy, because the position has
    to be financed and hedged for three months to collect it.

    ``None`` when the spread is not mean-reverting, which is the answer that
    matters most.
    """
    import math

    n = min(len(a), len(b))
    if n < 30:
        return None
    beta = ratio if ratio is not None else hedge_ratio(a, b)
    if beta is None:
        return None
    spread = [float(x - beta * y) for x, y in zip(a[-n:], b[-n:])]
    lagged = spread[:-1]
    deltas = [spread[i + 1] - spread[i] for i in range(len(spread) - 1)]
    if len(lagged) < 10:
        return None
    mean_lag = sum(lagged) / len(lagged)
    mean_delta = sum(deltas) / len(deltas)
    covariance = sum((x - mean_lag) * (y - mean_delta) for x, y in zip(lagged, deltas))
    variance = sum((x - mean_lag) ** 2 for x in lagged)
    if variance == 0:
        return None
    slope = covariance / variance
    if slope >= 0:
        return None            # not mean-reverting; the spread is drifting
    return dec(str(round(-math.log(2) / slope, 4)))
