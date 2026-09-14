# Annex A — Interfaces and event schemas

Companion to [SPEC.md](../SPEC.md) §3.3. Every inter-layer boundary is a typed message with a
schema version, a latency budget and a defined timeout behaviour.

Types are given in Python dataclass notation for readability. The normative artefact is the JSON
Schema in `/core/schemas/`, generated from these definitions and validated in CI.

---

## 1. Common

```python
CorrelationId = str   # ULID, minted in L1, carried end to end (SPEC §3.2 rule 5)
Timestamp     = int   # nanoseconds since Unix epoch, UTC. Never a float: float64 loses
                      # nanosecond resolution past 2004, which is a silent precision bug.
Venue         = str   # "binance" | "okx" | "bybit" | "sim"
StrategyId    = str
Decimal       = decimal.Decimal   # never float for prices, quantities or money
```

**Rule:** money, prices and quantities are `Decimal` everywhere, including in the backtester. A
float rounding error that moves a quantity below `stepSize` produces a `-1013` rejection in
production and a successful fill in a float-based backtest, which is a divergence that costs a day
to find.

Every message carries:

```python
@dataclass(frozen=True)
class Envelope:
    schema_version: int
    correlation_id: CorrelationId
    emitted_at: Timestamp      # local monotonic-derived wall clock at emission
    source: str                # layer + instance id
```

Messages are immutable. A layer that mutates a received message breaks replay (SPEC §10.4).

---

## 2. L1 → L2 `MarketEvent`

Budget p99: 500 µs [B] / 10 ms [A]. On timeout: mark feed stale, halt dependent features.

```python
@dataclass(frozen=True)
class MarketEvent(Envelope):
    venue: Venue
    symbol: str
    kind: Literal["book_delta","book_snapshot","trade","funding","oi","mark","liquidation","index"]
    exchange_ts: Timestamp     # as reported by the venue
    local_recv_ts: Timestamp   # when our NIC saw it
    sequence: int | None       # venue sequence number where the stream provides one
    payload: BookDelta | Trade | Funding | OpenInterest | Mark | Liquidation
    quality: QualityFlags
```

```python
@dataclass(frozen=True)
class QualityFlags:
    gap_detected: bool         # sequence discontinuity immediately before this event
    resync_in_progress: bool
    stale: bool                # no update within the symbol's staleness threshold
    crossed_book: bool
```

`exchange_ts` and `local_recv_ts` are both required. Their difference is simultaneously a latency
measurement and a data-quality signal (SPEC §4.2), and a system that records only one cannot compute
it afterwards.

**`quality` travels with the event rather than in a side channel.** A consumer must be able to
decide, from the event alone, whether to trust it. Quality information in a separate stream arrives
at a different time and gets ignored.

---

## 3. L2 → L3 `FeatureSnapshot`

Budget p99: 1 ms [B] / 20 ms [A]. On timeout: strategy emits no signal.

```python
@dataclass(frozen=True)
class FeatureSnapshot(Envelope):
    venue: Venue
    symbol: str
    as_of: Timestamp                       # timestamp of the LAST INPUT EVENT, not of computation
    features: Mapping[str, Decimal | None] # None means genuinely missing; never imputed
    feature_versions: Mapping[str, str]    # feature name -> content hash of its code
    inputs_complete: bool                  # False if any declared input was missing or stale
```

Three properties that make SPEC §5.4's look-ahead audit possible:

- `as_of` is the last input event's timestamp. A consumer asserts `decision_ts >= as_of`.
- `None` is a legal value and means missing. Imputation is forbidden in the live path (SPEC §5.3).
- `feature_versions` lets a backtest from two years ago be reproduced exactly, because it records
  which computation produced each number rather than which one is current.

---

## 4. L3 → L4 `Signal`, and the order lifecycle

Budget p99: 5 ms [B] / 100 ms [A]. On timeout: signal expires unfilled, logged.

```python
@dataclass(frozen=True)
class Signal(Envelope):
    strategy_id: StrategyId
    venue: Venue
    symbol: str
    target_position: Decimal          # DESIRED EXPOSURE in base units, signed. Not an order.
    urgency: Literal["passive","normal","aggressive"]
    limit_price: Decimal | None       # worst acceptable price; None means no constraint
    valid_until: Timestamp            # after this, the signal is void. Required, never infinite.
    confidence: Decimal               # [0,1], feeds sizing (Annex B §7)
    rationale: Mapping[str, Decimal]  # the feature values that produced it — for §10.4 audit
```

A `Signal` expresses desired exposure, not an order (SPEC §6.2). `valid_until` is mandatory: a
signal without an expiry is a signal that will eventually be acted on at the wrong time, after a
queue backs up.

### 4.1 `TargetPosition` (L4 → L5)

