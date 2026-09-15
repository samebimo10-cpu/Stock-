"""The risk service.

SPEC section 8.3. Ordered cheapest-first so the common rejection costs the
least. **Any check failing rejects; there is no override path in code.** An
override is a config change under the two-person rule, which cannot be
executed in the heat of an incident by one person - which is the point.

Two invariants hold for every decision this service produces, and both are
property-tested:

* ``adjusted_quantity <= intent.quantity`` - risk reduces or refuses, never
  enlarges.
* **Timeout is a reject.** Absence of an approval is never an approval. A risk
  service that fails open is worse than no risk service, because it creates
  the belief that positions are checked.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Callable, Dict, List, Mapping, Optional, Tuple

from ...adapters.base import FilterRounder, RateLimitState
from ...core.errors import FilterViolation
from ...core.events import OrderIntent, RiskDecision, SymbolFilter
from ...core.types import Decimal as Dec, Nanos, dec, now_ns
from .killswitch import KillSwitch, SwitchState, Trigger
from .limits import LimitRegister
from .state import PortfolioState

__all__ = ["RiskService", "RiskContext", "CHECKS"]

#: The ordered check list of SPEC section 8.3, as names so a rejection reason
#: is greppable and a dashboard can count rejections per check.
CHECKS: Tuple[str, ...] = (
    "1_kill_switch",
    "2_strategy_enabled",
    "3_reconciliation_clean",
    "4_feed_fresh",
    "5_symbol_filters",
    "6_single_order_notional",
    "7_per_trade_risk",
    "8_position_limit",
    "9_concentration",
    "10_gross_exposure",
    "11_order_rate",
    "12_liquidation_distance",
    "13_loss_state",
)


@dataclass
class RiskContext:
    """Everything the checks read that is not portfolio state or a limit."""

    now: Nanos = 0
    #: Per-symbol last market event timestamp. A symbol absent from this map
    #: has no feed at all, which is a reject rather than a default.
    feed_last_event: Mapping[str, Nanos] = field(default_factory=dict)
    reconciliation_clean: bool = True
    rate_limit: Optional[RateLimitState] = None
    filters: Mapping[str, SymbolFilter] = field(default_factory=dict)
    mark_prices: Mapping[str, Dec] = field(default_factory=dict)
    #: Distance to liquidation per (venue, symbol) as a fraction of mark,
    #: after the proposed fill. Supplied by the caller because it depends on
    #: venue margin rules, which live in the adapter.
    liquidation_distance: Mapping[Tuple[str, str], Dec] = field(default_factory=dict)
    #: Fraction of notional considered at risk. Defaults to 1.0 - treating a
    #: position as a total loss - because a strategy that has not declared its
    #: stop should be sized as though it has none.
    stop_distance_frac: Mapping[str, Dec] = field(default_factory=dict)


class RiskService:
    """Standalone. It never imports a strategy and never holds venue credentials."""

    def __init__(
        self,
        limits: LimitRegister,
        state: PortfolioState,
        killswitch: Optional[KillSwitch] = None,
        clock: Callable[[], Nanos] = now_ns,
        source: str = "l5_risk",
    ) -> None:
        self.limits = limits
        self.state = state
        self.killswitch = killswitch or KillSwitch()
        self.clock = clock
        self.source = source
        self.rejections: Dict[str, int] = {c: 0 for c in CHECKS}

    # ------------------------------------------------------------------
    # Decision
    # ------------------------------------------------------------------

    def evaluate(self, intent: OrderIntent, ctx: Optional[RiskContext] = None) -> RiskDecision:
        ctx = ctx or RiskContext(now=self.clock())
        st = self.state
        lim = self.limits
        equity = st.equity
        snapshot = self._snapshot(intent, ctx)
        throttle = False

        def reject(check: str, detail: str = "") -> RiskDecision:
            self.rejections[check] = self.rejections.get(check, 0) + 1
            st.consecutive_rejects[intent.strategy_id] = (
                st.consecutive_rejects.get(intent.strategy_id, 0) + 1
            )
            if st.consecutive_rejects[intent.strategy_id] >= int(lim.get("consecutive_rejects")):
                st.disabled_strategies.add(intent.strategy_id)
            return RiskDecision(
                correlation_id=intent.correlation_id,
                emitted_at=ctx.now,
                source=self.source,
                intent_id=intent.client_order_id,
                approved=False,
                rejected_by=f"{check}{': ' + detail if detail else ''}",
                adjusted_quantity=None,
                limits_snapshot=snapshot,
            )

        # 1. Kill switch -------------------------------------------------
        if self.killswitch.is_engaged:
            # A reduce_only order is how a flatten gets executed, so it must
            # survive the switch that demanded the flatten.
            if not (intent.reduce_only and self.killswitch.state == SwitchState.FLATTENING):
                return reject(CHECKS[0], self.killswitch.blocking_reason() or "engaged")

        # 2. Strategy enabled --------------------------------------------
        if intent.strategy_id in st.disabled_strategies:
            return reject(CHECKS[1], intent.strategy_id)

        # 3. Reconciliation ----------------------------------------------
        if not ctx.reconciliation_clean:
            return reject(CHECKS[2], "reconciliation not clean")

        # 4. Feed freshness ----------------------------------------------
        last = ctx.feed_last_event.get(intent.symbol)
        if last is None:
            return reject(CHECKS[3], f"no feed for {intent.symbol}")
        stale_s = (ctx.now - last) / 1e9
        if stale_s > float(lim.get("feed_staleness_s")):
            return reject(CHECKS[3], f"{intent.symbol} stale {stale_s:.1f}s")

        # 5. Symbol filters ----------------------------------------------
        # L6 should have rounded already; a violation here is a defect, and it
        # is logged as one rather than quietly re-rounded.
        f = ctx.filters.get(intent.symbol)
        if f is not None:
            try:
                FilterRounder(f).validate(intent.quantity, intent.price)
            except FilterViolation as e:
                return reject(CHECKS[4], str(e))

        price = intent.price or ctx.mark_prices.get(intent.symbol)
        if price is None or price <= 0:
            return reject(CHECKS[4], f"no price for {intent.symbol}")
        notional = intent.quantity * price

        if equity <= 0:
            return reject(CHECKS[6], "equity is zero or negative")

        # 6. Single-order notional ---------------------------------------
        cap_by_equity = equity * lim.get("single_order_equity_frac")
        cap_by_median = st.median_order_notional * lim.get("single_order_median_mult")
        single_cap = max(cap_by_equity, cap_by_median)
        if notional > single_cap:
            return reject(CHECKS[5], f"notional {notional:.2f} over cap {single_cap:.2f}")

        # 7. Per-trade risk ----------------------------------------------
        stop = ctx.stop_distance_frac.get(intent.strategy_id, dec(1))
        risk_frac = (notional * stop) / equity
        if risk_frac > lim.get("per_trade_risk"):
            return reject(CHECKS[6], f"risk {risk_frac:.4f} over {lim.get('per_trade_risk')}")

        # 8. Position limit after fill -----------------------------------
        current = st.position_qty(intent.venue, intent.symbol)
        after = current + intent.signed_quantity
        after_notional = abs(after) * price
        pos_cap = equity * lim.get("per_trade_risk") / (stop if stop > 0 else dec(1))
        if after_notional > pos_cap:
            # Reduce rather than refuse, when a smaller order is still useful.
            room = pos_cap - abs(current) * price
            if room <= 0:
                return reject(CHECKS[7], f"position already at cap {pos_cap:.2f}")
            reduced = (room / price)
            if f is not None:
                reduced = FilterRounder(f).round_quantity(reduced)
            if reduced <= 0:
                return reject(CHECKS[7], "no room after rounding")
            return self._approve(intent, ctx, snapshot, reduced, throttle)

        # 9. Concentration -----------------------------------------------
        # Measured against max(gross book, equity), not against gross alone.
        # "25% of book" read literally makes the first trade impossible: one
        # position is 100% of a one-position book, so a limit measured purely
        # on gross rejects every opening order and the system can never start.
        # Using equity as a floor gives the rule its intended meaning - do not
        # let one asset dominate - while letting a small book grow into it.
        gross_after = st.gross_notional - abs(current) * price + after_notional
        base = gross_after if gross_after > equity else equity
        if base > 0:
            same_symbol = sum(
                (p.notional for (v, s), p in st.positions.items() if s == intent.symbol),
                dec(0),
            ) - abs(current) * price + after_notional
            if same_symbol / base > lim.get("asset_concentration"):
                return reject(CHECKS[8], f"{intent.symbol} concentration "
                                         f"{same_symbol / base:.3f}")

        # 10. Gross exposure ---------------------------------------------
        if gross_after / equity > lim.get("gross_exposure"):
            # Only reject *new* exposure. A trade that shrinks the book is
            # exactly what you want while over the limit.
            if after_notional > abs(current) * price:
                return reject(CHECKS[9], f"gross {gross_after / equity:.2f}x")

        # 11. Order rate -------------------------------------------------
        if ctx.rate_limit is not None:
            if ctx.rate_limit.weight_fraction > float(lim.get("order_rate")):
                throttle = True          # queue, do not reject

        # 12. Liquidation distance ---------------------------------------
        dist = ctx.liquidation_distance.get((intent.venue, intent.symbol))
        if dist is not None and dist < lim.get("liquidation_distance"):
            if after_notional > abs(current) * price:
                return reject(CHECKS[11], f"liquidation distance {dist:.3f}")

        # 13. Loss state --------------------------------------------------
        if st.daily_loss >= lim.get("daily_loss"):
            self.killswitch.engage(Trigger.DAILY_LOSS, ctx.now, f"{st.daily_loss:.4f}")
            return reject(CHECKS[12], f"daily loss {st.daily_loss:.4f}")
        if st.weekly_loss >= lim.get("weekly_loss"):
            self.killswitch.engage(Trigger.WEEKLY_LOSS, ctx.now, f"{st.weekly_loss:.4f}")
            return reject(CHECKS[12], f"weekly loss {st.weekly_loss:.4f}")

        st.consecutive_rejects[intent.strategy_id] = 0
        return self._approve(intent, ctx, snapshot, intent.quantity, throttle)

    def _approve(self, intent: OrderIntent, ctx: RiskContext,
                 snapshot: Mapping[str, Dec], quantity: Dec, throttle: bool) -> RiskDecision:
        # The invariant, asserted rather than assumed. If this ever trips, the
        # bug is here and not downstream.
        assert quantity <= intent.quantity, "risk may reduce or refuse, never enlarge"
        return RiskDecision(
            correlation_id=intent.correlation_id,
            emitted_at=ctx.now,
            source=self.source,
            intent_id=intent.client_order_id,
            approved=True,
            rejected_by=None,
            adjusted_quantity=quantity,
            limits_snapshot=snapshot,
            throttle=throttle,
        )

    def _snapshot(self, intent: OrderIntent, ctx: RiskContext) -> Dict[str, Dec]:
        """Limit utilisation at decision time, for the audit trail."""
        st = self.state
        return {
            "equity": st.equity,
            "drawdown": st.drawdown,
            "daily_loss": st.daily_loss,
            "weekly_loss": st.weekly_loss,
            "gross_exposure": st.gross_exposure,
            "asset_concentration": st.asset_concentration(intent.symbol),
            "venue_share": st.venue_share(intent.venue),
        }

    # ------------------------------------------------------------------
    # Continuous monitoring
    # ------------------------------------------------------------------

    def check_drawdown_ladder(self, now: Nanos) -> Optional[str]:
        """Run the ladder. Returns the level newly engaged, if any.

        The ladder is why the hard stop can be tightened rather than loosened:
        acting at 8% is what makes 12% rare.
        """
        dd = self.state.drawdown
        if dd >= self.limits.get("drawdown_hard"):
            self.killswitch.engage(Trigger.DRAWDOWN_HARD, now, f"drawdown {dd:.4f}")
            return Trigger.DRAWDOWN_HARD
        if dd >= self.limits.get("drawdown_soft"):
            self.killswitch.engage(Trigger.DRAWDOWN_SOFT, now, f"drawdown {dd:.4f}")
            return Trigger.DRAWDOWN_SOFT
        if dd >= self.limits.get("drawdown_amber"):
            return "drawdown_amber"
        return None

    def allocation_multiplier(self) -> Dec:
        """1.0 normally; 0.5 while the soft drawdown trigger is engaged."""
        return dec("0.5") if Trigger.DRAWDOWN_SOFT in self.killswitch.engaged else dec(1)

    def on_venue_concentration(self, now: Nanos) -> List[str]:
        """Venues holding more than the permitted share of capital."""
        cap = self.limits.get("venue_concentration")
        return [v for v in self.state.venue_capital if self.state.venue_share(v) > cap]
