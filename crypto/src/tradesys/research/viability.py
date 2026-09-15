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
    "EdgeProfile",
    "Viability",
    "assess",
    "STRATEGY_PROFILES",
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


# --------------------------------------------------------------------------
# The general case
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class EdgeProfile:
    """One strategy's claim about its own economics, stated so it can be checked.

    Writing it down in this shape is most of the value. A strategy whose author
    cannot say what the average winner is, how often it wins, and how many
    fills a round trip takes has not got a strategy - it has a backtest. And
    the three numbers together decide whether it can ever clear the cost gate,
    before a single line of it is run.

    The numbers are **priors, not results**. They come from the mechanism the
    strategy claims to exploit, and the point of writing them down first is
    that the backtest then either confirms them or contradicts them - either of
    which is information. A prior written after the backtest is not a prior.
    """

    name: str
    #: Average absolute move captured on a winning trade, as a fraction.
    win_move: Dec
    #: Average absolute move given up on a loser, as a fraction. For a stopped
    #: strategy this is roughly the stop distance.
    loss_move: Dec
    #: Fraction of trades that win. Trend following is famously around 0.35,
    #: and a strategy claiming 0.8 needs to explain why.
    hit_rate: Dec
    #: Fills per complete round trip. Two for a single leg, four for a pair.
    #: This is the number most often halved by accident.
    fills: int
    #: Legs that must cross the spread rather than rest.
    crossing_legs: int
    #: Round trips per year. Capacity and the cost ratio pull in opposite
    #: directions through this term.
    trips_per_year: int
    #: Conditional drift after a resting fill, in basis points. Per profile
    #: rather than global, because it genuinely differs by strategy and
    #: burying it in a default hides the single most arguable number here.
    #:
    #: 2bp is the right order for a directional maker. A **delta-neutral pair**
    #: is different in kind, not degree: adverse selection is directional
    #: drift, and a position with no delta is not exposed to it. What remains
    #: is drift in the *basis* between the two legs, which is roughly an order
    #: of magnitude smaller. That is a structural argument rather than an
    #: optimistic one, and it is stated here so it can be attacked.
    adverse_bps: Dec = dec("2")
    note: str = ""

    @property
    def expected_gross(self) -> Dec:
        """Expected move per trade before costs. Can be negative, and should be
        allowed to be: a profile whose arithmetic does not work is worth seeing
        rather than worth rejecting at construction."""
        return (self.hit_rate * self.win_move
                - (dec(1) - self.hit_rate) * self.loss_move)


@dataclass(frozen=True)
class Viability:
    profile: EdgeProfile
    structure: CostStructure
    round_trip_cost: Dec
    expected_gross: Dec

    @property
    def cost_share(self) -> Optional[Dec]:
        """Costs as a fraction of gross. ``None`` when gross is not positive,
        because a ratio against a negative denominator is not a cost share, it
        is a strategy that loses money before costs."""
        if self.expected_gross <= 0:
            return None
        return self.round_trip_cost / self.expected_gross

    @property
    def clears(self) -> bool:
        share = self.cost_share
        return share is not None and share <= COST_GATE

    @property
    def net_per_trade(self) -> Dec:
        return self.expected_gross - self.round_trip_cost

    @property
    def net_annual(self) -> Dec:
        """Net return per unit of notional deployed per trade, per year.

        Not a return on capital: a strategy trading 20 times a year at 1% of
        notional each is not making 20% on equity unless it is fully deployed
        every time, which it is not. It is an upper bound, and it is quoted
        because a strategy that fails even the upper bound needs no further
        analysis.
        """
        return self.net_per_trade * dec(self.profile.trips_per_year)

    def __str__(self) -> str:
        share = self.cost_share
        share_text = f"{float(share) * 100:5.1f}%" if share is not None else "  n/a"
        verdict = "CLEARS" if self.clears else ("fails" if share is not None
                                                else "NEGATIVE EDGE")
        return (f"{self.profile.name:<24} "
                f"gross {float(self.expected_gross) * 100:6.3f}%  "
                f"cost {float(self.round_trip_cost) * 100:5.3f}%  "
                f"share {share_text}  "
                f"net/yr {float(self.net_annual) * 100:7.1f}%  {verdict}")