```python
@dataclass(frozen=True)
class TargetPosition(Envelope):
    venue: Venue
    symbol: str
    target: Decimal                          # post-netting, post-allocation
    contributions: Mapping[StrategyId, Decimal]  # who wanted what, for attribution (SPEC §12.2)
    allocation_version: int
```

### 4.2 `OrderIntent` and `RiskDecision` (L5 → L6)

Budget p99: 2 ms [B] / 40 ms [A]. **On timeout: reject.**

```python
@dataclass(frozen=True)
class OrderIntent(Envelope):
    client_order_id: str      # DETERMINISTIC: hash(strategy_id, symbol, intent_sequence)
    venue: Venue
    symbol: str
    side: Literal["buy","sell"]
    quantity: Decimal         # already rounded DOWN to stepSize by L6
    order_type: Literal["limit","market","limit_maker","stop_limit"]
    price: Decimal | None     # already rounded to tickSize
    time_in_force: Literal["GTC","IOC","FOK"]
    post_only: bool
    reduce_only: bool
    strategy_id: StrategyId

@dataclass(frozen=True)
class RiskDecision(Envelope):
    intent_id: str
    approved: bool
    rejected_by: str | None       # which check in SPEC §8.3, by number and name
    adjusted_quantity: Decimal | None   # risk may reduce; it may NEVER increase
    limits_snapshot: Mapping[str, Decimal]  # utilisation at decision time, for the audit trail
```

Two invariants, both asserted in code and in property tests (SPEC §14.1):

- `adjusted_quantity <= intent.quantity`. Risk reduces or refuses. It never enlarges.
- **No `RiskDecision` means reject.** The absence of an approval is never an approval, and a client
  that treats a timeout as permission has defeated the layer.

`client_order_id` is deterministic so that a retry after a crash regenerates the same identifier and
the venue rejects the duplicate on your behalf (SPEC §8.5 failure mode 1).

### 4.3 Order state machine — transition table

Referenced from SPEC §9.2. Every state has a timeout and an expiry action.

| From | Event | To | Timeout | On timeout |
|---|---|---|---|---|
| `INTENT` | risk approved | `PENDING` | 2 s | Expire, log |
| `INTENT` | risk rejected / no answer | `REJECTED` | — | Terminal |
| `PENDING` | venue ack | `ACKED` | 5 s | → `QUERY` |
| `PENDING` | venue reject | `REJECTED` | — | Terminal |
| `PENDING` | network error / `-1007` | `QUERY` | — | **Never resend** |
| `ACKED` | partial fill | `PARTIAL` | — | — |
| `ACKED` | full fill | `FILLED` | — | Terminal |
| `ACKED` | cancel ack | `CANCELLED` | — | Terminal |
| `ACKED` | no event | `ACKED` | signal `valid_until` | Cancel or chase per `urgency` |
| `PARTIAL` | remaining fills | `FILLED` | — | Terminal |
| `PARTIAL` | timeout | decide | per strategy | Chase, hold, or cancel remainder |
| `QUERY` | venue reports order | matching state | — | — |
| `QUERY` | venue reports no such order | `REJECTED` | — | Terminal, with an audit note |
| `QUERY` | no answer | `QUERY` | ∞ | **Poll forever. Alert after 30 s. Never place a new order for this intent.** |

`QUERY` is deliberately a trap state with no escape except resolution. An order whose state is
unknown must never cause another order (SPEC §9.2).

### 4.4 `Fill`

```python
@dataclass(frozen=True)
class Fill(Envelope):
    client_order_id: str
    venue_order_id: str
    venue: Venue
    symbol: str
    side: Literal["buy","sell"]
    quantity: Decimal
    price: Decimal
    fee: Decimal
    fee_currency: str
    is_maker: bool
    strategy_id: StrategyId        # attribution (SPEC §12.2)
    exchange_ts: Timestamp
    local_recv_ts: Timestamp
    arrival_price: Decimal         # mid at signal time — the TCA baseline (SPEC §9.6)
```

`arrival_price` is captured at signal time and carried through, because implementation shortfall
cannot be reconstructed after the fact once the book has moved.

---

## 5. Venue adapter interface

The only code that knows a venue exists (SPEC §3.5). Implemented by `binance`, `okx`, `bybit` and
`sim`. The simulator implementing the same interface is what makes SPEC §3.2 rule 2 true rather
than aspirational.

