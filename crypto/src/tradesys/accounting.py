"""Books, per-strategy attribution and capacity (SPEC section 12).

Absent from v1.0 of the specification entirely, and its absence is not a
back-office oversight. Without per-strategy attribution you cannot answer
"which strategy is making money", which makes the portfolio layer decorative
and every allocation decision an opinion.

Four things this module is strict about, each because the alternative produces
a number that is quietly wrong:

* **One definition of equity**, used everywhere. Two definitions in one system
  means two different drawdown numbers and an argument during an incident.
  :meth:`Books.apply_to` pushes this ledger's numbers into the risk service's
  state so the risk layer and the books cannot disagree.
* **Funding accrues continuously**, not in lumps at settlement. Lumpy booking
  puts step changes in the equity curve, and those corrupt the drawdown and
  Sharpe measurements that the whole validation protocol rests on.
* **Mark price, not last trade.** Last trade can be an outlier; mark price is
  what the exchange liquidates against, so it is what the position is worth.
* **Shared costs are allocated and reported separately.** A strategy that is
  profitable gross and unprofitable after its share of a $40k market-data bill
  is unprofitable, and this is the only place that becomes visible.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from .core.events import Fill, Position
from .core.types import Decimal as Dec, Nanos, dec

__all__ = ["Books", "StrategyLedger", "FeeRecord", "CapacityEstimate",
           "estimate_capacity", "allocate_shared_costs"]


@dataclass(frozen=True)
class FeeRecord:
    at: Nanos
    venue: str
    symbol: str
    strategy_id: str
    amount: Dec
    is_maker: bool
    currency: str = "USDT"


@dataclass
class StrategyLedger:
    """One strategy's books. Gross of shared costs; those are allocated later."""

    strategy_id: str
    realised: Dec = dec(0)
    unrealised: Dec = dec(0)
    fees: Dec = dec(0)
    funding: Dec = dec(0)          # positive when received
    borrow: Dec = dec(0)           # positive when paid
    slippage: Dec = dec(0)
    fills: int = 0
    volume: Dec = dec(0)
    #: Signed quantity and average entry, keyed by (venue, symbol).
    positions: Dict[Tuple[str, str], Tuple[Dec, Dec]] = field(default_factory=dict)

    @property
    def gross_pnl(self) -> Dec:
        """Before costs. The number that flatters a strategy."""
        return self.realised + self.unrealised + self.funding

    @property
    def net_pnl(self) -> Dec:
        return self.gross_pnl - self.fees - self.borrow - self.slippage

    @property
    def total_costs(self) -> Dec:
        return self.fees + self.borrow + self.slippage

    @property
    def cost_ratio(self) -> Optional[Dec]:
        """Costs as a fraction of gross profit and loss.

        The SPEC section 1.2 gate is below 40%. Above that the edge belongs to
        the exchange, and a small adverse move in fee tier or spread flips the
        strategy negative.

        ``None`` when gross is not positive: a ratio against a negative
        denominator is not a number anyone should act on.
        """
        if self.gross_pnl <= 0:
            return None
        return self.total_costs / self.gross_pnl

    @property
    def passes_cost_gate(self) -> bool:
        ratio = self.cost_ratio
        return ratio is not None and ratio < dec("0.40")