def assess(profile: EdgeProfile, maker: Dec = dec("0.0002"),
           taker: Dec = dec("0.0005"), slippage_bps: Dec = dec("1")) -> Viability:
    """Cost share of gross for any strategy, from its own stated economics.

    >>> profile = EdgeProfile("demo", dec("0.12"), dec("0.04"), dec("0.35"),
    ...                       fills=2, crossing_legs=0, trips_per_year=12)
    >>> assess(profile).clears
    True
    >>> round(float(assess(profile).cost_share), 3)
    0.05
    """
    structure = CostStructure(
        maker_rate=maker, taker_rate=taker,
        crossing_legs=profile.crossing_legs,
        slippage_bps=slippage_bps, adverse_selection_bps=profile.adverse_bps,
        label=profile.name,
    )
    crossing_fills = min(profile.crossing_legs * 2, profile.fills)
    resting_fills = profile.fills - crossing_fills
    cost = (crossing_fills * (taker + slippage_bps / dec(10_000))
            + resting_fills * (maker + profile.adverse_bps / dec(10_000)))
    return Viability(profile, structure, cost, profile.expected_gross)


#: What each strategy in this repository claims about itself. Committed, dated
#: by the git history, and compared against measured results in each strategy's
#: specification. Where a measurement contradicts one of these, the profile is
#: what gets corrected - and the correction is recorded, because a prior
#: quietly edited to match a result was never a prior.
STRATEGY_PROFILES: Tuple[EdgeProfile, ...] = (
    EdgeProfile(
        "trend", win_move=dec("0.12"), loss_move=dec("0.04"), hit_rate=dec("0.35"),
        fills=2, crossing_legs=0, trips_per_year=14,
        note="Wins rarely and large. The hit rate is the documented one for "
             "time-series momentum across asset classes; claiming better needs "
             "an argument. One leg, resting entry, stop crosses.",
    ),
    EdgeProfile(
        "cascade", win_move=dec("0.018"), loss_move=dec("0.012"), hit_rate=dec("0.62"),
        fills=2, crossing_legs=1, trips_per_year=30,
        note="Wins often and small, and pays the spread on purpose: the premise "
             "is that liquidity vanished, so an order that waits for a better "
             "price waits for the edge to close.",
    ),
    EdgeProfile(
        "funding_dispersion", win_move=dec("0.0084"), loss_move=dec("0.0015"),
        hit_rate=dec("0.70"), fills=4, crossing_legs=1, trips_per_year=10,
        adverse_bps=dec("0.5"),
        note="Delta-neutral, so adverse selection is on the basis rather than "
             "the price - but ONE LEG CROSSES. The first profile said zero, on "
             "the argument that neither leg chases the other; the measurement "
             "showed a resting buy does not fill in a rising market whatever "
             "the other leg is doing. Threshold and trip count were both "
             "re-derived from the corrected cost, which is why the trips fell "
             "from 26 to 10: a 0.07% differential is rarer than a 0.05% one.",
    ),
    EdgeProfile(
        "funding_carry", win_move=dec("0.0021"), loss_move=dec("0.0015"),
        hit_rate=dec("0.65"), fills=4, crossing_legs=1, trips_per_year=18,
        note="The one that does not clear, at baseline funding. The 69% "
             "measured in the demo is the SPIKE case - funding at 0.09% per "
             "interval - and this profile is the ordinary one, which is worse. "
             "Gross is the funding LEVEL over the hold, and one leg must cross "
             "into a trending market (ADR 0004).",
    ),
)
