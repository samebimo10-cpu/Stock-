"""Position sizing - one rule per strategy class (SPEC section 8.1, Annex B section 7).

v1.0 of the specification prescribes fractional Kelly across the board. Kelly
is meaningless for market making, where you quote both sides and size comes
from inventory, and actively dangerous for fat-tailed strategies, where it
sizes to ruin. v1.0 recommends both. So the rule is split here.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional, Sequence

from ...core.types import Decimal as Dec, dec

__all__ = ["fractional_kelly", "volatility_target", "conditional_loss_size",
           "correlation_adjusted_cap", "KELLY_FRACTION"]

#: Quarter-Kelly. Not arbitrary: if the true edge is half your estimate,
#: quarter-Kelly still grows the account while half-Kelly sits at the ruin
#: boundary. You are not choosing between optimal and cautious - you are
#: choosing between growth and ruin under an estimate you know is wrong.
KELLY_FRACTION = dec("0.25")


def fractional_kelly(mu_lower_95: Dec, variance: Dec,
                     fraction: Dec = KELLY_FRACTION) -> Dec:
    """Kelly fraction from the **lower bound** of the edge estimate.

    The lower confidence bound rather than the point estimate is what keeps
    Kelly usable: an edge of 2bps with a standard error of 1.5bps has a lower
    bound near zero, so it sizes to near zero - which is the right answer for
    an edge you have not actually established.

    Negative edges size to zero rather than to a short: reversing a strategy
    because its estimate came out negative is a different decision, and one
    nobody should take implicitly inside a sizing function.

    >>> fractional_kelly(dec("0.001"), dec("0.04"))
    Decimal('0.00625')
    >>> fractional_kelly(dec("-0.001"), dec("0.04"))
    Decimal('0')
    """
    if variance <= 0:
        return dec(0)
    if mu_lower_95 <= 0:
        return dec(0)
    return fraction * (mu_lower_95 / variance)


def volatility_target(base_size: Dec, target_vol: Dec, realised_vol: Dec,
                      vol_floor: Dec, max_multiple: Dec = dec(3)) -> Dec:
    """Scale size inversely to realised volatility.

    ``vol_floor`` is mandatory, not defensive programming. Without it, as
    realised volatility approaches zero the multiplier goes to infinity and
    the system takes its largest ever position immediately before the quiet
    period ends. Set the floor around the 10th percentile of the trailing
    annual volatility distribution.

    >>> volatility_target(dec("100"), dec("0.20"), dec("0.10"), dec("0.05"))
    Decimal('200')
    >>> volatility_target(dec("100"), dec("0.20"), dec("0"), dec("0.05"))
    Decimal('300')
    """
    if vol_floor <= 0:
        raise ValueError("vol_floor must be positive; without it this formula sizes to infinity")
    effective = realised_vol if realised_vol > vol_floor else vol_floor
    multiple = target_vol / effective
    if multiple > max_multiple:
        multiple = max_multiple
    return base_size * multiple


def conditional_loss_size(equity: Dec, cvar_99_per_unit: Dec,
                          risk_fraction: Dec = dec("0.01")) -> Dec:
    """Size so the 99th-percentile adverse outcome costs ``risk_fraction`` of equity.

    For fat-tailed strategies - liquidation positioning and anything that
    earns steadily and loses suddenly. ``cvar_99_per_unit`` is estimated from
    the *mechanism*, not from the sample: 200 trades contain about two tail
    events, which is not enough to estimate a tail. Ask what happens if the
    cascade runs three times further than anything in your data.

    >>> conditional_loss_size(dec("100000"), dec("50"))
    Decimal('20.00')
    """
    if cvar_99_per_unit <= 0:
        return dec(0)
    return (equity * risk_fraction) / cvar_99_per_unit


def correlation_adjusted_cap(sizes: Sequence[Dec], correlation: Dec) -> Dec:
    """Combined risk of correlated positions, as an equivalent single size.

    Two positions each at the 2% cap with correlation 0.9 carry the risk of a
    single 3.9% position while both individual limits report green. That is
    why the cap applies to the correlation *cluster* and not to its members.

    >>> correlation_adjusted_cap([dec("2"), dec("2")], dec("0.9"))
    Decimal('3.899')
    """
    if not sizes:
        return dec(0)
    total_sq = sum((s * s for s in sizes), dec(0))
    cross = dec(0)
    for i in range(len(sizes)):
        for j in range(i + 1, len(sizes)):
            cross += 2 * correlation * sizes[i] * sizes[j]
    combined = total_sq + cross
    if combined <= 0:
        return dec(0)
    return dec(str(round(float(combined) ** 0.5, 3)))
