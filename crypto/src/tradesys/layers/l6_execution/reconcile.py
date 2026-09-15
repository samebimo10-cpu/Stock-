"""Reconciliation (SPEC section 9.4, Annex D section 4).

v1.0 of the specification says "reconcile continuously". This is what that
means, and the discrepancy *classes* matter more than the loop: they are what
decide whether the system corrects itself or stops.

The rule that carries the most weight: **MISSING_LOCAL is never auto-adopted**.
Adopting a position you cannot explain means managing exposure no strategy
requested and no risk check approved. The correct response to finding it is to
stop.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, List, Mapping, Optional, Sequence, Tuple

from ...core.events import OrderState, OrderStatus, Position, ReconciliationReport
from ...core.ids import new_correlation_id
from ...core.types import Decimal as Dec, Nanos, dec

__all__ = ["DiscrepancyClass", "Discrepancy", "Reconciler"]


class DiscrepancyClass:
    CLEAN = "CLEAN"
    #: The exchange has a position or order we do not know about. HALT.
    MISSING_LOCAL = "MISSING_LOCAL"
    #: We believe in an order the exchange lacks.
    MISSING_REMOTE = "MISSING_REMOTE"
    QTY_MISMATCH = "QTY_MISMATCH"
    PRICE_MISMATCH = "PRICE_MISMATCH"
    BALANCE_DRIFT = "BALANCE_DRIFT"
    #: Reconciliation did not complete in its window.
    STALE = "STALE"

    #: Classes that stop trading immediately.
    HALTING = frozenset({MISSING_LOCAL})
    SEVERITY = {
        CLEAN: "P3", MISSING_LOCAL: "P1", MISSING_REMOTE: "P2",
        QTY_MISMATCH: "P1", PRICE_MISMATCH: "P3", BALANCE_DRIFT: "P2", STALE: "P1",
    }


@dataclass(frozen=True)
class Discrepancy:
    kind: str
    venue: str
    symbol: str
    detail: str
    local: Optional[Dec] = None
    remote: Optional[Dec] = None
    halting: bool = False

    def as_dict(self) -> Dict[str, object]:
        return {
            "kind": self.kind, "venue": self.venue, "symbol": self.symbol,
            "detail": self.detail,
            "local": str(self.local) if self.local is not None else None,
            "remote": str(self.remote) if self.remote is not None else None,
            "severity": DiscrepancyClass.SEVERITY.get(self.kind, "P2"),
        }


class Reconciler:
    """Compares local belief against venue truth. The venue always wins."""

    def __init__(self, venue: str, qty_mismatch_halt_frac: Dec = dec("0.001"),
                 stale_halt_after: int = 3) -> None:
        self.venue = venue
        #: A quantity mismatch above this fraction of equity halts rather than
        #: merely correcting. Small drift is a fee rounding; large drift means
        #: we do not know what we hold.
        self.qty_mismatch_halt_frac = qty_mismatch_halt_frac
        self.stale_halt_after = stale_halt_after
        self.consecutive_stale = 0
        self.cycles = 0
        self.last_report: Optional[ReconciliationReport] = None

    def reconcile(
        self,
        local_positions: Mapping[Tuple[str, str], Position],
        remote_positions: Sequence[Position],
        local_orders: Mapping[str, OrderState],
        remote_orders: Sequence[OrderState],
        equity: Dec,
        now: Nanos,
        local_balances: Optional[Mapping[str, Dec]] = None,
        remote_balances: Optional[Mapping[str, Dec]] = None,
    ) -> ReconciliationReport:
        self.cycles += 1
        found: List[Discrepancy] = []

        remote_by_key = {(p.venue, p.symbol): p for p in remote_positions}

        # Positions the venue has and we do not.
        for key, rp in remote_by_key.items():
            if key not in local_positions and rp.quantity != 0:
                found.append(Discrepancy(
                    DiscrepancyClass.MISSING_LOCAL, rp.venue, rp.symbol,
                    "exchange holds a position we have no record of; "
                    "halting rather than adopting it",
                    local=dec(0), remote=rp.quantity, halting=True,
                ))

        # Positions we believe in, compared against the venue's.
        for key, lp in local_positions.items():
            rp = remote_by_key.get(key)
            if rp is None:
                if lp.quantity != 0:
                    found.append(Discrepancy(
                        DiscrepancyClass.QTY_MISMATCH, lp.venue, lp.symbol,
                        "we believe in a position the exchange does not have",
                        local=lp.quantity, remote=dec(0),
                        halting=self._material(abs(lp.quantity) * _px(lp), equity),
                    ))
                continue
            if lp.quantity != rp.quantity:
                delta_notional = abs(lp.quantity - rp.quantity) * _px(rp)
                found.append(Discrepancy(
                    DiscrepancyClass.QTY_MISMATCH, lp.venue, lp.symbol,
                    "exchange wins; local corrected",
                    local=lp.quantity, remote=rp.quantity,
                    halting=self._material(delta_notional, equity),
                ))
            elif lp.avg_entry_price != rp.avg_entry_price:
                found.append(Discrepancy(
                    DiscrepancyClass.PRICE_MISMATCH, lp.venue, lp.symbol,
                    "average entry differs; attribution corrected",
                    local=lp.avg_entry_price, remote=rp.avg_entry_price,
                ))

        # Orders.
        remote_ids = {o.client_order_id for o in remote_orders}
        for o in remote_orders:
            if o.client_order_id not in local_orders:
                found.append(Discrepancy(
                    DiscrepancyClass.MISSING_LOCAL, self.venue, o.symbol,
                    f"exchange has open order {o.client_order_id} we do not know about",
                    halting=True,
                ))
        for coid, lo in local_orders.items():
            if lo.status in OrderStatus.TERMINAL:
                continue
            if coid not in remote_ids:
                found.append(Discrepancy(
                    DiscrepancyClass.MISSING_REMOTE, self.venue, lo.symbol,
                    f"we believe order {coid} is open; the exchange does not have it. "
                    "Query it by client order ID before concluding anything",
                ))

        # Balances.
        if local_balances and remote_balances:
            for asset, local_amt in local_balances.items():
                remote_amt = remote_balances.get(asset, dec(0))
                if local_amt != remote_amt:
                    found.append(Discrepancy(
                        DiscrepancyClass.BALANCE_DRIFT, self.venue, asset,
                        "usually an unbooked fee or funding payment",
                        local=local_amt, remote=remote_amt,
                    ))

        report = ReconciliationReport(
            correlation_id=new_correlation_id(now),
            emitted_at=now,
            source=f"l6_reconcile:{self.venue}",
            venue=self.venue,
            clean=not found,
            discrepancies=tuple(d.as_dict() for d in found),
            checked_positions=len(remote_by_key),
            checked_orders=len(remote_orders),
        )
        self.last_report = report
        self.consecutive_stale = 0
        return report

    def on_cycle_failed(self) -> bool:
        """Record a reconciliation cycle that did not complete.

        Returns True when the cycle count reaches the halt threshold. Three in
        a row is a kill-switch trigger: not knowing what you hold is worse
        than knowing something bad.
        """
        self.consecutive_stale += 1
        return self.consecutive_stale >= self.stale_halt_after

    def _material(self, delta_notional: Dec, equity: Dec) -> bool:
        if equity <= 0:
            return True
        return (delta_notional / equity) > self.qty_mismatch_halt_frac

    @staticmethod
    def halting_discrepancies(report: ReconciliationReport) -> List[Mapping[str, object]]:
        return [d for d in report.discrepancies
                if d.get("kind") in DiscrepancyClass.HALTING or d.get("severity") == "P1"]


def _px(p: Position) -> Dec:
    return p.mark_price if p.mark_price is not None else p.avg_entry_price
