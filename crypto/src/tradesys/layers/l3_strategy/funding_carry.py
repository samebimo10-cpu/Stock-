"""Funding rate carry - the Tier 1 strategy of SPEC section 2.1.

Long spot, short perpetual when funding is strongly positive; collect funding.
Market-neutral. Modest returns, high Sharpe, genuinely robust, and the only
Tier 1 edge that does not require sub-50ms execution - which is why it is the
Track A starting strategy.

The part worth reading is :meth:`FundingCarry._breakeven_blocks`. The strategy
refuses to enter when the funding rate cannot cover the round trip within the
maximum holding period, which at tier-0 fees and baseline funding means a
ten-day hold. A carry strategy without that check collects funding the whole
time and still loses money, which is a failure that looks like success on
every dashboard except the profit and loss.

Economic rationale, per the SPEC section 6.1 template:

* **Counterparty:** leveraged longs paying to keep perpetual exposure during
  bullish sentiment, and the market makers who warehouse their flow.
* **Why they trade against me:** they want leveraged spot exposure without
  posting spot collateral, and will pay a recurring fee for it.
* **Why it persists:** funding is a mechanism, not a mispricing. It exists to
  tether the perpetual to spot, and someone must take the other side.
* **What would end it:** a structural fall in leverage demand, or enough
  competing carry capital to compress funding to the cost of capital. Monitor
  the funding rate distribution itself for that.
* **Where the tail is:** short volatility in disguise. It earns steadily and
  loses in a cluster when a funding regime flips and the short perp leg gaps
  against you while spot is illiquid. Size for the cluster, not the average.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional, Sequence

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec
from ...costs import carry_breakeven_periods
from ...core.ids import new_correlation_id
from .base import StrategyHealth, StrategyState

__all__ = ["FundingCarryParams", "FundingCarry"]


@dataclass(frozen=True)
class FundingCarryParams:
    """Five free parameters. The SPEC section 6.1 hard limit is six.

    Staying under the limit is a design constraint, not a coincidence: more
    than five or six free parameters on a single strategy is how a backtest
    learns the sample.
    """

    #: Enter when the funding z-score exceeds this. A z-score rather than a
    #: raw rate, because raw funding is not comparable across assets or
    #: regimes.
    entry_z: Dec = dec("1.5")
    #: Exit when it falls back below this. Below entry_z, so the position does
    #: not thrash at the boundary.
    exit_z: Dec = dec("0.5")
    #: Round-trip cost as a fraction of notional, at the ACTUAL fee tier.
    round_trip_cost: Dec = dec("0.003")
    #: Longest we are willing to hold, in funding intervals. Tier-0 fees at
    #: baseline funding need exactly 30 of them, so a default of 30 would admit
    #: a trade with zero expected profit. 21 intervals is seven days and leaves
    #: the margin that makes the check worth having.
    max_hold_intervals: int = 21
    #: Target notional per unit of confidence.
    base_notional: Dec = dec("1000")
    #: Venue holding the spot leg. Empty means **unhedged**, which the strategy
    #: refuses to run beyond research: without the spot leg this is a short
    #: perpetual, not carry, and its profit and loss is dominated by price
    #: direction rather than by funding.
    spot_venue: str = ""
    #: Venue holding the perpetual. Empty follows the snapshot's own venue.
    perp_venue: str = ""
    #: How the hedge leg executes. ``maker_preferred`` posts at the near touch
    #: and crosses only if it has not filled by the fallback deadline, which
    #: pays the rebate in the common case and still hedges in the uncommon
    #: one. ``aggressive`` crosses immediately and is certain but expensive:
    #: on this strategy it takes costs from roughly a quarter of gross profit
    #: to roughly two thirds.
    hedge_urgency: str = "maker_preferred"

    def as_dict(self) -> dict:
        return {
            "entry_z": str(self.entry_z), "exit_z": str(self.exit_z),
            "round_trip_cost": str(self.round_trip_cost),
            "max_hold_intervals": self.max_hold_intervals,
            "base_notional": str(self.base_notional),
            "spot_venue": self.spot_venue,
            "perp_venue": self.perp_venue,
            "hedge_urgency": self.hedge_urgency,
        }


class FundingCarry:
    """Emits desired exposure. Never touches an order."""

    def __init__(self, strategy_id: str = "funding_carry",
                 params: Optional[FundingCarryParams] = None,
                 signal_ttl_ns: int = 60_000_000_000) -> None:
        self.strategy_id = strategy_id
        self.params = params or FundingCarryParams()
        self.signal_ttl_ns = signal_ttl_ns
        self.health = StrategyHealth(strategy_id=strategy_id, state=StrategyState.RESEARCH)
        self._in_position = False
        #: Why the last evaluation produced nothing. Surfaced on the health
        #: endpoint, because "no signal" and "refused to trade" look identical
        #: from outside and mean different things.
        self.last_veto: Optional[str] = None

    # -- the contract ----------------------------------------------------

    @property
    def is_hedged(self) -> bool:
        return bool(self.params.spot_venue)

    def on_features(self, snapshot: FeatureSnapshot) -> Sequence[Signal]:
        self.last_veto = None

        # The hedge is a precondition, not an optimisation. An unhedged carry
        # book is a directional short wearing a market-neutral label, and its
        # losses arrive from price rather than from funding. Research may run
        # it to exercise the pipeline; nothing past research may.
        if not self.is_hedged and self.health.state != StrategyState.RESEARCH:
            self.last_veto = (
                f"unhedged carry is not approved in state {self.health.state!r}: "
                "set spot_venue, or this is a short perpetual rather than carry"
            )
            return ()

        # A missing feature is handled explicitly. It is never imputed.
        if not snapshot.require("funding_zscore", "annualised_funding", "microprice"):
            self.last_veto = "required features missing"
            return ()

        z = snapshot.get("funding_zscore")
        annual = snapshot.get("annualised_funding")
        price = snapshot.get("microprice")
        assert z is not None and annual is not None and price is not None

        if price <= 0:
            self.last_veto = "no usable price"
            return ()

        if self._in_position:
            if z <= self.params.exit_z:
                self._in_position = False
                return self._legs(snapshot, dec(0), z, annual, reason="funding normalised")
            return ()

        if z < self.params.entry_z:
            self.last_veto = f"funding z {z:.2f} below entry {self.params.entry_z}"
            return ()

        # Funding must be positive to be collected by the short-perp leg.
        if annual <= 0:
            self.last_veto = "funding is negative; the other side is the paid one"
            return ()

        veto = self._breakeven_blocks(annual)
        if veto is not None:
            self.last_veto = veto
            return ()

        # Short the perp: negative target. The long spot leg is the paired
        # order the portfolio layer nets against; this signal is the leg that
        # earns the funding.
        qty = -(self.params.base_notional / price)
        self._in_position = True
        return self._legs(snapshot, qty, z, annual, reason="funding carry entry")

    def parameters(self) -> dict:
        return self.params.as_dict()

    # -- internals -------------------------------------------------------

    def _breakeven_blocks(self, annualised: Dec) -> Optional[str]:
        """Return a veto reason, or ``None`` when the trade clears its costs.

        Converts the annualised rate back to per-interval, asks how many
        intervals are needed to cover the round trip, and refuses if that is
        longer than we are willing to hold.
        """
        per_interval = annualised / (dec(3) * dec(365))
        needed = carry_breakeven_periods(self.params.round_trip_cost, per_interval)
        if needed is None:
            return "funding is zero or negative"
        if needed > self.params.max_hold_intervals:
            return (
                f"break-even needs {needed:.1f} funding intervals "
                f"({needed / 3:.1f} days) but we hold at most "
                f"{self.params.max_hold_intervals}"
            )
        return None

    def _legs(self, snapshot: FeatureSnapshot, target: Dec, z: Dec,
              annual: Dec, reason: str) -> List[Signal]:
        """The perpetual leg, and its spot hedge when one is configured.

        The two carry the same group id so they are filled or unwound as a
        unit. A half-filled pair is a directional position nobody asked for,
        and the unwinder exists so it does not survive a timeout.
        """
        self.health.last_signal_at = snapshot.as_of
        self.health.signals_today += 1
        self.health.current_exposure = target

        group = f"{self.strategy_id}-{snapshot.symbol}-{snapshot.as_of}" if self.is_hedged else ""
        perp_venue = self.params.perp_venue or snapshot.venue

        legs = [self._signal(snapshot, perp_venue, target, z, annual, reason,
                             group, "primary" if self.is_hedged else "single",
                             urgency="passive")]
        if self.is_hedged:
            # Equal and opposite: long spot against the short perpetual, so the
            # pair is delta-neutral and what remains is the funding.
            #
            # The hedge crosses the spread. Nobody legs into a hedge passively:
            # a resting bid does not get hit in a rising market, so the
            # perpetual fills, the spot does not, and a market-neutral pair
            # becomes a directional short. Paying the spread on one leg is the
            # price of actually being hedged, and it belongs in the cost model
            # rather than in a hopeful fill assumption.
            legs.append(self._signal(snapshot, self.params.spot_venue, -target, z,
                                     annual, f"{reason} (spot hedge)", group, "hedge",
                                     urgency=self.params.hedge_urgency))
        return legs

    def _signal(self, snapshot: FeatureSnapshot, venue: str, target: Dec, z: Dec,
                annual: Dec, reason: str, group: str, role: str,
                urgency: str = "passive") -> Signal:
        return Signal(
            correlation_id=snapshot.correlation_id,
            emitted_at=snapshot.as_of,
            source=f"l3:{self.strategy_id}",
            strategy_id=self.strategy_id,
            venue=venue,
            symbol=snapshot.symbol,
            target_position=target,
            urgency=urgency,
            limit_price=None,
            valid_until=snapshot.as_of + self.signal_ttl_ns,
            confidence=min(dec(1), abs(z) / (self.params.entry_z * 2)),
            rationale={"funding_zscore": z, "annualised_funding": annual},
            leg_group=group,
            leg_role=role,
        )
