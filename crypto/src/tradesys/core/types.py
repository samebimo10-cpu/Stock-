"""Scalar domain types.

SPEC Annex A section 1. Two rules carry real weight here:

* **Money, prices and quantities are Decimal everywhere**, including in the
  backtester. A float rounding error that moves a quantity below ``stepSize``
  produces a rejection in production and a successful fill in a float-based
  backtest, and that divergence costs a day to find.
* **Timestamps are integer nanoseconds.** Never a float: float64 loses
  nanosecond resolution past 2004, which is a silent precision bug.
"""

from __future__ import annotations

import time
from decimal import Decimal, ROUND_DOWN, ROUND_UP, localcontext
from typing import Union

__all__ = [
    "Decimal",
    "Nanos",
    "dec",
    "now_ns",
    "ns_to_ms",
    "ms_to_ns",
    "floor_to",
    "round_price_conservative",
    "ZERO",
    "ONE",
]

Nanos = int
ZERO = Decimal("0")
ONE = Decimal("1")

_Numeric = Union[str, int, Decimal]


def dec(value: _Numeric) -> Decimal:
    """Convert to :class:`~decimal.Decimal`, refusing floats.

    Floats are rejected rather than converted. ``Decimal(0.1)`` is
    ``0.1000000000000000055511151231257827021181583404541015625``, and once
    that enters a quantity it stays there. Callers holding a float have a bug
    upstream; converting it here would hide the bug rather than fix it.

    >>> dec("1.5") + dec(2)
    Decimal('3.5')
    >>> dec(0.1)                                    # doctest: +ELLIPSIS
    Traceback (most recent call last):
        ...
    TypeError: refusing to build a Decimal from float 0.1; ...
    """
    if isinstance(value, float):
        raise TypeError(
            f"refusing to build a Decimal from float {value!r}; "
            "pass a str or int (SPEC Annex A section 1)"
        )
    if isinstance(value, Decimal):
        return value
    return Decimal(value)


def now_ns() -> Nanos:
    """Wall-clock nanoseconds since the Unix epoch, UTC."""
    return time.time_ns()


def ns_to_ms(ns: Nanos) -> int:
    return ns // 1_000_000


def ms_to_ns(ms: int) -> Nanos:
    return ms * 1_000_000


def floor_to(value: Decimal, step: Decimal) -> Decimal:
    """Round ``value`` DOWN to a multiple of ``step``.

    Quantities always round down (SPEC section 17.4). Rounding up can push an
    order above a position limit that risk already approved against the
    pre-rounding number, which turns a rounding helper into a limit bypass.

    >>> floor_to(dec("1.23456"), dec("0.001"))
    Decimal('1.234')
    """
    if step <= 0:
        raise ValueError(f"step must be positive, got {step}")
    with localcontext() as ctx:
        ctx.prec = 40
        return (value / step).to_integral_value(rounding=ROUND_DOWN) * step


def round_price_conservative(price: Decimal, tick: Decimal, side: str) -> Decimal:
    """Round a limit price to ``tick`` without making the order more aggressive.

    Buys round down, sells round up. The rounding never improves the price the
    strategy is willing to pay, so a rounding step cannot turn a passive order
    into one that crosses.

    >>> round_price_conservative(dec("100.7"), dec("0.5"), "buy")
    Decimal('100.5')
    >>> round_price_conservative(dec("100.7"), dec("0.5"), "sell")
    Decimal('101.0')
    """
    if tick <= 0:
        raise ValueError(f"tick must be positive, got {tick}")
    if side not in ("buy", "sell"):
        raise ValueError(f"side must be 'buy' or 'sell', got {side!r}")
    with localcontext() as ctx:
        ctx.prec = 40
        rounding = ROUND_DOWN if side == "buy" else ROUND_UP
        return (price / tick).to_integral_value(rounding=rounding) * tick
