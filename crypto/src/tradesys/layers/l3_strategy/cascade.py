"""Liquidation cascade reversion: buying from people who have no choice.

**The edge, stated plainly.** A liquidation is the one order in the book placed
by someone with no opinion about the price. When a cascade runs, the price that
results is not a view about value, it is a queue of margin calls clearing
against whatever depth remains. It stops when the positions are gone, not when
the price is right - and so it overshoots, and so it reverts.

This is not a forecast. It is a liquidity premium: we are being paid to supply
the depth that vanished, in the seconds when supplying it feels worst. That is
why it can persist while being entirely public.

**Why it pairs with trend.** One buys strength, the other buys collapse. Their
correlation is structurally negative in exactly the moments that matter - the
week trend has its worst day is a week this has its best - which is what SPEC
section 7.2 means by diversification that is real rather than nominal. Two
strategies on the same symbol can be uncorrelated; two on different symbols can
be identical. These two are the first kind.

**Why it clears the cost gate.** A cascade overshoot is 1.5-5% and reverts
within hours. Against a 0.1% round trip that is 2-7% of gross. The trade is
rare - a handful of real cascades a month - which caps capacity but not the
ratio, and the ratio is what the gate measures.

**The way this loses money**, and it is not subtle: entering a cascade that is
not over. The first 30% of a liquidation cascade looks exactly like the whole
of one. Three defences, none of them optional:

1. **Require the forced flow to be decelerating**, not merely present.
2. **A hard stop below the extreme**, always, sized in ATR.
3. **A time stop.** If it has not reverted within the window, the premise was
   wrong: this was information, not forced selling, and information does not
   revert.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, Optional, Sequence

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec
from .base import StrategyHealth, StrategyState

__all__ = ["CascadeParams", "LiquidationReversion"]


@dataclass(frozen=True)
class CascadeParams:
    """Six free parameters, at the SPEC section 6.1 limit. Not one more."""

    #: Enter when forced flow reaches this share of ordinary volume over the
    #: same window. 0.35 is a genuine dislocation; 0.05 is a Tuesday.
    pressure: Dec = dec("0.35")
    #: And only once the pressure has fallen to this fraction of its peak.
    #: Catching the cascade while it accelerates is the way this strategy
    #: loses money, and it is the only failure mode that loses a lot at once.
    decay: Dec = dec("0.5")
    #: Take profit at this fraction of the overshoot recovered. Not the whole
    #: way back: the last third of a reversion takes longer than the first two
    #: and is where the edge is thinnest.
    recover: Dec = dec("0.5")
    #: Stop this fraction of the cascade's own depth beyond its extreme.
    #:
    #: Of the cascade's depth, deliberately, not of ATR. An ATR-scaled stop
    #: assumes the observations it was measured over are evenly spaced, and a
    #: cascade is precisely the moment they are not: events arrive seconds
    #: apart during it and hours apart around it, so the range estimate is a
    #: blend of two time scales and the stop it produces is meaningless. The
    #: dislocation's own depth is the one scale that is definitely right,
    #: because it is the thing being faded.
    stop_depth: Dec = dec("0.5")
    #: Give up after this long. A dislocation that has not reverted was
    #: information, and information does not revert.
    max_hold_ns: int = 6 * 3600 * 1_000_000_000
    #: Quote notional per entry.
    base_notional: Dec = dec("1000")

    def as_dict(self) -> dict:
        return {"pressure": str(self.pressure), "decay": str(self.decay),
                "recover": str(self.recover), "stop_depth": str(self.stop_depth),
                "max_hold_hours": str(self.max_hold_ns // (3600 * 10**9)),
                "base_notional": str(self.base_notional)}


@dataclass
class _Open:
    sign: int
    entry_price: Dec
    extreme: Dec
    stop_price: Dec
    target_price: Dec
    quantity: Dec
    opened_at: Nanos


class LiquidationReversion:
    """Fades forced flow, once the forcing has stopped."""

    def __init__(self, venue: str, symbols: Sequence[str] = ("BTCUSDT",),
                 strategy_id: str = "cascade",
                 params: Optional[CascadeParams] = None,
                 signal_ttl_ns: int = 300 * 1_000_000_000) -> None:
        self.strategy_id = strategy_id
        self.venue = venue
        self.symbols = tuple(symbols)
        self.params = params or CascadeParams()
        self.signal_ttl_ns = signal_ttl_ns
        self.health = StrategyHealth(strategy_id=strategy_id, state=StrategyState.RESEARCH)
        self._open: Dict[str, _Open] = {}
        #: Peak pressure seen in the current episode, and the price extreme
        #: reached while it ran. Reset when pressure returns to nothing.
        self._peak: Dict[str, Dec] = {}
        self._extreme: Dict[str, Dec] = {}
        #: Price when the episode began, so the cascade's depth - the one scale
        #: that is certainly right - can be measured.
        self._origin: Dict[str, Dec] = {}
        #: The most recent price seen while nothing was running. This is what
        #: an episode's origin is set from. The first version captured the
        #: origin only on observations where no episode was in progress, which
        #: sounds equivalent and is not: the observation that *starts* an
        #: episode is one where an episode is in progress by the time the
        #: origin would be recorded, so the very first cascade reading left the
        #: origin unset, depth came out zero, and every entry was vetoed.
        self._quiet_price: Dict[str, Dec] = {}
        #: Which way the episode ran, per symbol. An instance attribute, not a
        #: class one: a mutable default shared between instances would have two
        #: strategies on two venues overwriting each other's episode state, and
        #: the symptom would be one of them occasionally fading the wrong way.
        self._signs: Dict[str, int] = {}
        #: When the current episode last saw real forced flow. The episode is
        #: kept alive for a grace period after that, and the grace period is
        #: the whole point: the entry condition is "pressure has decayed from
        #: its peak", so an implementation that forgets the peak the moment
        #: pressure falls forgets it at precisely the moment the trade becomes
        #: available. The first version did exactly that and never entered a
        #: single cascade.
        #:
        #: Derived from ``max_hold_ns`` rather than being a seventh free
        #: parameter, and equal to it rather than a fraction of it: the memory
        #: has to outlast the wait for the entry, and we are by construction
        #: willing to wait about as long as we would hold. A quarter of it was
        #: the first guess and it expired before the retracement it was waiting
        #: for could develop.
        self._last_pressure_at: Dict[str, Nanos] = {}
        self.last_veto: Optional[str] = None
        self.vetoes: Dict[str, int] = {}

    @property
    def episode_grace_ns(self) -> int:
        return self.params.max_hold_ns

    # ------------------------------------------------------------------

    def parameters(self) -> dict:
        return {**self.params.as_dict(), "symbols": ",".join(self.symbols),
                "venue": self.venue}

    def _veto(self, reason: str, key: str) -> Sequence[Signal]:
        self.last_veto = reason
        self.vetoes[key] = self.vetoes.get(key, 0) + 1
        return ()

    # ------------------------------------------------------------------

    def on_features(self, snapshot: FeatureSnapshot) -> Sequence[Signal]:
        self.last_veto = None
        if snapshot.venue != self.venue or snapshot.symbol not in self.symbols:
            return ()

        price = snapshot.get("microprice")
        pressure = snapshot.get("cascade_pressure")
        true_range = snapshot.get("atr")
        if price is None or price <= 0:
            return self._veto("no usable price", "no_price")

        symbol = snapshot.symbol
        open_position = self._open.get(symbol)
        if open_position is not None:
            return self._manage(snapshot, open_position, price)

        if pressure is None:
            return self._veto("no liquidation data on this feed", "no_liquidations")

        self._track_episode(symbol, pressure, price, snapshot.as_of)

        magnitude = abs(pressure)
        peak = self._peak.get(symbol, dec(0))
        if peak < self.params.pressure:
            return self._veto(
                f"forced flow peaked at {float(peak):.2f} of volume, below "
                f"{float(self.params.pressure):.2f}", "not_a_cascade")
        if magnitude > peak * self.params.decay:
            # Still accelerating, or barely off the peak. This is the branch
            # that loses money when it is removed: the first third of a
            # cascade is indistinguishable from all of one.
            return self._veto(
                f"still running: {float(magnitude):.2f} against a peak of "
                f"{float(peak):.2f}", "still_falling")
        extreme = self._extreme.get(symbol, price)
        origin = self._origin.get(symbol, price)
        depth = abs(origin - extreme)
        if depth <= 0:
            return self._veto("no dislocation to measure against", "no_depth")

        # Forced selling drove price down, so we buy. The sign of the trade is
        # opposite the sign of the flow, always.
        sign = 1 if self._episode_sign(symbol) < 0 else -1

        # **Price must have stopped falling, not just the flow.** Decaying
        # liquidations with price still collapsing is a falling knife with a
        # stop underneath it, and the first version of this strategy entered
        # exactly there: it bought three times during a cascade, was stopped
        # three times, and lost money in a scenario that recovered 60% of the
        # drop. Flow decay is necessary and it is not sufficient; the
        # confirmation is a retracement that has actually begun.
        #
        # This costs part of the move on purpose. Waiting for confirmation
        # always does, and it is the difference between fading a dislocation
        # and catching a knife.
        retraced = (price - extreme) * dec(sign)
        if retraced < depth * self.params.decay / dec(4):
            return self._veto(
                f"flow has decayed but price has not turned: {float(retraced):.2f} "
                f"off an extreme {float(depth):.2f} deep", "no_retracement")

        stop = extreme - depth * self.params.stop_depth * dec(sign)
        # Target: back toward where price was before the cascade, but only part
        # of the way. The last third of a reversion is slow and thin.
        target = extreme + depth * self.params.recover * dec(sign)
        if (target - price) * dec(sign) <= 0:
            return self._veto("already past the target; the move is spent",
                              "no_room")

        quantity = self.params.base_notional / price * dec(sign)
        self._open[symbol] = _Open(sign, price, extreme, stop, target, quantity,
                                   snapshot.as_of)
        self._reset_episode(symbol)
        return [self._signal(
            snapshot, quantity, pressure,
            f"fading a cascade: peak pressure {float(peak):.2f}, now "
            f"{float(magnitude):.2f}", urgency="aggressive")]

    # ------------------------------------------------------------------

    def _track_episode(self, symbol: str, pressure: Dec, price: Dec,
                       now: Nanos) -> None:
        """Remember how bad it got, where price went, and when it last ran.

        Peak rather than current, because the entry condition is *decay from a
        peak* and there is no peak to decay from if only the latest reading is
        kept. And the peak survives quiet observations for a grace period,
        because a cascade that has stopped is a cascade that is ready to be
        faded - not one to be forgotten.
        """
        magnitude = abs(pressure)
        quiet = magnitude < self.params.pressure / dec(10)

        if symbol not in self._peak:
            # Nothing running: this price is the reference the next cascade's
            # depth will be measured from.
            self._quiet_price[symbol] = price

        if quiet:
            last = self._last_pressure_at.get(symbol)
            if last is None or now - last > self.episode_grace_ns:
                # Genuinely over, and nothing came of it.
                self._reset_episode(symbol)
            # Otherwise keep the peak and the extreme: this is the window the
            # entry is supposed to happen in.
        else:
            self._last_pressure_at[symbol] = now
            if symbol not in self._peak:
                self._origin[symbol] = self._quiet_price.get(symbol, price)
            if magnitude >= self._peak.get(symbol, dec(0)):
                self._peak[symbol] = magnitude
                self._sign_of(symbol, pressure)

        if symbol not in self._peak:
            return
        extreme = self._extreme.get(symbol)
        if extreme is None:
            self._extreme[symbol] = price
        elif self._episode_sign(symbol) < 0:
            self._extreme[symbol] = min(extreme, price)
        else:
            self._extreme[symbol] = max(extreme, price)

    def _sign_of(self, symbol: str, pressure: Dec) -> None:
        self._signs[symbol] = -1 if pressure < 0 else 1

    def _episode_sign(self, symbol: str) -> int:
        return self._signs.get(symbol, -1)

    def _reset_episode(self, symbol: str) -> None:
        self._peak.pop(symbol, None)
        self._extreme.pop(symbol, None)
        self._signs.pop(symbol, None)
        self._last_pressure_at.pop(symbol, None)
        self._origin.pop(symbol, None)

    # ------------------------------------------------------------------

    def _manage(self, snapshot: FeatureSnapshot, position: _Open,
                price: Dec) -> Sequence[Signal]:
        """Stop, then target, then time. In that order, and the stop is absolute."""
        hit_stop = (price <= position.stop_price if position.sign > 0
                    else price >= position.stop_price)
        if hit_stop:
            del self._open[snapshot.symbol]
            return [self._signal(snapshot, dec(0), dec(0),
                                 f"stop at {float(price):.2f}: the cascade was not over",
                                 urgency="aggressive")]

        hit_target = (price >= position.target_price if position.sign > 0
                      else price <= position.target_price)
        if hit_target:
            del self._open[snapshot.symbol]
            return [self._signal(snapshot, dec(0), dec(0),
                                 f"reverted to {float(price):.2f}")]

        if snapshot.as_of - position.opened_at >= self.params.max_hold_ns:
            del self._open[snapshot.symbol]
            return [self._signal(
                snapshot, dec(0), dec(0),
                "time stop: it did not revert, so it was information",
                urgency="aggressive")]
        return ()

    def _signal(self, snapshot: FeatureSnapshot, target: Dec, pressure: Dec,
                reason: str, urgency: str = "normal") -> Signal:
        self.health.last_signal_at = snapshot.as_of
        self.health.signals_today += 1
        self.health.current_exposure = target
        return Signal(
            correlation_id=snapshot.correlation_id,
            emitted_at=snapshot.as_of,
            source=f"l3:{self.strategy_id}",
            strategy_id=self.strategy_id,
            venue=snapshot.venue,
            symbol=snapshot.symbol,
            target_position=target,
            # Aggressive, and this is the one strategy where paying the spread
            # is right rather than lazy. The whole premise is that liquidity
            # has vanished for a few seconds; an order that waits for a better
            # price waits for the dislocation to close, which is the event it
            # was supposed to profit from.
            urgency=urgency,
            limit_price=None,
            valid_until=snapshot.as_of + self.signal_ttl_ns,
            confidence=min(dec(1), abs(pressure) / (self.params.pressure * dec(2)))
            if pressure else dec(1),
            rationale={"cascade_pressure": pressure},
            leg_group="",
            leg_role="single",
        )