```python
class VenueAdapter(Protocol):
    # --- reference ---
    async def exchange_info(self) -> ExchangeInfo: ...          # filters, cached, refreshed daily
    async def fee_schedule(self) -> FeeSchedule: ...            # ACTUAL tier, not the public table

    # --- market data ---
    async def subscribe_book(self, symbols: list[str]) -> AsyncIterator[MarketEvent]: ...
    async def subscribe_trades(self, symbols: list[str]) -> AsyncIterator[MarketEvent]: ...
    async def subscribe_funding(self, symbols: list[str]) -> AsyncIterator[MarketEvent]: ...
    async def book_snapshot(self, symbol: str, depth: int) -> BookSnapshot: ...   # for gap resync

    # --- trading ---
    async def place(self, intent: OrderIntent) -> OrderAck: ...
    async def cancel(self, client_order_id: str) -> CancelAck: ...
    async def query_order(self, client_order_id: str) -> OrderState: ...   # required by QUERY

    # --- truth ---
    async def positions(self) -> list[Position]: ...
    async def balances(self) -> list[Balance]: ...
    async def open_orders(self) -> list[OrderState]: ...
    async def subscribe_user_data(self) -> AsyncIterator[Fill | OrderState | BalanceUpdate]: ...

    # --- health ---
    async def server_time(self) -> Timestamp: ...      # clock drift check (SPEC §9.5 step 6)
    def rate_limit_state(self) -> RateLimitState: ...  # used weight, remaining budget
```

**Design rules for the interface:**

1. No Binance concept appears in a signature. No `listenKey`, no `recvWindow`, no `-1013`. Those
   live inside the adapter. If they leak upward, multi-venue is not real and the regulatory hedge in
   SPEC §18.3 does not exist.
2. Venue error codes are normalised into a common taxonomy before crossing the boundary:
   `RATE_LIMITED`, `INSUFFICIENT_BALANCE`, `FILTER_VIOLATION`, `UNKNOWN_STATE`, `AUTH_FAILED`,
   `VENUE_DOWN`. The original code is kept in the audit record.
3. `query_order` is mandatory. An adapter that cannot resolve an unknown order state cannot
   implement `QUERY`, and is therefore unsafe regardless of everything else it does well.
4. Rounding to `stepSize`/`tickSize` happens **inside** the adapter, downward for quantity, and the
   rounded values are what reach `OrderIntent`. Risk approved a quantity; rounding up would breach
   the approved number.

---

## 6. LLM output schema

Referenced from SPEC §2.3. Every LLM output is validated against a versioned schema before it
touches anything. Validation failure drops the document and alerts; it never coerces.

```python
@dataclass(frozen=True)
class RegimeClassification(Envelope):
    schema_version: int
    model: str                 # exact model identifier
    regime: Literal["bull_trending","bear_trending","chop","high_vol","crisis"]
    confidence: Decimal        # [0, 1]
    horizon_hours: int         # [1, 24]
    strategy_adjustments: Mapping[StrategyId, Decimal]   # multiplier, [0.0, 1.0]
    reasoning: str             # for ops narration only; never parsed, never acted on
    inputs_hash: str           # hash of the exact input document, for replay
```

Bounds enforcement (SPEC §2.3 rule 2 and 3):

| Field | Hard range | Out of range |
|---|---|---|
| `confidence` | [0, 1] | Clamp, warn |
| `horizon_hours` | [1, 24] | Clamp, warn |
| `strategy_adjustments` values | **[0.0, 1.0]** | Clamp, warn; beyond 2× reject document |

The ceiling of 1.0 on `strategy_adjustments` is the mechanism behind SPEC §2.3 rule 3: the LLM can
multiply an allocation by 0.5 but cannot multiply it by 1.5. **It can only ever reduce risk.**
Raising an allocation requires the quantitative optimiser in SPEC §7.

Rate limit: one document per strategy per `horizon_hours` window. Excess documents are dropped and
alerted — a classifier that starts emitting continuously is malfunctioning, and the rate limiter is
the thing that notices before the allocator does.

**Every call is logged** with prompt, model, model version, response, latency, schema-validation
result and `inputs_hash`, so the decision is replayable under SPEC §10.4.

---

## 7. `AuditEvent`

Every layer emits. Budget: async, ≤ 1 s. **If the buffer fills, trading halts** (SPEC §3.3).

```python
@dataclass(frozen=True)
class AuditEvent(Envelope):
    kind: str                       # "signal" | "risk_decision" | "order" | "fill" | "reconcile" | ...
    payload: Mapping[str, Any]      # the full message being recorded
    prev_hash: str                  # hash chain -> tamper evidence (SPEC §10.4)
    hash: str
```

The chain is verified on read. A break in the chain is a P1 (SPEC §10.2): either the log was
tampered with or the writer has a defect, and both mean the record of what the system did cannot be
trusted.

---

## 8. Schema evolution

- Schema versions are integers and only increase.
- Adding an optional field is a minor change; consumers ignore unknown fields.
- Removing or retyping a field requires a new major version, and both versions are supported for
  one full data-retention window so historical replay keeps working.
- **The replay harness must be able to read every schema version ever written**, because the whole
  point of the archive in SPEC §4.3 is that it remains readable after the code has moved on.
