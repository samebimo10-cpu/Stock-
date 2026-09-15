"""Event schemas - the typed message at every layer boundary.

SPEC Annex A. Every message is a frozen dataclass: a layer that mutates a
message it received breaks replay (SPEC section 10.4), and replay is what
makes "same code path for backtest, paper and live" a property rather than an
intention.

Each message carries an :class:`Envelope` with a schema version and the
correlation ID minted in L1.
"""

from __future__ import annotations

from dataclasses import dataclass, field, replace
from decimal import Decimal
from typing import Any, Mapping, Optional, Tuple

from .ids import CorrelationId
from .types import Nanos

__all__ = [
    "SCHEMA_VERSION",
    "Envelope",
    "QualityFlags",
    "BookLevel",
    "BookDelta",
    "BookSnapshot",
    "Trade",
    "Funding",
    "OpenInterest",
    "Mark",
    "Liquidation",
    "MarketEvent",
    "FeatureSnapshot",
    "Signal",
    "TargetPosition",
    "OrderIntent",
    "RiskDecision",
    "OrderStatus",
    "OrderState",
    "Fill",
    "Position",
    "Balance",
    "SymbolFilter",
    "ExchangeInfo",
    "FeeSchedule",
    "ReconciliationReport",
    "AuditRecord",
    "replace",
]

SCHEMA_VERSION = 1

Side = str          # "buy" | "sell"
Venue = str
StrategyId = str


@dataclass(frozen=True)
class Envelope:
    """Common header on every cross-layer message."""

    correlation_id: CorrelationId
    emitted_at: Nanos
    source: str
    schema_version: int = SCHEMA_VERSION


# --------------------------------------------------------------------------
# L1 -> L2
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class QualityFlags:
    """Travels *with* the event, never in a side channel (Annex A section 2).

    A consumer must be able to decide from the event alone whether to trust
    it. Quality information delivered separately arrives at a different time
    and gets ignored.
    """

    gap_detected: bool = False
    resync_in_progress: bool = False
    stale: bool = False
    crossed_book: bool = False

    @property
    def usable_for_research(self) -> bool:
        return not (self.gap_detected or self.resync_in_progress or self.crossed_book)


CLEAN = QualityFlags()

#: (price, quantity). Quantity zero deletes the level.
BookLevel = Tuple[Decimal, Decimal]


@dataclass(frozen=True)
class BookDelta:
    bids: Tuple[BookLevel, ...]
    asks: Tuple[BookLevel, ...]
    first_update_id: int
    final_update_id: int


@dataclass(frozen=True)
class BookSnapshot:
    bids: Tuple[BookLevel, ...]   # descending price
    asks: Tuple[BookLevel, ...]   # ascending price
    last_update_id: int


@dataclass(frozen=True)
class Trade:
    price: Decimal
    quantity: Decimal
    aggressor_side: Side      # the side that crossed the spread
    trade_id: int


@dataclass(frozen=True)
class Funding:
    rate: Decimal             # the per-interval rate, e.g. 8h on Binance
    interval_hours: int
    next_settlement: Nanos
    predicted: Optional[Decimal] = None


@dataclass(frozen=True)
class OpenInterest:
    value: Decimal
    notional: Optional[Decimal] = None


@dataclass(frozen=True)
class Mark:
    mark_price: Decimal
    index_price: Optional[Decimal] = None


@dataclass(frozen=True)
class Liquidation:
    price: Decimal
    quantity: Decimal
    side: Side


@dataclass(frozen=True)
class MarketEvent(Envelope):
    """L1 to L2. Budget p99 500us [B] / 10ms [A]."""

    venue: Venue = ""
    symbol: str = ""
    kind: str = ""            # book_delta|book_snapshot|trade|funding|oi|mark|liquidation
    exchange_ts: Nanos = 0    # as reported by the venue
    local_recv_ts: Nanos = 0  # when our NIC saw it
    sequence: Optional[int] = None
    payload: Any = None
    quality: QualityFlags = CLEAN

    @property
    def transit_ns(self) -> int:
        """Venue-to-us latency. Both a latency measure and a quality signal.

        A system that records only one of the two timestamps cannot compute
        this afterwards, which is why both are mandatory (SPEC section 4.2).
        """
        return self.local_recv_ts - self.exchange_ts