class Books:
    """The ledger. Every fill, fee, funding payment and mark passes through it."""

    def __init__(self, starting_cash: Dec = dec(0)) -> None:
        self.starting_cash = starting_cash
        self.cash = starting_cash
        self.realised = dec(0)
        self.accrued_funding = dec(0)
        self.accrued_borrow = dec(0)
        #: Amounts that have moved from accrual into cash. Tracked separately
        #: so the ledger can be closed: cash is the sum of everything that
        #: settled, and a check that ignores funding would report a healthy
        #: ledger as broken the moment a carry position pays.
        self.settled_funding = dec(0)
        self.settled_borrow = dec(0)
        self.total_slippage = dec(0)
        self.fee_ledger: List[FeeRecord] = []
        self.positions: Dict[Tuple[str, str], Position] = {}
        self.strategies: Dict[str, StrategyLedger] = {}
        self._marks: Dict[Tuple[str, str], Dec] = {}
        #: Funding accrued but not yet settled, per position.
        self._funding_accrual: Dict[Tuple[str, str], Dec] = {}

    # ------------------------------------------------------------------
    # Equity - the single definition
    # ------------------------------------------------------------------

    @property
    def unrealised(self) -> Dec:
        total = dec(0)
        for key, pos in self.positions.items():
            mark = self._marks.get(key)
            if mark is None:
                continue
            total += (mark - pos.avg_entry_price) * pos.quantity
        return total

    @property
    def equity(self) -> Dec:
        """``cash + unrealised + accrued funding - accrued borrow``.

        Identical to :attr:`PortfolioState.equity` by construction, and
        :meth:`apply_to` keeps them that way.
        """
        return self.cash + self.unrealised + self.accrued_funding - self.accrued_borrow

    @property
    def gross_notional(self) -> Dec:
        total = dec(0)
        for key, pos in self.positions.items():
            mark = self._marks.get(key, pos.avg_entry_price)
            total += abs(pos.quantity) * mark
        return total

    def apply_to(self, state) -> None:
        """Push these numbers into a :class:`PortfolioState`.

        The risk service computes every limit from that state, so this is what
        stops the books and the risk layer holding different views of the same
        account.
        """
        state.cash = self.cash
        state.unrealised = self.unrealised
        state.accrued_funding = self.accrued_funding
        state.accrued_borrow = self.accrued_borrow
        state.positions = dict(self.positions)
        state.mark()

    # ------------------------------------------------------------------
    # Events
    # ------------------------------------------------------------------

    def ledger(self, strategy_id: str) -> StrategyLedger:
        if strategy_id not in self.strategies:
            self.strategies[strategy_id] = StrategyLedger(strategy_id)
        return self.strategies[strategy_id]

    def on_fill(self, fill: Fill, slippage: Dec = dec(0)) -> None:
        """Book a fill: position, realised profit on any reduction, and fees."""
        key = (fill.venue, fill.symbol)
        led = self.ledger(fill.strategy_id)
        signed = fill.signed_quantity

        realised = self._apply_position(key, signed, fill.price, led)
        self.realised += realised
        self.cash += realised

        self.cash -= fill.fee
        led.fees += fill.fee
        led.slippage += slippage
        led.fills += 1
        led.volume += abs(fill.quantity) * fill.price
        self.fee_ledger.append(FeeRecord(
            at=fill.local_recv_ts or fill.emitted_at, venue=fill.venue,
            symbol=fill.symbol, strategy_id=fill.strategy_id, amount=fill.fee,
            is_maker=fill.is_maker, currency=fill.fee_currency,
        ))
        if slippage:
            self.cash -= slippage
            self.total_slippage += slippage
        self._refresh_strategy_unrealised()

    def _apply_position(self, key, signed: Dec, price: Dec,
                        led: StrategyLedger) -> Dec:
        """Update the position and return realised profit on any reduction."""
        realised = dec(0)
        current = self.positions.get(key)

        if current is None or current.quantity == 0:
            self.positions[key] = Position(key[0], key[1], signed, price, price)
        else:
            qty = current.quantity
            new_qty = qty + signed
            same_direction = (qty > 0) == (signed > 0)

            if same_direction:
                avg = (qty * current.avg_entry_price + signed * price) / new_qty
            elif new_qty == 0:
                realised = (price - current.avg_entry_price) * qty
                avg = dec(0)
            elif (qty > 0) == (new_qty > 0):
                # Partial reduction: realise on the closed portion only.
                closed = -signed
                realised = (price - current.avg_entry_price) * closed
                avg = current.avg_entry_price
            else:
                # Flipped through zero: realise the whole old position, then
                # the remainder opens a new one at the fill price.
                realised = (price - current.avg_entry_price) * qty
                avg = price

            if new_qty == 0:
                self.positions.pop(key, None)
            else:
                self.positions[key] = Position(key[0], key[1], new_qty, avg,
                                               self._marks.get(key))

        led.realised += realised

        # Mirror into the strategy's own position view, for attribution.
        prev_qty, prev_avg = led.positions.get(key, (dec(0), dec(0)))
        led_new = prev_qty + signed
        if led_new == 0:
            led.positions.pop(key, None)
        elif prev_qty == 0 or (prev_qty > 0) == (signed > 0):
            led.positions[key] = (
                led_new,
                price if prev_qty == 0 else (prev_qty * prev_avg + signed * price) / led_new,
            )
        else:
            led.positions[key] = (led_new, prev_avg)

        return realised

    def _refresh_strategy_unrealised(self) -> None:
        """Recompute every strategy's unrealised profit from live positions.

        Called after any position change as well as after a mark. Refreshing
        only on marks leaves a stale value behind when a position closes: the
        ledger keeps reporting unrealised profit on a position it no longer
        holds, and that inflates its gross profit permanently.
        """
        for led in self.strategies.values():
            led.unrealised = sum(
                ((self._marks.get(k, avg) - avg) * qty
                 for k, (qty, avg) in led.positions.items()),
                dec(0),
            )

    def mark(self, venue: str, symbol: str, mark_price: Dec) -> None:
        """Update the mark. Mark price, never last trade."""
        key = (venue, symbol)
        self._marks[key] = mark_price
        pos = self.positions.get(key)
        if pos is not None:
            self.positions[key] = Position(venue, symbol, pos.quantity,
                                           pos.avg_entry_price, mark_price,
                                           pos.liquidation_price)
        self._refresh_strategy_unrealised()

    def accrue_funding(self, venue: str, symbol: str, rate_per_interval: Dec,
                       fraction_of_interval: Dec, strategy_id: str) -> Dec:
        """Accrue funding continuously between settlements.

        Booking funding in lumps at settlement puts step changes into the
        equity curve, and those corrupt the drawdown and Sharpe measurements
        the validation protocol depends on.

        A **short** perpetual receives funding when the rate is positive, so
        the sign follows the position.
        """
        key = (venue, symbol)
        pos = self.positions.get(key)
        if pos is None or pos.quantity == 0:
            return dec(0)
        mark = self._marks.get(key, pos.avg_entry_price)
        notional = abs(pos.quantity) * mark
        received = notional * rate_per_interval * fraction_of_interval
        if pos.quantity > 0:
            received = -received          # longs pay when funding is positive
        self.accrued_funding += received
        self._funding_accrual[key] = self._funding_accrual.get(key, dec(0)) + received
        self.ledger(strategy_id).funding += received
        return received

    def settle_funding(self, venue: str, symbol: str) -> Dec:
        """Move accrued funding into cash at the settlement boundary."""
        key = (venue, symbol)
        amount = self._funding_accrual.pop(key, dec(0))
        self.accrued_funding -= amount
        self.cash += amount
        self.settled_funding += amount
        return amount

    def accrue_borrow(self, venue: str, symbol: str, rate_per_day: Dec,
                      days: Dec, strategy_id: str) -> Dec:
        key = (venue, symbol)
        pos = self.positions.get(key)
        if pos is None or pos.quantity >= 0:
            return dec(0)                 # only shorts borrow
        mark = self._marks.get(key, pos.avg_entry_price)
        cost = abs(pos.quantity) * mark * rate_per_day * days
        self.accrued_borrow += cost
        self.ledger(strategy_id).borrow += cost
        return cost

    def book_internal_cross(self, venue: str, symbol: str, buyer: str, seller: str,
                            quantity: Dec, mid: Dec) -> None:
        """Book a netted internal crossing at mid, to both strategies.

        Netting (SPEC section 7.3) improves the aggregate by not trading the
        offsetting portion. Without this, the strategy whose order was netted
        away looks as though it never traded, and its attribution is wrong in
        the direction that makes netting look free.
        """
        self.ledger(buyer)  # ensure both ledgers exist
        self.ledger(seller)
        for strategy_id, signed in ((buyer, quantity), (seller, -quantity)):
            led = self.ledger(strategy_id)
            key = (venue, symbol)
            prev_qty, prev_avg = led.positions.get(key, (dec(0), dec(0)))
            new_qty = prev_qty + signed
            if new_qty == 0:
                led.realised += (mid - prev_avg) * prev_qty
                led.positions.pop(key, None)
            elif prev_qty == 0 or (prev_qty > 0) == (signed > 0):
                led.positions[key] = (
                    new_qty,
                    mid if prev_qty == 0 else (prev_qty * prev_avg + signed * mid) / new_qty,
                )
            else:
                led.realised += (mid - prev_avg) * (-signed)
                led.positions[key] = (new_qty, prev_avg)
        self._refresh_strategy_unrealised()

    # ------------------------------------------------------------------
    # Reporting
    # ------------------------------------------------------------------

    def maker_ratio(self) -> Optional[Dec]:
        if not self.fee_ledger:
            return None
        makers = sum(1 for f in self.fee_ledger if f.is_maker)
        return dec(makers) / dec(len(self.fee_ledger))

    def total_fees(self, strategy_id: Optional[str] = None) -> Dec:
        rows = [f for f in self.fee_ledger
                if strategy_id is None or f.strategy_id == strategy_id]
        return sum((f.amount for f in rows), dec(0))

    def daily_report(self) -> Dict[str, object]:
        return {
            "equity": self.equity,
            "cash": self.cash,
            "realised": self.realised,
            "unrealised": self.unrealised,
            "accrued_funding": self.accrued_funding,
            "accrued_borrow": self.accrued_borrow,
            "gross_notional": self.gross_notional,
            "fees_total": self.total_fees(),
            "maker_ratio": self.maker_ratio(),
            "by_strategy": {
                sid: {
                    "gross": led.gross_pnl, "net": led.net_pnl,
                    "fees": led.fees, "funding": led.funding,
                    "cost_ratio": led.cost_ratio,
                    "passes_cost_gate": led.passes_cost_gate,
                    "fills": led.fills,
                }
                for sid, led in sorted(self.strategies.items())
            },
        }

    def expected_cash(self) -> Dec:
        """What cash should be, from everything that has actually settled."""
        return (self.starting_cash
                + self.realised
                - self.total_fees()
                - self.total_slippage
                + self.settled_funding
                - self.settled_borrow)

    def reconciles(self, tolerance: Dec = dec("0.01")) -> bool:
        """Cash must equal the sum of everything that settled into it.

        A ledger that does not close is wrong somewhere, and finding out at the
        month end is finding out too late. Unrealised profit is deliberately
        not in this check: it has not settled, so it cannot be in cash.
        """
        return abs(self.cash - self.expected_cash()) <= tolerance

    def reconciliation_error(self) -> Dec:
        """Signed difference, for an alert that says how far off it is."""
        return self.cash - self.expected_cash()


