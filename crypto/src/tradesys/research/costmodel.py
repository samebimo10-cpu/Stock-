"""The cost model (SPEC section 11.1, Annex B).

A backtest without an honest cost model is a random number generator with good
graphics.

The review heuristic is the best single sanity check in the specification and
is implemented as :meth:`CostModel.review_check`: if modelling costs properly
does not cut backtest returns by at least 30%, the model is wrong - not the
strategy. Go and find what is missing.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple

from ..core.types import Decimal as Dec, dec

__all__ = [
    "FeeModel", "CostModel", "TradeCost",
    "slippage_cost", "market_impact_bps",
    "funding_carry", "carry_breakeven_periods", "maker_edge_bps",
    "UNFILLABLE",
]

#: Returned when the book cannot fill the requested size. Must propagate: a
#: backtester that fills the remainder at the last level's price models
#: infinite liquidity at exactly the moment the strategy needs the truth.
UNFILLABLE = None

Level = Tuple[Dec, Dec]


# --------------------------------------------------------------------------
# Fees
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class FeeModel:
    """Fees at the **actual** tier.

    ``tier_schedule`` maps a 30-day volume floor to (maker, taker). Modelling
    the tier as a function of trailing volume rather than as a constant is
    what stops a backtest assuming VIP 4 throughout while the live account
    sits at VIP 1 for the first two months - which is wrong in exactly the
    period that decides whether the project continues.
    """

    maker_rate: Dec
    taker_rate: Dec
    bnb_discount: Dec = dec(0)
    tier_schedule: Tuple[Tuple[Dec, Dec, Dec], ...] = ()

    def rates_for_volume(self, volume_30d: Dec) -> Tuple[Dec, Dec]:
        if not self.tier_schedule:
            return self.maker_rate, self.taker_rate
        maker, taker = self.maker_rate, self.taker_rate
        for floor, m, t in sorted(self.tier_schedule, key=lambda r: r[0]):
            if volume_30d >= floor:
                maker, taker = m, t
        return maker, taker

    def fee(self, notional: Dec, is_maker: bool, volume_30d: Dec = dec(0)) -> Dec:
        maker, taker = self.rates_for_volume(volume_30d)
        rate = maker if is_maker else taker
        return notional * rate * (dec(1) - self.bnb_discount)


# --------------------------------------------------------------------------
# Slippage and impact
# --------------------------------------------------------------------------


def slippage_cost(book_side: Sequence[Level], quantity: Dec,
                  reference_price: Dec) -> Optional[Dec]:
    """Walk real depth. ``None`` when the book cannot fill the size.

    Never a flat percentage (Annex B section 2).

    >>> slippage_cost([(dec("101"), dec("1")), (dec("102"), dec("1"))], dec("2"), dec("100"))
    Decimal('3.0')
    """
    filled = dec(0)
    cost = dec(0)
    for price, qty in book_side:
        take = min(qty, quantity - filled)
        cost += take * price
        filled += take
        if filled >= quantity:
            avg = cost / filled
            return abs(avg - reference_price) * quantity
    return UNFILLABLE


def market_impact_bps(quantity: Dec, daily_volume: Dec, daily_vol_bps: Dec,
                      y: Dec = dec(1)) -> Dec:
    """Square-root law impact.

    ``y`` defaults to 1.0, which is pessimistic. Calibrate it from your own
    TCA data rather than adopting a literature value; being pessimistic before
    you have data is how you avoid deploying on an assumption.

    >>> market_impact_bps(dec("100"), dec("10000"), dec("200"))
    Decimal('20.0')
    """
    if daily_volume <= 0:
        raise ValueError("daily_volume must be positive")
    ratio = float(quantity) / float(daily_volume)
    return y * daily_vol_bps * dec(str(round(ratio ** 0.5, 6)))


# --------------------------------------------------------------------------
# Funding carry (Annex B section 4)
# --------------------------------------------------------------------------


def funding_carry(notional: Dec, rate_per_interval: Dec, intervals_held: int) -> Dec:
    """Funding collected (or paid) over a holding period."""
    return notional * rate_per_interval * dec(intervals_held)


def carry_breakeven_periods(round_trip_cost_frac: Dec, rate_per_interval: Dec) -> Optional[Dec]:
    """Funding intervals needed before a carry trade covers its own costs.

    The number that decides whether to enter at all. At tier-0 fees a round
    trip costs about 0.30% and baseline funding is 0.01% per 8 hours, which is
    **thirty intervals - ten days**. A strategy that enters and exits on a
    two-day funding excursion loses money at tier 0 while appearing to collect
    funding the whole time.

    Returns ``None`` when funding is zero or the wrong sign, which means the
    trade never breaks even and the correct action is not to enter.

    >>> carry_breakeven_periods(dec("0.003"), dec("0.0001"))
    Decimal('3E+1')
    >>> carry_breakeven_periods(dec("0.003"), dec("-0.0001")) is None
    True
    """
    if rate_per_interval <= 0:
        return None
    return round_trip_cost_frac / rate_per_interval


def maker_edge_bps(spread_captured_bps: Dec, adverse_selection_bps: Dec,
                   maker_fee_bps: Dec) -> Dec:
    """Edge per market-making round trip. Negative means do not build this.

    ``maker_fee_bps`` is negative when the tier pays a rebate. The worked
    example in Annex B section 5.1: capturing half of a 1bp spread while
    paying a 2bp maker fee against 1.5bp of adverse selection is about -5bp
    per round trip, **before** any inventory risk, latency disadvantage or
    competition. No amount of quoting sophistication repairs a fee structure
    that costs four times the spread you are capturing.

    >>> maker_edge_bps(dec("0.5"), dec("1.5"), dec("2"))
    Decimal('-5.0')
    """
    return spread_captured_bps - adverse_selection_bps - 2 * maker_fee_bps


# --------------------------------------------------------------------------
# The assembled model
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class TradeCost:
    fees: Dec
    slippage: Dec
    impact: Dec
    adverse_selection: Dec
    funding: Dec
    borrow: Dec

    @property
    def total(self) -> Dec:
        return self.fees + self.slippage + self.impact + self.adverse_selection + self.funding + self.borrow

    def as_dict(self):
        return {
            "fees": self.fees, "slippage": self.slippage, "impact": self.impact,
            "adverse_selection": self.adverse_selection, "funding": self.funding,
            "borrow": self.borrow, "total": self.total,
        }


@dataclass
class CostModel:
    """Every component of Annex B section 8, assembled."""

    fees: FeeModel
    #: Conditional drift after a maker fill, in bps. Always positive for a
    #: naive maker: you are filled preferentially when the price is about to
    #: move against you. If your estimate is zero or negative, the estimator
    #: is wrong, not the market.
    adverse_selection_bps: Dec = dec(0)
    impact_y: Dec = dec(1)
    borrow_rate_per_day: Dec = dec(0)

    def round_trip(
        self,
        notional: Dec,
        *,
        entry_maker: bool = False,
        exit_maker: bool = False,
        entry_slippage: Dec = dec(0),
        exit_slippage: Dec = dec(0),
        quantity: Optional[Dec] = None,
        daily_volume: Optional[Dec] = None,
        daily_vol_bps: Dec = dec(0),
        funding_paid: Dec = dec(0),
        days_held: Dec = dec(0),
        is_short: bool = False,
        volume_30d: Dec = dec(0),
    ) -> TradeCost:
        fees = (self.fees.fee(notional, entry_maker, volume_30d)
                + self.fees.fee(notional, exit_maker, volume_30d))

        impact = dec(0)
        if quantity is not None and daily_volume is not None and daily_volume > 0:
            bps = market_impact_bps(quantity, daily_volume, daily_vol_bps, self.impact_y)
            # Round trip pays temporary impact twice.
            impact = notional * bps / dec(10_000) * 2

        adverse = dec(0)
        for maker in (entry_maker, exit_maker):
            if maker:
                adverse += notional * self.adverse_selection_bps / dec(10_000)

        borrow = notional * self.borrow_rate_per_day * days_held if is_short else dec(0)

        return TradeCost(
            fees=fees,
            slippage=entry_slippage + exit_slippage,
            impact=impact,
            adverse_selection=adverse,
            funding=funding_paid,
            borrow=borrow,
        )

    @staticmethod
    def review_check(gross_return: float, net_return: float) -> Tuple[bool, str]:
        """The 30% heuristic (SPEC section 11.1).

        If modelling costs properly does not cut returns by at least 30%, the
        **model** is wrong. Not the strategy.

        >>> CostModel.review_check(0.40, 0.35)[0]
        False
        >>> CostModel.review_check(0.40, 0.20)[0]
        True
        """
        if gross_return <= 0:
            return True, "gross return is not positive; the heuristic does not apply"
        cut = (gross_return - net_return) / gross_return
        if cut < 0.30:
            return False, (
                f"costs cut returns by only {cut:.1%}. Below 30% the cost model is "
                "probably incomplete - check queue position, adverse selection, "
                "fee tier decay and funding on the inverted side"
            )
        return True, f"costs cut returns by {cut:.1%}"
