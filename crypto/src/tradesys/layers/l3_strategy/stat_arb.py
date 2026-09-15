"""Statistical arbitrage on a cointegrated pair (SPEC section 2.2).

The second strategy, and the reason the portfolio layer has anything to decide.
Risk parity across one strategy is arithmetic with no choice in it.

Economic rationale, per the SPEC section 6.1 template:

* **Counterparty:** whoever is moving one leg of the pair for a reason
  unrelated to the pair - a large holder rebalancing, a liquidation, an index
  flow, a listing. They need to trade one asset and do not care that its usual
  relationship to another has stretched.
* **Why they trade against me:** they are paying for immediacy in one name. I
  am selling it to them and hedging with the other name, so I carry the
  relationship rather than the direction.
* **Why it persists:** flow-driven dislocation is a mechanism, not a
  mispricing. As long as somebody occasionally has to trade size in a hurry,
  something has to absorb it.
* **What would end it:** the relationship breaking. That is not a hypothetical
  - it is the expected outcome, eventually, for every pair. **This edge decays
  and the strategy is built to notice**, which is what the half-life filter and
  the re-estimation cadence are for.

**Where the tail is.** A pair stops being a pair. The spread widens and keeps
widening, and the position that was mean-reverting is now a leveraged bet on a
relationship that no longer exists. That is why the half-life filter refuses
to enter a spread that is not reverting, and why there is a hard stop on
spread width rather than only on z-score.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass
from decimal import Decimal
from typing import Deque, Dict, List, Optional, Sequence, Tuple

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec
from ..l2_features.derivs import hedge_ratio, spread_half_life, spread_zscore
from .base import StrategyHealth, StrategyState

__all__ = ["StatArbPairs", "StatArbParams"]


@dataclass(frozen=True)
class StatArbParams:
    """Five free parameters. The SPEC section 6.1 hard limit is six."""

    #: Enter when the spread is this many standard deviations from its mean.
    entry_z: Dec = dec("2.0")
    #: Exit here, not at zero. Waiting for a perfect reversion gives back the
    #: move and occasionally waits forever.
    exit_z: Dec = dec("0.5")
    #: Refuse a pair whose spread takes longer than this to revert, in
    #: observations. A spread reverting over three months is a fact about the
    #: world rather than a strategy: the position has to be financed and hedged
    #: for three months to collect it.
    max_half_life: Dec = dec("20")
    #: Hard stop. Beyond this the pair is assumed broken rather than stretched,
    #: and the position is closed at a loss instead of held in hope.
    stop_z: Dec = dec("4.0")
    base_notional: Dec = dec("1000")

    def as_dict(self) -> dict:
        return {
            "entry_z": str(self.entry_z), "exit_z": str(self.exit_z),
            "max_half_life": str(self.max_half_life), "stop_z": str(self.stop_z),
            "base_notional": str(self.base_notional),
        }


class StatArbPairs:
    """Trades the spread between two instruments, never either one alone."""

    def __init__(self, symbol_a: str, symbol_b: str, venue_a: str, venue_b: str,
                 strategy_id: str = "stat_arb", params: Optional[StatArbParams] = None,
                 window: int = 120, signal_ttl_ns: int = 60_000_000_000) -> None:
        self.strategy_id = strategy_id
        self.symbol_a = symbol_a
        self.symbol_b = symbol_b
        self.venue_a = venue_a
        self.venue_b = venue_b
        self.params = params or StatArbParams()
        self.signal_ttl_ns = signal_ttl_ns
        self.health = StrategyHealth(strategy_id=strategy_id, state=StrategyState.RESEARCH)
        # Cross-symbol state, which the per-symbol feature engine cannot hold.
        self._prices: Dict[str, Deque[Dec]] = {
            symbol_a: deque(maxlen=window), symbol_b: deque(maxlen=window),
        }
        self._position_sign = 0          # -1 short spread, +1 long spread, 0 flat
        self.last_veto: Optional[str] = None

    # ------------------------------------------------------------------

    def parameters(self) -> dict:
        return {**self.params.as_dict(), "pair": f"{self.symbol_a}/{self.symbol_b}"}

    def on_features(self, snapshot: FeatureSnapshot) -> Sequence[Signal]:
        self.last_veto = None

        if snapshot.symbol not in self._prices:
            return ()
        price = snapshot.get("microprice")
        if price is None or price <= 0:
            self.last_veto = f"no usable price for {snapshot.symbol}"
            return ()
        self._prices[snapshot.symbol].append(price)

        # Act only on the second leg's update, so both series are current. On
        # the first leg the other price is one tick stale, and a spread built
        # from prices taken at different moments is a spread that does not
        # exist.
        if snapshot.symbol != self.symbol_b:
            return ()

        a = list(self._prices[self.symbol_a])
        b = list(self._prices[self.symbol_b])
        if len(a) < 30 or len(b) < 30:
            self.last_veto = "not enough history to estimate the relationship"
            return ()

        beta = hedge_ratio(a, b)
        z = spread_zscore(a, b, beta)
        if beta is None or z is None:
            self.last_veto = "spread has no variance; nothing to trade"
            return ()

        if self._position_sign != 0:
            return self._manage_open_position(snapshot, z, beta)

        half_life = spread_half_life(a, b, beta)
        if half_life is None:
            self.last_veto = "spread is drifting, not reverting"
            return ()
        if half_life > self.params.max_half_life:
            self.last_veto = (
                f"half-life {half_life} exceeds {self.params.max_half_life}: the "
                "position would have to be financed and hedged for too long"
            )
            return ()

        if abs(z) < self.params.entry_z:
            self.last_veto = f"spread z {z:.2f} inside entry {self.params.entry_z}"
            return ()
        if abs(z) >= self.params.stop_z:
            # Already beyond the stop. Do not enter something you would
            # immediately have to close.
            self.last_veto = f"spread z {z:.2f} is already past the stop"
            return ()

        # A high spread means A is rich against B: sell A, buy B.
        self._position_sign = -1 if z > 0 else 1
        return self._legs(snapshot, beta, z, entering=True)

    def _manage_open_position(self, snapshot: FeatureSnapshot, z: Dec,
                              beta: Dec) -> Sequence[Signal]:
        if abs(z) >= self.params.stop_z:
            self._position_sign = 0
            return self._legs(snapshot, beta, z, entering=False,
                              reason="stop: the pair looks broken, not stretched")
        if abs(z) <= self.params.exit_z:
            self._position_sign = 0
            return self._legs(snapshot, beta, z, entering=False, reason="reverted")
        return ()

    # ------------------------------------------------------------------

    def _legs(self, snapshot: FeatureSnapshot, beta: Dec, z: Dec,
              entering: bool, reason: str = "") -> List[Signal]:
        self.health.last_signal_at = snapshot.as_of
        self.health.signals_today += 1

        price_a = self._prices[self.symbol_a][-1]
        price_b = self._prices[self.symbol_b][-1]
        group = f"{self.strategy_id}-{snapshot.as_of}"

        if entering:
            qty_a = self.params.base_notional / price_a * dec(self._position_sign)
            # Hedged by the ratio, not by notional. Equal notionals leave a
            # directional residual whenever beta is not one, which is always.
            qty_b = -qty_a * beta * price_a / price_b
        else:
            qty_a = dec(0)
            qty_b = dec(0)

        detail = reason or ("entry" if entering else "exit")
        return [
            self._signal(snapshot, self.venue_a, self.symbol_a, qty_a, z, group,
                         "primary", "passive", detail),
            self._signal(snapshot, self.venue_b, self.symbol_b, qty_b, z, group,
                         "hedge", "maker_preferred", f"{detail} (paired leg)"),
        ]

    def _signal(self, snapshot: FeatureSnapshot, venue: str, symbol: str, target: Dec,
                z: Dec, group: str, role: str, urgency: str, reason: str) -> Signal:
        return Signal(
            correlation_id=snapshot.correlation_id,
            emitted_at=snapshot.as_of,
            source=f"l3:{self.strategy_id}",
            strategy_id=self.strategy_id,
            venue=venue,
            symbol=symbol,
            target_position=target,
            urgency=urgency,
            limit_price=None,
            valid_until=snapshot.as_of + self.signal_ttl_ns,
            confidence=min(dec(1), abs(z) / (self.params.entry_z * 2)),
            rationale={"spread_zscore": z},
            leg_group=group,
            leg_role=role,
        )