# ----------------------------------------------------------------------
# Shared costs and capacity
# ----------------------------------------------------------------------


def allocate_shared_costs(total: Dec, risk_contributions: Mapping[str, float]) -> Dict[str, Dec]:
    """Split infrastructure, data and idle-capital costs by risk contribution.

    Reported separately from trading costs (SPEC section 12.2), because a
    strategy can be profitable gross and unprofitable after its share of the
    bill, and only this makes that visible.
    """
    total_rc = sum(risk_contributions.values())
    if total_rc <= 0:
        n = len(risk_contributions) or 1
        return {k: total / dec(n) for k in risk_contributions}
    return {
        k: total * dec(str(rc)) / dec(str(total_rc))
        for k, rc in risk_contributions.items()
    }


@dataclass(frozen=True)
class CapacityEstimate:
    """SPEC section 12.4. A strategy without one is not approved for live capital."""

    capacity: Dec
    binding_constraint: str
    deploy_at_most: Dec
    curve: Tuple[Tuple[Dec, Dec], ...]      # (capital, net return)

    @property
    def is_known(self) -> bool:
        return self.capacity > 0


def estimate_capacity(curve: Sequence[Tuple[Dec, Dec]],
                      binding_constraint: str = "unknown",
                      deploy_fraction: Dec = dec("0.25")) -> CapacityEstimate:
    """Capital at which net return falls to half its small-size value.

    ``curve`` is (capital, net return) from re-running the backtest at
    increasing size with impact modelled from real book depth.

    Deploy at most 25% of the estimate: it was produced by the same models the
    cost-model section warns are optimistic.

    >>> c = estimate_capacity([(dec("10000"), dec("0.20")), (dec("100000"), dec("0.09"))], "book depth")
    >>> c.capacity, c.deploy_at_most
    (Decimal('100000'), Decimal('25000.00'))
    """
    if not curve:
        return CapacityEstimate(dec(0), "not estimated", dec(0), ())
    ordered = sorted(curve, key=lambda row: row[0])
    baseline = ordered[0][1]
    if baseline <= 0:
        return CapacityEstimate(dec(0), "no edge at any size", dec(0), tuple(ordered))
    half = baseline / 2
    capacity = ordered[-1][0]
    for capital, ret in ordered:
        if ret <= half:
            capacity = capital
            break
    return CapacityEstimate(capacity, binding_constraint,
                            capacity * deploy_fraction, tuple(ordered))