# --------------------------------------------------------------------------
# L2 -> L3
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class FeatureSnapshot(Envelope):
    """L2 to L3. Budget p99 1ms [B] / 20ms [A]."""

    venue: Venue = ""
    symbol: str = ""
    #: timestamp of the LAST INPUT EVENT, not of computation. Consumers assert
    #: ``decision_ts >= as_of``, which is what makes the look-ahead audit of
    #: SPEC section 5.4 possible.
    as_of: Nanos = 0
    #: ``None`` means genuinely missing. Imputation is forbidden in the live
    #: path (SPEC section 5.3): a missing input yields a missing feature and
    #: the strategy handles it explicitly.
    features: Mapping[str, Optional[Decimal]] = field(default_factory=dict)
    #: feature name -> content hash of the code that produced it, so a
    #: backtest from two years ago can be reproduced exactly.
    feature_versions: Mapping[str, str] = field(default_factory=dict)
    inputs_complete: bool = True

    def get(self, name: str) -> Optional[Decimal]:
        return self.features.get(name)

    def require(self, *names: str) -> bool:
        """True only if every named feature is present and non-None."""
        return all(self.features.get(n) is not None for n in names)


# --------------------------------------------------------------------------
# L3 -> L4 -> L5
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class Signal(Envelope):
    """Desired exposure, not an order (SPEC section 6.2).

    Translating desire into orders is L6's job. Keeping that boundary is what
    lets execution improve without touching strategy code.
    """

    strategy_id: StrategyId = ""
    venue: Venue = ""
    symbol: str = ""
    target_position: Decimal = Decimal(0)   # signed, base units
    urgency: str = "normal"                 # passive|normal|aggressive
    limit_price: Optional[Decimal] = None
    #: Mandatory. A signal without an expiry is one that will eventually be
    #: acted on at the wrong time, after a queue backs up.
    valid_until: Nanos = 0
    confidence: Decimal = Decimal(1)
    rationale: Mapping[str, Decimal] = field(default_factory=dict)
    #: Ties the legs of one multi-leg trade together. Empty for a single-leg
    #: signal. Legs sharing a group are filled or unwound as a unit - never
    #: left half done, which is the exposure nobody sized for.
    leg_group: str = ""
    leg_role: str = "single"        # single | primary | hedge

    def is_valid_at(self, ts: Nanos) -> bool:
        return ts < self.valid_until


@dataclass(frozen=True)
class TargetPosition(Envelope):
    venue: Venue = ""
    symbol: str = ""
    target: Decimal = Decimal(0)            # post-netting, post-allocation
    contributions: Mapping[StrategyId, Decimal] = field(default_factory=dict)
    allocation_version: int = 0
    leg_group: str = ""
    leg_role: str = "single"
    urgency: str = "normal"


@dataclass(frozen=True)
class OrderIntent(Envelope):
    """L5 to L6. Quantity and price are ALREADY rounded by the adapter."""

    client_order_id: str = ""
    venue: Venue = ""
    symbol: str = ""
    side: Side = "buy"
    quantity: Decimal = Decimal(0)
    order_type: str = "limit"               # limit|market|limit_maker|stop_limit
    price: Optional[Decimal] = None
    time_in_force: str = "GTC"
    post_only: bool = False
    reduce_only: bool = False
    strategy_id: StrategyId = ""

    @property
    def signed_quantity(self) -> Decimal:
        return self.quantity if self.side == "buy" else -self.quantity


@dataclass(frozen=True)
class RiskDecision(Envelope):
    """The answer from L5.

    Two invariants, asserted in code and in property tests:

    * ``adjusted_quantity <= intent.quantity`` - risk reduces or refuses, it
      never enlarges.
    * **No decision means reject.** Absence of an approval is never an
      approval, and a client that treats a timeout as permission has defeated
      the layer.
    """

    intent_id: str = ""
    approved: bool = False
    rejected_by: Optional[str] = None       # check number and name from SPEC 8.3
    adjusted_quantity: Optional[Decimal] = None
    limits_snapshot: Mapping[str, Decimal] = field(default_factory=dict)
    #: Order-rate pressure. Check 11 of SPEC section 8.3 throttles rather than
    #: rejects: the order is still wanted, it should simply queue. Rejecting on
    #: rate pressure would silently drop intent that the strategy believes went
    #: out.
    throttle: bool = False


# --------------------------------------------------------------------------
# Order state
# --------------------------------------------------------------------------


