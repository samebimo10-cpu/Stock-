"""Trend and dislocation features.

These exist because of the arithmetic in :mod:`tradesys.research.viability`.
The cost gate is a ratio - cost over gross - and a strategy clears it by
raising the numerator's denominator, not by shaving the numerator. The carry
strategy failed because its gross accrues in basis points per eight hours
against a round trip that costs 20. Everything here is aimed at the other side
of that fraction: signals whose gross, when they are right, is measured in
whole percentage points.

Two families, deliberately opposite:

* **Trend** (:func:`ewmac`, :func:`breakout_position`) is slow, holds for
  weeks, and earns from continuation. It is the most durable documented
  anomaly in crypto and in every other asset class, and its cost efficiency is
  excellent because a 15% move pays for a 0.1% round trip many times over.
* **Dislocation** (:func:`cascade_pressure`) is fast, holds for hours, and
  earns from forced sellers. It is uncorrelated with trend by construction -
  one buys strength, the other buys collapse - which is what makes them worth
  running together (SPEC section 7.2).

Every function here is pure and causal, and they all read a running price
series rather than completed bars, so they declare ``lag=0`` and may use the
latest price. The first draft of :func:`ewmac` declared ``lag=1`` and was
caught by the look-ahead audit of SPEC section 5.4 within a minute of being
written - a feature that claims not to read the current value and then reads it
is the exact mistake that audit exists for, and it found it in code written by
someone who had just finished explaining the rule.
"""

from __future__ import annotations

from typing import List, Optional, Sequence, Tuple

from ...core.types import Decimal as Dec, dec
from .registry import feature

__all__ = ["ewma", "ewmac", "breakout_position", "downside_volatility",
           "cascade_pressure", "atr"]


def ewma(values: Sequence[Dec], span: int) -> Optional[Dec]:
    """Exponentially weighted mean with the conventional ``2/(span+1)`` alpha.

    Not registered as a feature: it is a building block, and registering it
    would put a number in every snapshot that no strategy reads.

    >>> round(float(ewma([dec(1), dec(2), dec(3)], 2)), 4)
    2.5556
    """
    if not values or span < 1:
        return None
    alpha = dec(2) / dec(span + 1)
    out = values[0]
    for value in values[1:]:
        out = alpha * value + (dec(1) - alpha) * out
    return out


@feature("ewmac", lookback=32, lag=0)
def ewmac(prices: Sequence[Dec], fast: int = 8, slow: int = 32) -> Optional[Dec]:
    """Volatility-normalised EWMA crossover. The classic trend signal.

    The normalisation is the part that matters and the part most often left
    out. A raw crossover of 200 on Bitcoin and 200 on a $2 altcoin are not the
    same signal, and neither are 200 in a calm week and 200 in a violent one.
    Dividing by the volatility of the price series makes the number comparable
    across instruments and across regimes, which is what lets one set of
    thresholds govern a whole book.

    Returns roughly the number of daily standard deviations the fast average
    sits above the slow one. Positive is an uptrend.

    ``lag=0``, and the first draft of this declared 1. The look-ahead audit
    caught it, which is the audit doing exactly its job on exactly the kind of
    mistake it exists for. The series this reads is not bars: it is the prices
    as they arrive, and the most recent one is knowable now, so using it is not
    look-ahead. **If these are ever recomputed over OHLC bars, the lag becomes
    1 and the last bar must be closed** - a bar labelled 09:00 is not knowable
    until 09:59, and a backtest that forgets it earns a Sharpe ratio it will
    not repeat.

    >>> ewmac([dec(100 + i) for i in range(40)]) > 0
    True
    >>> ewmac([dec(100 - i) for i in range(40)]) < 0
    True
    >>> ewmac([dec(100)] * 40) is None
    True
    """
    if len(prices) < slow or fast >= slow:
        return None
    quick, base = ewma(prices, fast), ewma(prices, slow)
    if quick is None or base is None:
        return None

    diffs: List[Dec] = []
    for prev, cur in zip(prices, prices[1:]):
        diffs.append(cur - prev)
    if len(diffs) < 2:
        return None

    # Root mean square of the diffs, NOT their standard deviation about their
    # own mean. The difference matters: a steadily rising series has a large
    # mean diff and near-zero deviation about it, so dividing by the standard
    # deviation divides by roughly nothing and the signal explodes - on
    # precisely the series the strategy most wants to be long. RMS measures
    # the typical size of a move, which is the scale actually wanted, and it
    # is zero only for a series that never moved at all.
    mean_sq = sum((d * d for d in diffs), dec(0)) / len(diffs)
    if mean_sq <= 0:
        # A perfectly flat series has no trend and no scale to measure one
        # against. Returning zero would be a claim; returning None is the
        # truth, and the strategy handles a missing feature explicitly.
        return None
    scale = dec(str(float(mean_sq) ** 0.5))
    return (quick - base) / scale


