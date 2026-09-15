"""What would have to be true for a strategy to be worth trading.

The demo carry strategy spends about 69% of its gross profit on costs against a
40% gate (SPEC section 11.1). That is a finding, not a bug, and it was recorded
rather than tuned away. But "it fails" is a poor place to stop: the useful
question is what it would take to pass, and whether anything can supply it.

This module answers that with arithmetic rather than opinion. The result is a
specification for what to look for next, and - just as often - a demonstration
that nothing reachable supplies it, which saves the months that would otherwise
go into finding that out empirically.

The arithmetic is deliberately simple, and that is a feature. Every term is one
a trader can argue with:

    gross over N intervals   = N x rate x notional
    round trip cost          = c x notional         (four fills, two legs)
    cost share of gross      = c / (N x rate)
    the gate                 = cost share <= 0.40

so the gate is cleared exactly when ``N x rate >= 2.5c``. Everything below is
that inequality, solved for whichever term is in question.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import List, Optional, Sequence, Tuple

from ..core.types import Decimal as Dec, dec

__all__ = [
    "COST_GATE",
    "CostStructure",
    "CarryRequirement",
    "carry_requirement",
    "BINANCE_SPOT_TIERS",
    "BINANCE_FUTURES_TIERS",
    "OBSERVED_FUNDING",
    "survey",
]

#: SPEC section 11.1. Above this share of gross, the strategy is a fee-paying
#: machine that occasionally leaves something over.
COST_GATE = dec("0.40")


@dataclass(frozen=True)
class CostStructure:
    """What one round trip of a two-leg carry trade costs, as a fraction.

    Four fills: open perp, open spot, close perp, close spot. Modelling it as
    two is the single most common way a carry backtest halves its own costs.
    """

    maker_rate: Dec
    taker_rate: Dec
    #: Legs that cross. The hedge leg must (ADR 0004), so one is the floor for
    #: a strategy that is actually hedged.
    crossing_legs: int = 2
    #: Half-spread paid on each crossing fill, in basis points.
    slippage_bps: Dec = dec("1")
    #: Conditional drift after a maker fill. Positive for a naive maker, always.
    adverse_selection_bps: Dec = dec("2")
    label: str = ""

    @property
    def fills(self) -> int:
        return 4

    def round_trip_fraction(self) -> Dec:
        """Total cost as a fraction of one leg's notional.

        Four crossing fills at tier-0 futures fees: 4 x 5bps of fee plus 4 x
        1bp of half-spread.

        >>> tier0 = CostStructure(dec("0.0002"), dec("0.0005"))
        >>> round(float(tier0.round_trip_fraction()), 5)
        0.0024
        """
        crossing = min(self.crossing_legs * 2, self.fills)   # both ends of a leg
        resting = self.fills - crossing
        fees = crossing * self.taker_rate + resting * self.maker_rate
        slip = crossing * self.slippage_bps / dec(10_000)
        adverse = resting * self.adverse_selection_bps / dec(10_000)
        return fees + slip + adverse


@dataclass(frozen=True)
class CarryRequirement:
    """What the market would have to pay for this cost structure to clear."""

    structure: CostStructure
    hold_intervals: int
    round_trip_cost: Dec
    required_rate: Dec
    #: Intervals needed at a given observed rate, or ``None`` if never.
    intervals_at_observed: Optional[Dec]
    observed_rate: Dec

    @property
    def clears(self) -> bool:
        return self.observed_rate >= self.required_rate

    @property
    def required_annualised(self) -> Dec:
        """The required per-interval rate as an annual percentage.

        Three eight-hour intervals a day, 365 days. Quoted because a
        per-interval funding rate is a number nobody has intuition about, and
        an annualised one is immediately comparable to every other yield.
        """
        return self.required_rate * dec(3 * 365)

    def __str__(self) -> str:
        verdict = "CLEARS" if self.clears else "fails"
        return (f"{self.structure.label or 'structure':<28} "
                f"cost {float(self.round_trip_cost) * 100:5.3f}%  "
                f"needs {float(self.required_rate) * 100:6.4f}%/8h "
                f"({float(self.required_annualised) * 100:6.1f}% ann.)  "
                f"{verdict}")


def carry_requirement(structure: CostStructure, hold_intervals: int = 21,
                      observed_rate: Dec = dec("0.0001")) -> CarryRequirement:
    """Solve the gate for the funding rate.

    ``N x rate >= 2.5c``, so ``rate >= 2.5c / N``.

    >>> req = carry_requirement(CostStructure(dec("0.0002"), dec("0.0005")))
    >>> round(float(req.required_rate), 6)
    0.000286
    >>> req.clears
    False
    >>> float(req.intervals_at_observed)      # at baseline funding, 20 days
    60.0
    """
    if hold_intervals <= 0:
        raise ValueError("a holding period of zero intervals collects no funding")
    cost = structure.round_trip_fraction()
    required = cost / COST_GATE / dec(hold_intervals)
    at_observed = (cost / COST_GATE / observed_rate) if observed_rate > 0 else None
    return CarryRequirement(structure, hold_intervals, cost, required,
                            at_observed, observed_rate)


# --------------------------------------------------------------------------
# The numbers the requirement is judged against
# --------------------------------------------------------------------------

#: (label, maker, taker). Binance spot, as published. Re-verify before relying
#: on these: fee schedules change, and a stale schedule flatters a backtest in
#: exactly the direction that keeps a bad strategy alive.
BINANCE_SPOT_TIERS: Tuple[Tuple[str, Dec, Dec], ...] = (
    ("VIP 0", dec("0.001"), dec("0.001")),
    ("VIP 1 (1m USDT)", dec("0.0009"), dec("0.001")),
    ("VIP 4 (150m USDT)", dec("0.00042"), dec("0.0006")),
    ("VIP 9 (4bn USDT)", dec("0.00012"), dec("0.00024")),
)

#: USD-M futures, where the funding actually is.
BINANCE_FUTURES_TIERS: Tuple[Tuple[str, Dec, Dec], ...] = (
    ("VIP 0", dec("0.0002"), dec("0.0005")),
    ("VIP 3 (25m USDT)", dec("0.00014"), dec("0.00032")),
    ("VIP 6 (400m USDT)", dec("0.00008"), dec("0.00024")),
    ("VIP 9 (4bn USDT)", dec("0.0000"), dec("0.00017")),
)

#: Per-eight-hour funding, as it behaves rather than as it is quoted.
#: Baseline is the interest-rate component the venue applies when the basis is
#: flat; the rest are regimes, not forecasts.
OBSERVED_FUNDING: Tuple[Tuple[str, Dec], ...] = (
    ("baseline", dec("0.0001")),
    ("mildly crowded", dec("0.0003")),
    ("crowded", dec("0.0007")),
    ("mania (days, not weeks)", dec("0.0020")),
)


def survey(tiers: Sequence[Tuple[str, Dec, Dec]] = BINANCE_FUTURES_TIERS,
           hold_intervals: int = 21,
           crossing_legs: int = 1,
           observed_rate: Dec = dec("0.0001")) -> List[CarryRequirement]:
    """One requirement per fee tier, at a fixed execution style.

    ``crossing_legs=1`` is the honest floor: the hedge leg must cross (ADR
    0004), so a fully passive carry trade is not one that stays hedged.
    """
    out = []
    for label, maker, taker in tiers:
        out.append(carry_requirement(
            CostStructure(maker, taker, crossing_legs=crossing_legs, label=label),
            hold_intervals=hold_intervals, observed_rate=observed_rate))
    return out
