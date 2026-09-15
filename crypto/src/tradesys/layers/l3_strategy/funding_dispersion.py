"""Cross-venue funding dispersion: carry on the differential, not the level.

**What was wrong with the first carry strategy.** It shorted a perpetual and
hedged with spot to collect funding. Two problems, and the second is fatal.
Funding is elevated *because* longs are crowded, longs are crowded while price
is rising, and a rising price is what makes the passive hedge fail to fill
(ADR 0004) - so the condition that makes the trade worth doing is the condition
that makes it hard to execute. And the level of funding is small: 0.01% per
eight hours at baseline against a 0.20% round trip, which is why it needs
twenty days to break even and fails the cost gate at 69%.

**What is different here.** Both legs are perpetuals, on two venues, in
opposite directions. The position is delta-neutral by construction - not by a
hedge that has to be chased, but because the two legs are the same instrument.
And the gross is the *spread* between two venues' funding rates, which is
routinely several times either venue's level: venues clear their own order
flow, and a venue whose users are crowded long pays while one whose users are
crowded short receives.

That raises the gross substantially: dispersion of 0.03-0.08% per interval
happens, against a level of 0.01%.

**It does not lower the cost, and the first version of this file claimed it
did.** The claim was that both legs could rest, because neither is chasing the
other's price. Running it proved otherwise within one scenario: the two legs
are on opposite *sides*, one buying and one selling, and in a rising market a
resting buy does not fill while a resting sell does. The taker fallback fired
on the buy leg every time, and the leg that crossed cost exactly what the
hedged carry's crossing leg costs.

The lesson generalises and is worth more than the strategy: **delta-neutrality
protects the position, not the entry.** Legging into a neutral position in a
trending market has the same problem as legging into a hedge, because the
problem was never about net exposure - it was about one side of a two-sided
order pair being on the wrong side of a moving price. ADR 0004 found this for
the hedged carry; it applies to anything with two legs.

So the cost model here is one crossing leg, the entry threshold is set from
that cost rather than from the claim, and the honest verdict is below.

**What it costs instead, and this is a real trade rather than a free lunch:**

1. **Two venues means two of everything** - two sets of keys, two withdrawal
   paths, two counterparties. Venue risk stops being diversifiable and becomes
   the dominant risk.
2. **Capital is split**, so gross exposure is double the net position for the
   same economic exposure, and the gross exposure limit binds sooner.
3. **Convergence is not guaranteed.** Funding dispersion persists precisely
   because moving capital between venues is slow and risky. We are being paid
   for that, which means we are carrying it.
4. **It requires an unwind that works.** Legs on two venues that fill
   asymmetrically leave a naked perpetual. The leg group and the unwinder are
   not optional here; they are the strategy's load-bearing wall.

Five free parameters, against the SPEC section 6.1 limit of six.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from typing import Deque, Dict, List, Optional, Sequence, Tuple

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec
from .base import StrategyHealth, StrategyState

__all__ = ["DispersionParams", "FundingDispersion"]


@dataclass(frozen=True)
class DispersionParams:
    """Five free parameters. The SPEC section 6.1 hard limit is six."""

    #: Enter when the funding differential per interval exceeds this. Set from
    #: the cost arithmetic rather than from a backtest: with one leg crossing,
    #: a round trip costs 0.17% of notional, and clearing the 40% gate with
    #: margin needs 0.07% per interval over twelve intervals.
    #:
    #: It was 0.05% until the first measurement showed a leg crossing on every
    #: entry. Raising it is not tuning: the cost changed, so the threshold
    #: derived from the cost changed with it. ``tradesys viability`` prints the
    #: derivation.
    entry_spread: Dec = dec("0.0007")
    #: Close when it falls back below. Strictly under entry, or the position
    #: thrashes at the boundary and pays a round trip for each thrash.
    exit_spread: Dec = dec("0.0001")
    #: Round-trip cost as a fraction of notional, across all four fills.
    #: Both legs rest, so this is lower than the hedged carry's - but it is
    #: still four fills and it is still the number the break-even check uses.
    round_trip_cost: Dec = dec("0.0017")
    #: Longest hold, in funding intervals. Dispersion mean-reverts faster than
    #: the level does, because it is arbitraged by anyone who can move
    #: collateral; a position still open after this was not dispersion.
    max_hold_intervals: int = 12
    #: Quote notional per leg.
    base_notional: Dec = dec("1000")

    def as_dict(self) -> dict:
        return {"entry_spread": str(self.entry_spread),
                "exit_spread": str(self.exit_spread),
                "round_trip_cost": str(self.round_trip_cost),
                "max_hold_intervals": str(self.max_hold_intervals),
                "base_notional": str(self.base_notional)}


@dataclass
class _Open:
    #: +1 means short the high-funding venue (venue_a) and long venue_b.
    sign: int
    opened_at: Nanos
    entry_spread: Dec


class FundingDispersion:
    """Short the perpetual that pays, long the one that receives."""

    def __init__(self, symbol: str, venue_a: str, venue_b: str,
                 strategy_id: str = "funding_dispersion",
                 params: Optional[DispersionParams] = None,
                 interval_ns: int = 8 * 3600 * 1_000_000_000,
                 signal_ttl_ns: int = 900 * 1_000_000_000) -> None:
        self.strategy_id = strategy_id
        self.symbol = symbol
        self.venue_a = venue_a
        self.venue_b = venue_b
        self.params = params or DispersionParams()
        self.interval_ns = interval_ns
        self.signal_ttl_ns = signal_ttl_ns
        self.health = StrategyHealth(strategy_id=strategy_id, state=StrategyState.RESEARCH)
        #: Latest funding rate and price per venue. Cross-venue state, which no
        #: per-venue feature engine can hold.
        self._funding: Dict[str, Dec] = {}
        self._price: Dict[str, Dec] = {}
        self._seen_at: Dict[str, Nanos] = {}
        self._open: Optional[_Open] = None
        self.last_veto: Optional[str] = None
        self.vetoes: Dict[str, int] = {}

    # ------------------------------------------------------------------

    def parameters(self) -> dict:
        return {**self.params.as_dict(), "symbol": self.symbol,
                "venues": f"{self.venue_a}/{self.venue_b}"}

    def _veto(self, reason: str, key: str) -> Sequence[Signal]:
        self.last_veto = reason
        self.vetoes[key] = self.vetoes.get(key, 0) + 1
        return ()

    # ------------------------------------------------------------------

    def on_features(self, snapshot: FeatureSnapshot) -> Sequence[Signal]:
        self.last_veto = None
        if snapshot.symbol != self.symbol:
            return ()
        if snapshot.venue not in (self.venue_a, self.venue_b):
            return ()

        rate = snapshot.get("annualised_funding")
        price = snapshot.get("microprice")
        if price is not None and price > 0:
            self._price[snapshot.venue] = price
        if rate is not None:
            # Back to per-interval, which is the unit the spread is quoted and
            # the cost compared in. Comparing an annualised number to a
            # per-trip cost is a factor-of-a-thousand error that looks
            # plausible on both sides.
            self._funding[snapshot.venue] = rate / dec(3 * 365)
            self._seen_at[snapshot.venue] = snapshot.as_of

        # Act only when the second venue updates, so both rates are current.
        # A spread built from rates observed hours apart is not a spread that
        # existed at any moment.
        if snapshot.venue != self.venue_b:
            return ()
        if self.venue_a not in self._funding or self.venue_b not in self._funding:
            return self._veto("only one venue has reported funding", "one_sided")
        if self.venue_a not in self._price or self.venue_b not in self._price:
            return self._veto("missing a price on one venue", "no_price")

        staleness = abs(self._seen_at.get(self.venue_a, 0)
                        - self._seen_at.get(self.venue_b, 0))
        if staleness > self.interval_ns:
            return self._veto(
                f"venue rates are {staleness / 1e9 / 3600:.1f}h apart; that is "
                "not a spread that existed", "stale_pair")

        spread = self._funding[self.venue_a] - self._funding[self.venue_b]

        if self._open is not None:
            return self._manage(snapshot, spread)
        return self._consider_entry(snapshot, spread)

    # ------------------------------------------------------------------

    def _consider_entry(self, snapshot: FeatureSnapshot, spread: Dec) -> Sequence[Signal]:
        if abs(spread) < self.params.entry_spread:
            return self._veto(
                f"spread {float(spread) * 100:.4f}%/interval below entry "
                f"{float(self.params.entry_spread) * 100:.4f}%", "spread_too_small")

        veto = self._breakeven_blocks(abs(spread))
        if veto is not None:
            return self._veto(veto, "below_breakeven")

        # Positive spread: venue A pays more, so short A and long B.
        sign = 1 if spread > 0 else -1
        self._open = _Open(sign, snapshot.as_of, spread)
        return self._legs(snapshot, spread, entering=True)

    def _breakeven_blocks(self, spread: Dec) -> Optional[str]:
        """Refuse a trade that cannot cover its own round trip in time.

        The check the first carry strategy got backwards at first - a ``None``
        meaning "fine" was read as a veto - so it is written to return the
        reason or nothing, and never a bare boolean.
        """
        if spread <= 0:
            return "no spread to collect"
        needed = self.params.round_trip_cost / spread
        if needed > self.params.max_hold_intervals:
            return (f"needs {float(needed):.1f} intervals to cover costs but may "
                    f"only hold {self.params.max_hold_intervals}")
        return None

    def _manage(self, snapshot: FeatureSnapshot, spread: Dec) -> Sequence[Signal]:
        assert self._open is not None
        held = snapshot.as_of - self._open.opened_at
        if held >= self.params.max_hold_intervals * self.interval_ns:
            self._open = None
            return self._legs(snapshot, spread, entering=False,
                              reason="hold limit: this was not dispersion")
        if spread * dec(self._open.sign) < self.params.exit_spread:
            self._open = None
            return self._legs(snapshot, spread, entering=False, reason="converged")
        return ()

    # ------------------------------------------------------------------

    def _legs(self, snapshot: FeatureSnapshot, spread: Dec, entering: bool,
              reason: str = "") -> List[Signal]:
        self.health.last_signal_at = snapshot.as_of
        self.health.signals_today += 1
        group = f"{self.strategy_id}-{snapshot.as_of}"
        detail = reason or ("entry" if entering else "exit")

        if entering:
            assert self._open is not None
            sign = self._open.sign
            qty_a = -self.params.base_notional / self._price[self.venue_a] * dec(sign)
            qty_b = self.params.base_notional / self._price[self.venue_b] * dec(sign)
        else:
            qty_a = qty_b = dec(0)

        # Both legs are maker-preferred and one of them will cross anyway -
        # whichever is on the wrong side of the prevailing drift. That is
        # measured, not assumed, and the cost model says one crossing leg for
        # exactly this reason.
        #
        # They stay maker-preferred rather than being marked aggressive because
        # the fallback only fires when the rest does not fill: in a flat market
        # both legs rest and the trade costs half as much. Marking them
        # aggressive would pay the spread even when it was not necessary,
        # which is paying for the bad case in the good one.
        return [
            self._signal(snapshot, self.venue_a, qty_a, spread, group,
                         "primary", "maker_preferred", detail),
            self._signal(snapshot, self.venue_b, qty_b, spread, group,
                         "hedge", "maker_preferred", f"{detail} (paired leg)"),
        ]

    def _signal(self, snapshot: FeatureSnapshot, venue: str, target: Dec,
                spread: Dec, group: str, role: str, urgency: str,
                reason: str) -> Signal:
        return Signal(
            correlation_id=snapshot.correlation_id,
            emitted_at=snapshot.as_of,
            source=f"l3:{self.strategy_id}",
            strategy_id=self.strategy_id,
            venue=venue,
            symbol=self.symbol,
            target_position=target,
            urgency=urgency,
            limit_price=None,
            valid_until=snapshot.as_of + self.signal_ttl_ns,
            confidence=min(dec(1), abs(spread) / (self.params.entry_spread * dec(3))),
            rationale={"funding_spread": spread},
            leg_group=group,
            leg_role=role,
        )
