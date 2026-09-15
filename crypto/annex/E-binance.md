# Annex E — Binance integration reference

Companion to [SPEC.md](../SPEC.md) §17. Everything here lives **inside the venue adapter** and must
not leak above it (Annex A §5 rule 1), or the multi-venue hedge of SPEC §18.3 is fictional.

> Verify endpoints, limits and fee tiers against current Binance documentation before relying on
> them. The values below were correct as of September 2026 and this is precisely the class of
> information that changes without a migration notice.

---

## 1. Endpoints

| Purpose | URL |
|---|---|
| Spot production | `https://api.binance.com` (alternates `api1`–`api4`) |
| Spot testnet | `https://testnet.binance.vision` |
| USD-M futures production | `https://fapi.binance.com` |
| Futures testnet | `https://testnet.binancefuture.com` |
| Market data WebSocket | `wss://stream.binance.com:9443` |
| WebSocket API (orders) | `wss://ws-api.binance.com:443/ws-api/v3` |

Prefer the WebSocket API over REST for order placement: lower and more stable latency. Keep a REST
path working as a fallback, and **exercise the fallback in testing** — a fallback first used during
an outage is not a fallback.

---

## 2. Authentication

- **Ed25519**, which Binance recommends over HMAC for both performance and security.
- Private key lives in the signing service (SPEC §13.2) and never in the trading process.
- Signature covers the **exact query string in the exact order sent**. Reordering parameters breaks
  it, which makes a "harmless" refactor of a query builder a production outage.
- Every signed request carries `timestamp`; `recvWindow` is optional, defaults to 5000 ms, and is
  capped at **60000 ms**. Do not raise it toward the cap to hide clock drift — that converts a loud,
  diagnosable failure into a silent window in which stale requests execute.

### 2.1 Key permissions checklist

```
[ ] Spot & Margin Trading    ENABLED  (or Futures, as required)
[ ] Enable Withdrawals       OFF      <- never on, under any circumstances
[ ] IP allowlist             SET      <- Tokyo egress addresses only
[ ] Key type                 Ed25519
[ ] 2FA on the account       Authenticator app, not SMS
[ ] Separate key per strategy and per environment
[ ] Private key stored in the signing service, never in the repo or an env file
```

Unrestricted keys have their Spot & Margin trading permission expire after 90 days; IP-restricted
keys do not expire. The security control and the operational control point the same direction, so
there is no trade-off to weigh here.

---

## 3. Symbol filters

Fetch `GET /api/v3/exchangeInfo` at startup, cache, refresh daily and on any `-1013`.

| Filter | Constraint | Failure |
|---|---|---|
| `LOT_SIZE` | quantity multiple of `stepSize`, within min/max | `-1013` |
| `PRICE_FILTER` | price multiple of `tickSize`, within min/max | `-1013` |
| `MIN_NOTIONAL` | price × quantity above floor | `-1013` |
| `MAX_NUM_ORDERS` | open orders per symbol | `-1015` |
| `PERCENT_PRICE_BY_SIDE` | price within a band around the last price | `-1013` |
| `MARKET_LOT_SIZE` | separate lot rules for market orders | `-1013` |

**Round quantity DOWN, always.** Rounding up can push an order above a position limit that risk
already approved against the pre-rounding number, turning a rounding helper into a limit bypass.

```python
def round_qty(qty: Decimal, step: Decimal) -> Decimal:
    return (qty // step) * step        # floor division. Never round(), never ceil.

def round_price(px: Decimal, tick: Decimal, side: str) -> Decimal:
    # round CONSERVATIVELY: down for buys, up for sells, so the rounding
    # never makes the order more aggressive than intended
    return (px // tick) * tick if side == "buy" else -((-px) // tick) * tick
```

A post-rounding `MIN_NOTIONAL` check is required: rounding down can drop an order below the floor,
and the resulting rejection looks like a balance problem if you do not check for it.

---

## 4. Error codes and correct responses

| Code | Meaning | Correct response | Wrong response that causes losses |
|---|---|---|---|
| `-1021` | Timestamp outside `recvWindow` | Resync clock; halt above 100 ms drift | Raising `recvWindow` |
| `-1013` | Filter failure | Re-fetch `exchangeInfo`; fix rounding; log as a defect | Retrying unchanged |
| `-1015` | Too many orders | Back off; check `MAX_NUM_ORDERS` | Retry loop |
| `-1003` | Too many requests | Exponential backoff with jitter | Tight retry → 418 |
| `-1007` | **Timeout — status UNKNOWN** | **`QUERY` state; poll until resolved** | **Resend → double fill** |
| `-2010` | Insufficient balance | Trigger reconciliation; usually stale local state | Retry loop against a wrong cache |
| `-2011` | Cancel rejected | Query the order; it may already be filled | Assume cancelled |
| `-2013` | Order does not exist | Terminal for that client order ID | Resend |
| `-2015` | Invalid key / IP / permissions | **Halt.** Never retry | Retry (can trigger a ban) |
| HTTP 429 | Rate limited | Back off immediately | Continue |
| HTTP 418 | **IP banned** for ignoring 429 | Halt; wait out the ban; fix the limiter | Reconnect from a new IP |

`-1007` is the single most dangerous code in the table. It does not mean the order failed; it means
the outcome is unknown. Systems without a `QUERY` state (Annex A §4.3) resolve unknown by resending,
which is failure mode 1 in SPEC §8.5.

---

## 5. Rate limits

Two independent budgets, and being inside one says nothing about the other:

- **Request weight, per IP.** Read `X-MBX-USED-WEIGHT-1M` on every response. Back off proactively at
  70% of budget (SPEC §8.2).
