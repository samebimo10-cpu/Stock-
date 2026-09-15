"""Time-series momentum with volatility targeting.

**Why this one exists.** The cost gate is a ratio, cost over gross, and the
carry strategy fails it at 69% because its gross accrues in basis points per
eight hours against a round trip that costs twenty. This strategy attacks the
denominator instead of the numerator: one leg, one venue, held for weeks, and
when it is right the move is whole percentage points. A 0.1% round trip against
a 12% move is 0.8% of gross. It clears a 40% gate by a factor of fifty, and it
would still clear it at ten times the cost.

That is the entire argument for building it first, and it is an argument about
arithmetic rather than about forecasting skill. ``tradesys viability`` will
print the same thing.

**Why it might actually work.** Time-series momentum is the most durable
documented anomaly across every asset class that has been looked at, and crypto
is if anything the friendliest case: retail-dominated, reflexive, with leverage
that forces continuation. It is not a secret and it is not an edge over a prop
desk. It is a risk premium that persists because holding through its drawdowns
is genuinely unpleasant - which is a reason to expect it to keep paying, and
also a warning about what running it feels like.

**What will hurt.** Trend following wins perhaps 35-40% of its trades and makes
its money on the tail. Long flat stretches with steady small losses are the
normal state, not a malfunction, and a stop-loss tight enough to feel
comfortable destroys the strategy by cutting the winners that pay for
everything. The kill criteria in the strategy specification are set against
that: they fire on *behaviour* diverging from the backtest, never on a losing
month.

Five free parameters, against the SPEC section 6.1 limit of six. Every one of
them is a decision somebody has to defend, which is the point of the limit.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Dict, List, Optional, Sequence

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, dec
from .base import StrategyHealth, StrategyState

__all__ = ["TrendParams", "TimeSeriesMomentum"]


@dataclass(frozen=True)
class TrendParams:
    """Five free parameters. The SPEC section 6.1 hard limit is six."""

    #: Go long above this EWMAC, short below its negative. Around 1.0 on the
    #: normalisation this uses: a trend of roughly one typical move's worth of
    #: separation between the fast and slow averages.
    entry: Dec = dec("1.0")
    #: Flatten when the signal falls back inside this. Strictly below ``entry``
    #: so the position does not thrash at the boundary - the single most
    #: expensive mistake available to a trend strategy, because every thrash
    #: pays a full round trip against no move at all.
    exit: Dec = dec("0.3")
    #: Annualised volatility the position is scaled to. The position size is
    #: whatever makes the instrument's own volatility equal this, so a calm
    #: month and a violent one contribute the same risk rather than the same
    #: notional.
    vol_target: Dec = dec("0.20")
    #: Never take more than this fraction of the budget in one instrument,
    #: whatever the vol scaling asks for. The scaling divides by volatility,
    #: and dividing by a small number is how a quiet week becomes a position
    #: nobody sized.
    #:
    #: Deliberately below the 0.25 ``asset_concentration`` limit rather than
    #: equal to it. A strategy that sizes exactly to a risk limit is a strategy
    #: whose every entry arrives at the risk service asking to be reduced, and
    #: a reduction on every order makes the limit's alerting useless.
    max_weight: Dec = dec("0.18")
    #: Stop at this many **holding-horizon** standard deviations against the
    #: entry. Not this many per-bar ATRs: the first version of this was, and
    #: the resulting stop was 0.18% wide on hourly data, which noise clears
    #: within an afternoon. A stop for a position held for weeks has to be
    #: measured over weeks - see :attr:`TimeSeriesMomentum.HORIZON_BARS`.
    #:
    #: Wide on purpose even then. This is a disaster stop for gaps and
    #: crashes, not a trading stop: a trend strategy's exit is the signal
    #: decaying, and a stop tight enough to feel comfortable cuts the winners
    #: that pay for everything else.
    stop_sigma: Dec = dec("2.5")

    def as_dict(self) -> dict:
        return {"entry": str(self.entry), "exit": str(self.exit),
                "vol_target": str(self.vol_target), "max_weight": str(self.max_weight),
                "stop_sigma": str(self.stop_sigma)}


#: Funding intervals per year, used to annualise a per-interval volatility.
#: Three eight-hour intervals a day. Stated as a constant because a wrong
#: annualisation factor is invisible and scales every position in the book.
INTERVALS_PER_YEAR = 3 * 365


@dataclass
class _Open:
    """What we need to remember about a position this strategy opened."""

    sign: int
    entry_price: Dec
    stop_price: Dec
    quantity: Dec


class TimeSeriesMomentum:
    """Long strength, short weakness, sized by volatility. One leg."""

    #: Observations a position is expected to be held for, matching the slow
    #: EWMA span the signal is built on. Used to scale a per-observation range
    #: into a holding-horizon one, by the square root of time.
    #:
    #: Getting this wrong is not a rounding error. With ``HORIZON_BARS = 1``
    #: - which is what "stop at 4 ATR" silently means - the stop on hourly
    #: data came out at 0.18%, every position was stopped out by noise within
    #: hours, and the strategy looked like it did not work. The signal was
    #: fine; the stop was measured in the wrong units.
    HORIZON_BARS = 32

    def __init__(self, venue: str, symbols: Sequence[str] = ("BTCUSDT",),
                 budget: Dec = dec("10000"),
                 strategy_id: str = "trend",
                 params: Optional[TrendParams] = None,
                 signal_ttl_ns: int = 3600 * 1_000_000_000) -> None:
        self.strategy_id = strategy_id
        self.venue = venue
        self.symbols = tuple(symbols)
        #: Quote-currency budget this strategy sizes against. **Not** live
        #: equity, and not by accident: L3 cannot see the book (SPEC section
        #: 3.5), and a strategy that could would size off its own profit and
        #: loss - compounding up into strength and, worse, cutting size in a
        #: drawdown exactly when a trend strategy's recovery arrives. The
        #: allocator does the equity-relative scaling, in L4, where it can see
        #: the whole book rather than one strategy's corner of it.
        self.budget = budget
        self.params = params or TrendParams()
        self.signal_ttl_ns = signal_ttl_ns
        self.health = StrategyHealth(strategy_id=strategy_id, state=StrategyState.RESEARCH)
        self._open: Dict[str, _Open] = {}
        #: Most recent range estimate, so the stop distance reported to the
        #: risk service tracks current volatility rather than a constant.
        self._last_range: Optional[Dec] = None
        self.last_veto: Optional[str] = None
        #: Every reason a signal was declined, counted. A strategy that emits
        #: nothing for a week should be able to say which check stopped it,
        #: without anybody adding logging during the incident.
        self.vetoes: Dict[str, int] = {}

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
        signal = snapshot.get("ewmac")
        breakout = snapshot.get("breakout_position")
        vol = snapshot.get("realised_volatility")
        true_range = snapshot.get("atr")

        if price is None or price <= 0:
            return self._veto("no usable price", "no_price")
        # A missing feature is never imputed (SPEC section 5.3). Early in a
        # session every one of these is None, and a strategy that treats
        # missing as zero trades the warm-up period as though it were flat.
        if true_range is not None and true_range > 0:
            self._last_range = true_range
        if signal is None:
            return self._veto("not enough history for a trend estimate", "warming_up")

        open_position = self._open.get(snapshot.symbol)
        if open_position is not None:
            return self._manage(snapshot, open_position, price, signal)

        if vol is None or vol <= 0:
            return self._veto("no volatility estimate; cannot size", "no_vol")
        if true_range is None or true_range <= 0:
            return self._veto("no range estimate; cannot place a stop", "no_atr")
        if abs(signal) < self.params.entry:
            return self._veto(f"trend {float(signal):.2f} inside entry "
                              f"{float(self.params.entry)}", "no_trend")

        sign = 1 if signal > 0 else -1
        if breakout is not None and breakout * dec(sign) < 0:
            # The averages have crossed but price is in the wrong half of its
            # own recent range: that is a retracement inside a trend that has
            # already turned, and it is the most expensive entry available.
            return self._veto("trend and range disagree", "disagreement")

        quantity = self._size(price, vol) * dec(sign)
        if quantity == 0:
            return self._veto("volatility scaling rounds the position to nothing",
                              "size_zero")

        # A four-ATR stop on an instrument whose ATR is 30% would sit below
        # zero. Clamp the distance rather than emitting an impossible stop:
        # a stop price that can never be reached is no stop at all, and the
        # position would then be held to liquidation.
        distance = self._stop_distance_for(true_range)
        stop = price * (dec(1) - distance * dec(sign))
        self._open[snapshot.symbol] = _Open(sign, price, stop, quantity)
        return [self._signal(snapshot, quantity, signal,
                             f"entry: trend {float(signal):.2f}, stop {stop:.2f}")]

    # ------------------------------------------------------------------

    def _manage(self, snapshot: FeatureSnapshot, position: _Open, price: Dec,
                signal: Dec) -> Sequence[Signal]:
        """Exit rules, in the order they must be checked.

        The stop is checked first and unconditionally. A stop that can be
        talked out of by a still-favourable signal is not a stop.
        """
        hit_stop = (price <= position.stop_price if position.sign > 0
                    else price >= position.stop_price)
        if hit_stop:
            del self._open[snapshot.symbol]
            return [self._signal(snapshot, dec(0), signal,
                                 f"stop at {float(price):.2f}", urgency="aggressive")]

        if signal * dec(position.sign) < self.params.exit:
            del self._open[snapshot.symbol]
            return [self._signal(snapshot, dec(0), signal,
                                 f"trend decayed to {float(signal):.2f}")]

        # Still in the trend. Deliberately no re-sizing on every tick: a
        # position that is rebalanced to target volatility continuously pays a
        # round trip for each adjustment, and the adjustments are noise. The
        # size is set once, at entry, from the volatility then.
        return ()

    def _stop_distance_for(self, true_range: Dec) -> Dec:
        """Stop distance as a fraction of price, over the holding horizon.

        Square root of time. A per-observation range scaled by
        ``sqrt(HORIZON_BARS)`` is the range to expect over a hold of that
        length, which is the only scale at which a stop for this strategy
        means anything.

        Clamped at 50%: a four-sigma stop on an instrument with a 30% per-bar
        range would sit below zero, and a stop price that can never be reached
        is no stop at all - the position would be held to liquidation instead.
        """
        horizon = dec(str(self.HORIZON_BARS ** 0.5))
        return min(self.params.stop_sigma * true_range * horizon, dec("0.5"))

    def stop_distance(self) -> Optional[Dec]:
        """What the risk service needs to size this strategy's per-trade risk.

        Read through :func:`~tradesys.layers.l3_strategy.base.declared_stop_distance`.
        Without it the risk check assumes the whole notional is at risk, which
        is the correct default for a strategy that has not said where it gets
        out - and the wrong answer for one that has.

        Returns the distance for the **current** volatility, not a nominal one:
        a stop placed in volatility units moves with volatility, and a risk
        check using last week's distance is sizing against a stop that no
        longer exists.
        """
        if self._last_range is None or self._last_range <= 0:
            return None
        return self._stop_distance_for(self._last_range)

    def _size(self, price: Dec, vol_per_interval: Dec) -> Dec:
        """Notional that makes this instrument's volatility equal the target.

        ``realised_volatility`` is per interval, so it is annualised before
        comparison. Skipping that step is a silent factor-of-thirty error in
        every position the strategy takes, and nothing about the resulting
        book looks wrong until the first bad week.
        """
        annualised = vol_per_interval * dec(str(INTERVALS_PER_YEAR ** 0.5))
        if annualised <= 0:
            return dec(0)
        weight = self.params.vol_target / annualised
        # The cap is not belt and braces. Dividing by a small volatility is
        # exactly how a quiet fortnight produces a position five times the size
        # of anything in the backtest, and the quiet fortnight before a shock
        # is the most common shape of the run-up to one.
        weight = min(weight, self.params.max_weight)
        return self.budget * weight / price

    def _signal(self, snapshot: FeatureSnapshot, target: Dec, trend: Dec,
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
            # Maker-preferred on entry, because a trend held for weeks can
            # afford to wait for a fill and cannot afford to pay the spread
            # every time. A stop crosses: ADR 0004's lesson is that a passive
            # order does not fill in the market that made you want out.
            urgency=urgency if urgency != "normal" else "maker_preferred",
            limit_price=None,
            valid_until=snapshot.as_of + self.signal_ttl_ns,
            confidence=min(dec(1), abs(trend) / (self.params.entry * dec(3))),
            rationale={"ewmac": trend},
            leg_group="",
            leg_role="single",
        )
