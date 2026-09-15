"""The strategy contract."""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Optional, Protocol, runtime_checkable

from ...core.events import FeatureSnapshot, Signal
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["StrategyState", "Strategy", "StrategyHealth"]


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

    def on_features(self, snapshot: FeatureSnapshot) -> Optional[Signal]:
        """Return a desired exposure, or ``None`` for no opinion."""
        ...

    def parameters(self) -> dict:
        """Current parameters, for the trial registry and the audit log."""
        ...