- **Order count, per account.** Separate ceiling; a system well inside its weight budget can still be
  order-rate rejected.

```python
if used_weight > 0.70 * weight_limit:
    throttle()                  # queue, do not reject — SPEC §8.3 check 11
if used_weight > 0.90 * weight_limit:
    halt_non_critical()         # market data resync and polling yield to order traffic
```

**Cancels cost weight too.** A cancel-replace market-making loop can exhaust the weight budget
without placing a single new order, which is a surprise that arrives at the worst time.

Backoff is exponential **with jitter**. Synchronised retries across strategies reproduce the burst
that caused the limit, and each retry round makes the next one larger.

---

## 6. WebSocket lifecycle

### 6.1 Market data

- Connections are dropped at 24 hours **by design**. Reconnect cleanly; rotate proactively at ~23
  hours so the reconnect happens at a time you chose.
- Respond to ping frames within 10 minutes or be disconnected.
- **Depth stream:** maintain the local book with sequence validation. On any gap: discard the local
  book, fetch a REST snapshot, buffer deltas during the fetch, and replay those with sequence
  numbers after the snapshot's. Mark the affected window `gap_detected` (Annex A §2) so research
  excludes it (SPEC §4.4).

```python
# local book maintenance
if delta.first_update_id > last_applied_id + 1:
    mark_gap()
    resync_from_snapshot()
    # Do NOT return here. The delta that revealed the gap has not been
    # applied, and the snapshot was fetched after it, so re-offer it: if its
    # range spans the snapshot's last update id, apply it; if the snapshot
    # already covers it, the staleness check below drops it. Returning instead
    # leaves the book one update behind, the next delta reports a gap of its
    # own, and that resync leaves another hole - a loop that tightens as the
    # market gets busier. (Corrected during implementation; Annex G §4a.4.)
if delta.final_update_id <= last_applied_id:
    return                        # stale, already applied
apply(delta); last_applied_id = delta.final_update_id
```

**A cold start is not a gap.** The first delta on any connection has nothing to
apply itself to. It resyncs the same way, and the resulting snapshot is still
marked `resync_in_progress`, but it must not increment `sequence_gaps` - that
counter would otherwise tick on every healthy 23-hour rotation and stop being
alertable (Annex G §4a.5).

### 6.2 User data stream — the classic silent failure

- Requires a `listenKey` from `POST /api/v3/userDataStream`.
- **The key is valid for 60 minutes.** A `PUT` extends it by another 60.
- **Send the keepalive every 30 minutes**, so a single failed keepalive is survivable rather than
  fatal.
- On any reconnect, fetch a **fresh** `listenKey`. Reusing one across a reconnect is a common source
  of a stream that connects successfully and delivers nothing.

**This is failure mode 7 in SPEC §8.5.** When the user data stream dies quietly, fills stop
arriving, the system believes it is flat, and it opens more positions against a position it already
holds. The defence is an independent check that does not share the failure:

```
every 5s: REST poll of positions and open orders  (SPEC §9.4 reconciliation)
```

The reconciliation loop is not a redundant belt-and-braces measure — it is the only thing that
detects a user data stream that is connected and silent, because a silent stream looks exactly like
a quiet market.

---

## 7. Fees

- Tier depends on trailing 30-day volume and BNB holdings; holding BNB gives a 25% spot discount.
- **Read the actual tier from the API**, daily. Never hard-code it; never inherit it from a backtest
  assumption (Annex B §1).
- Recompute strategy viability at every tier you might plausibly reach — **in both directions**.
  Volume falls as well as rises, and a strategy that is viable only at a tier sustained by its own
  volume has a feedback loop that unwinds during a quiet month.
- At low tiers, taker fees consume most strategy edge, and the market-making arithmetic in Annex B
  §5.1 is negative before any skill is applied.

---

## 8. Testnet

Keys are issued at `testnet.binance.vision` via GitHub login.

**Testnet validates correctness, never profitability.** Its books are thin and unrealistic, and a
strategy that is profitable there has learned to trade a simulator. What testnet is genuinely good
for is the error paths, which are hard to provoke safely in production:

```
[ ] Every order type placed, queried, cancelled
[ ] Partial fill handled
[ ] -1013 provoked deliberately (bad quantity) and handled
[ ] -1021 provoked deliberately (skewed clock) and handled
[ ] 429 provoked deliberately and backoff verified
[ ] Disconnect mid-order; QUERY state entered; no duplicate order placed
[ ] listenKey allowed to expire; detection verified via REST reconciliation
[ ] Reconnect with open orders; reconciliation clean
[ ] Restart with open positions; startup gate blocks strategies until reconciled
```

That checklist is SPEC §17.5 step 1, and it is the cheapest place in the whole programme to find
these bugs.

---

## 9. Multi-venue notes

The adapter interface is validated by having more than one real implementation (SPEC §17.1).
Differences that commonly leak through a Binance-shaped abstraction:

| Concern | Binance | OKX | Bybit |
|---|---|---|---|
| Funding interval | 8h | 8h | 8h |
| Position mode | One-way or hedge | One-way or hedge | One-way or hedge |
| Order ID field | `newClientOrderId` | `clOrdId` | `orderLinkId` |
| Book sequencing | `U`/`u` update IDs | `seqId` | `u` |
| Rate limiting | Weight per IP | Request count per endpoint | Request count per endpoint |
| Unknown-state query | `GET /order` | `GET /trade/order` | `GET /order/realtime` |

Every one of these is adapter-internal. **The test that the abstraction is real is running the full
test suite against two venues' testnets** — if the suite only passes against Binance, you have a
Binance client with extra indirection, and no regulatory hedge.