@feature("breakout_position", lookback=32, lag=0)
def breakout_position(prices: Sequence[Dec], window: int = 32) -> Optional[Dec]:
    """Where price sits in its recent range, scaled to [-1, 1].

    +1 is a new high for the window, -1 a new low, 0 the middle. A second,
    largely independent view of the same phenomenon as :func:`ewmac`: a moving
    average crossover can be positive while price is well below its recent
    high, and requiring both to agree is a cheap way to avoid buying the
    retracement inside a trend that has already turned.

    >>> breakout_position([dec(100 + i) for i in range(40)])
    Decimal('1')
    >>> breakout_position([dec(100)] * 40) is None
    True
    """
    if len(prices) < window:
        return None
    recent = list(prices[-window:])
    high, low = max(recent), min(recent)
    if high == low:
        return None
    mid = (high + low) / dec(2)
    return (recent[-1] - mid) / ((high - low) / dec(2))


@feature("downside_volatility", lookback=8, lag=0)
def downside_volatility(prices: Sequence[Dec]) -> Optional[Dec]:
    """Root-mean-square of the negative returns only.

    Total volatility treats a sharp rally and a sharp collapse as the same
    thing. For sizing they are not: the risk being managed is the drawdown,
    and a strategy sized off total volatility is under-sized in a melt-up and
    over-sized in a crash - exactly backwards.

    >>> downside_volatility([dec(100), dec(101), dec(102)])
    Decimal('0')
    >>> downside_volatility([dec(100), dec(90)]) > 0
    True
    """
    if len(prices) < 2:
        return None
    downs: List[Dec] = []
    for prev, cur in zip(prices, prices[1:]):
        if prev <= 0:
            return None
        ret = (cur - prev) / prev
        if ret < 0:
            downs.append(ret)
    if not downs:
        return dec(0)
    mean_sq = sum((r * r for r in downs), dec(0)) / len(downs)
    return dec(str(float(mean_sq) ** 0.5))


@feature("atr", lookback=8, lag=0)
def atr(prices: Sequence[Dec], window: int = 8) -> Optional[Dec]:
    """Average absolute move, as a fraction of price. A stop distance in units
    the market chooses rather than ones we do.

    A stop at a fixed percentage is a stop that is far too tight in a volatile
    week and far too loose in a quiet one, which means it is a stop that gets
    hit by noise precisely when noise is large.

    >>> atr([dec(100), dec(102), dec(101), dec(103)], window=3) > 0
    True
    """
    if len(prices) < 2:
        return None
    recent = list(prices[-(window + 1):])
    moves = [abs(cur - prev) / prev for prev, cur in zip(recent, recent[1:]) if prev > 0]
    if not moves:
        return None
    return sum(moves, dec(0)) / len(moves)


@feature("cascade_pressure", lookback=1, lag=0)
def cascade_pressure(liquidations: Sequence[Tuple[Dec, str]],
                     recent_volume: Dec) -> Optional[Dec]:
    """Forced flow as a share of ordinary flow. Signed: negative is forced selling.

    A liquidation is the one order in the book placed by someone who has no
    choice about the price. When enough of them arrive at once the price that
    results is not an opinion about value, it is a queue of margin calls
    clearing - and it reverts, because the sellers stop when their positions
    are gone rather than when the price is right.

    ``lag=0`` deliberately: this reads the liquidation stream, which reports
    completed executions. There is no forming bar to peek at, and the whole
    value of the signal is that it is available while the cascade is still
    running. A lag of one here would mean acting after the rebound.

    >>> cascade_pressure([(dec(50), "sell"), (dec(30), "sell")], dec(100))
    Decimal('-0.8')
    >>> cascade_pressure([], dec(100))
    Decimal('0')
    >>> cascade_pressure([(dec(1), "sell")], dec(0)) is None
    True
    """
    if recent_volume <= 0:
        return None
    if not liquidations:
        return dec(0)
    signed = dec(0)
    for quantity, side in liquidations:
        # A long being liquidated is sold into the book. Binance reports the
        # side of the *order that closes the position*, so a forced sale
        # carries side "sell" and pushes the price down.
        signed += -quantity if side == "sell" else quantity
    return signed / recent_volume
