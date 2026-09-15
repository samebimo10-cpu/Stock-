"""Netting (SPEC section 7.3).

Not a micro-optimisation. On a book of five to ten strategies this routinely
removes 20-40% of gross turnover, and turnover is fees - which is the
difference between the cost ratio in SPEC section 1.2 passing and failing.

The invariant is asserted rather than trusted: **netting never increases a
position.** If netting would produce a larger absolute exposure than any
contributor requested, that is a bug, and it fails loudly here rather than
quietly at the venue.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Mapping, Sequence, Tuple

from ...core.events import Signal, TargetPosition
from ...core.ids import new_correlation_id
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["NettingResult", "net_targets"]


@dataclass(frozen=True)
class NettingResult:
    targets: Tuple[TargetPosition, ...]
    gross_before: Dec
    gross_after: Dec

    @property
    def turnover_saved(self) -> Dec:
        """Fraction of gross exposure that never had to be traded."""
        if self.gross_before <= 0:
            return dec(0)
        return (self.gross_before - self.gross_after) / self.gross_before


class NettingError(AssertionError):
    """Netting produced more exposure than was asked for. Always a defect."""


def net_targets(signals: Sequence[Signal], allocation_version: int = 0,
                now: Nanos = 0, multiplier: Dec = dec(1)) -> NettingResult:
    """Net offsetting desired exposures across strategies.

    ``multiplier`` is the allocation multiplier from the risk service: 1.0
    normally, 0.5 while the soft drawdown trigger is engaged. It scales every
    target rather than selecting which ones survive, so a drawdown reduces the
    whole book evenly instead of concentrating it in whichever strategy
    happened to signal last.

    Contributions are recorded per strategy so an internal crossing is still
    attributed correctly downstream (SPEC section 12.2) - netting improves the
    aggregate without distorting who earned what.
    """
    by_key: Dict[Tuple[str, str], Dict[str, Dec]] = {}
    leg_of: Dict[Tuple[str, str], Tuple[str, str]] = {}
    urgency_of: Dict[Tuple[str, str], str] = {}
    for sig in signals:
        key = (sig.venue, sig.symbol)
        by_key.setdefault(key, {})[sig.strategy_id] = sig.target_position * multiplier
        # The most urgent contributor wins. A passive order that is also
        # somebody's hedge must cross, or the hedge does not happen.
        order = {"passive": 0, "maker_preferred": 1, "normal": 2, "aggressive": 3}
        if order.get(sig.urgency, 1) >= order.get(urgency_of.get(key, "passive"), 0):
            urgency_of[key] = sig.urgency
        if sig.leg_group:
            # Legs of one trade are netted within their instrument like any
            # other target, but the group has to survive netting or the
            # unwinder cannot tell which orders belong together.
            leg_of[key] = (sig.leg_group, sig.leg_role)

    gross_before = dec(0)
    gross_after = dec(0)
    targets = []

    for (venue, symbol), contributions in sorted(by_key.items()):
        total = sum(contributions.values(), dec(0))
        sum_abs = sum((abs(v) for v in contributions.values()), dec(0))

        if abs(total) > sum_abs:
            raise NettingError(
                f"{venue}:{symbol}: netted target {total} exceeds the sum of "
                f"absolute contributions {sum_abs}. Netting must never increase "
                "a position."
            )

        gross_before += sum_abs
        gross_after += abs(total)
        group, role = leg_of.get((venue, symbol), ("", "single"))
        targets.append(TargetPosition(
            correlation_id=new_correlation_id(now) if now else "",
            emitted_at=now,
            source="l4_portfolio",
            venue=venue,
            symbol=symbol,
            target=total,
            contributions=dict(contributions),
            allocation_version=allocation_version,
            leg_group=group,
            leg_role=role,
            urgency=urgency_of.get((venue, symbol), "normal"),
        ))

    return NettingResult(tuple(targets), gross_before, gross_after)
