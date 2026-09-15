"""The strategy contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional, Protocol, Sequence, runtime_checkable

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["StrategyState", "Strategy", "StrategyHealth",
           "declared_stop_distance"]


class StrategyState:
    """SPEC section 6.3 lifecycle."""

    RESEARCH = "research"
    PAPER = "paper"
    MICRO_LIVE = "micro-live"
    LIVE = "live"
    #: Reduced allocation, still trading, under investigation. A first-class
    #: state, because without a middle one every problem becomes a binary
    #: between ignoring it and switching the strategy off - and teams choose
    #: ignoring.
    DEGRADED = "degraded"
    RETIRED = "retired"

    TRADING = frozenset({PAPER, MICRO_LIVE, LIVE, DEGRADED})


@dataclass
class StrategyHealth:
    """What every strategy exposes (SPEC section 6.2)."""

    strategy_id: str
    state: str = StrategyState.RESEARCH
    last_signal_at: Optional[Nanos] = None
    signals_today: int = 0
    current_exposure: Dec = dec(0)
    divergence_z: Optional[float] = None
    enabled: bool = True

    @property
    def may_trade(self) -> bool:
        return self.enabled and self.state in StrategyState.TRADING


@runtime_checkable
class Strategy(Protocol):
    """Pure function of features to desired exposure.

    Individually disableable at runtime without restarting the system: the
    alternative is that disabling a misbehaving strategy requires a restart
    during the incident it is causing.
    """

    strategy_id: str
    health: StrategyHealth

    def on_features(self, snapshot: FeatureSnapshot) -> Sequence[Signal]:
        """Return the desired exposures, or an empty sequence for no opinion.

        A sequence rather than a single signal because a hedged position is
        two legs and a triangular trade is three. Returning one and leaving the
        caller to discover the rest is how a strategy ends up half on.
        """
        ...

    def parameters(self) -> dict:
        """Current parameters, for the trial registry and the audit log."""
        ...


def declared_stop_distance(strategy) -> Optional[Dec]:
    """How much of a position's notional is at risk before its stop fires.

    Optional on purpose, and read through this helper rather than required on
    the protocol, so a strategy with no stop simply does not implement it.

    What is **not** optional is the consequence. The risk service's per-trade
    risk check is ``notional x stop_distance / equity``, and an undeclared stop
    distance defaults to 1.0 - the whole notional at risk. That default is
    correct and deliberately punitive: a strategy that has not said where it
    gets out has not established that it gets out.

    This helper exists because the connection between the two was missing.
    ``RiskContext.stop_distance_frac`` was declared, checked, and unit-tested,
    and nothing in the running system ever populated it - so every strategy was
    sized as though it had no stop, including the ones that had one. It
    surfaced only when a strategy came along whose sizing was large enough for
    the 2% limit to bite. A control that is never exercised is a control whose
    wiring nobody has checked.
    """
    getter = getattr(strategy, "stop_distance", None)
    if getter is None:
        return None
    try:
        value = getter()
    except Exception:                                          # noqa: BLE001
        return None
    if value is None or value <= 0 or value > 1:
        # A stop distance above 1 is not a stop, and a negative one is a bug.
        # Fall back to the conservative default rather than trusting it.
        return None
    return value