class OrderStatus:
    """States from SPEC section 9.2 / Annex A section 4.3."""

    INTENT = "INTENT"
    PENDING = "PENDING"
    ACKED = "ACKED"
    PARTIAL = "PARTIAL"
    FILLED = "FILLED"
    CANCELLED = "CANCELLED"
    REJECTED = "REJECTED"
    #: State unknown. A trap state: poll until resolved, and never place a new
    #: order for this intent. Its absence is what turns a request timeout into
    #: a double fill.
    QUERY = "QUERY"

    TERMINAL = frozenset({FILLED, CANCELLED, REJECTED})
    OPEN = frozenset({PENDING, ACKED, PARTIAL, QUERY})


@dataclass(frozen=True)
class OrderState(Envelope):
    client_order_id: str = ""
    venue_order_id: Optional[str] = None
    venue: Venue = ""
    symbol: str = ""
    side: Side = "buy"
    status: str = OrderStatus.INTENT
    quantity: Decimal = Decimal(0)
    filled_quantity: Decimal = Decimal(0)
    price: Optional[Decimal] = None
    strategy_id: StrategyId = ""
    entered_state_at: Nanos = 0
    reason: Optional[str] = None

    @property
    def remaining(self) -> Decimal:
        return self.quantity - self.filled_quantity

    @property
    def is_terminal(self) -> bool:
        return self.status in OrderStatus.TERMINAL


@dataclass(frozen=True)
class Fill(Envelope):
    client_order_id: str = ""
    venue_order_id: str = ""
    venue: Venue = ""
    symbol: str = ""
    side: Side = "buy"
    quantity: Decimal = Decimal(0)
    price: Decimal = Decimal(0)
    fee: Decimal = Decimal(0)
    fee_currency: str = "USDT"
    is_maker: bool = False
    strategy_id: StrategyId = ""
    exchange_ts: Nanos = 0
    local_recv_ts: Nanos = 0
    #: Mid at signal time, captured then and carried through. Implementation
    #: shortfall cannot be reconstructed afterwards once the book has moved.
    arrival_price: Optional[Decimal] = None

    @property
    def notional(self) -> Decimal:
        return self.quantity * self.price

    @property
    def signed_quantity(self) -> Decimal:
        return self.quantity if self.side == "buy" else -self.quantity


@dataclass(frozen=True)
class Position:
    venue: Venue
    symbol: str
    quantity: Decimal          # signed
    avg_entry_price: Decimal
    mark_price: Optional[Decimal] = None
    liquidation_price: Optional[Decimal] = None

    @property
    def notional(self) -> Decimal:
        px = self.mark_price if self.mark_price is not None else self.avg_entry_price
        return abs(self.quantity) * px


@dataclass(frozen=True)
class Balance:
    venue: Venue
    asset: str
    free: Decimal
    locked: Decimal = Decimal(0)

    @property
    def total(self) -> Decimal:
        return self.free + self.locked


# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class SymbolFilter:
    """Venue trading rules. Change without notice and break bots when they do."""

    symbol: str
    tick_size: Decimal
    step_size: Decimal
    min_notional: Decimal
    min_qty: Decimal = Decimal(0)
    max_qty: Optional[Decimal] = None
    max_num_orders: Optional[int] = None
    percent_price_up: Optional[Decimal] = None    # multiplier band vs last price
    percent_price_down: Optional[Decimal] = None


@dataclass(frozen=True)
class ExchangeInfo:
    venue: Venue
    filters: Mapping[str, SymbolFilter]
    fetched_at: Nanos = 0


@dataclass(frozen=True)
class FeeSchedule:
    """The ACTUAL tier, read from the venue. Never a constant in code."""

    venue: Venue
    maker_rate: Decimal          # positive = we pay; negative = rebate
    taker_rate: Decimal
    tier: str = "0"
    bnb_discount: Decimal = Decimal(0)


# --------------------------------------------------------------------------
# Reports
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class ReconciliationReport(Envelope):
    """Emitted every cycle, **including clean ones** (SPEC section 9.4).

    The clean reports matter: their absence then becomes independently
    alertable, which is how you notice that reconciliation stopped running
    rather than stopped finding problems.
    """

    venue: Venue = ""
    clean: bool = True
    discrepancies: Tuple[Mapping[str, Any], ...] = ()
    checked_positions: int = 0
    checked_orders: int = 0


@dataclass(frozen=True)
class AuditRecord:
    """One link in the hash chain (SPEC section 10.4)."""

    seq: int
    kind: str
    correlation_id: CorrelationId
    recorded_at: Nanos
    payload: Mapping[str, Any]
    prev_hash: str
    hash: str
