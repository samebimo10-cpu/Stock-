# Repository audit

**Scope:** `Stock-/crypto` (the `tradesys` trading system). The wider repository
holds three unrelated projects, summarised in §1.2 and not audited in depth.

**Method:** static reading, `coverage` over the full suite, and direct probes of
the code under test. Where a claim in this document could be verified by running
something, it was; those are marked **[probed]**. No code was changed.

**Commit audited:** `eb13b94`, branch `claude/bot-frame-enhancement-5o0hge`.

---

## 0. Summary

| | |
|---|---|
| Production Python | 8,343 statements across 71 modules |
| Tests | 787, plus 41 doctests — all passing |
| Coverage | **89%** (950 statements uncovered) |
| TODO / FIXME / HACK / XXX | **0** |
| `NotImplementedError` | **0** |
| Unimplemented protocol methods | 3 (§6.1) |
| Dead exported modules | 2 (§6.2) |

**Five findings that matter**, detailed in §7:

1. **F-1 (critical).** `--futures` builds futures hostnames with **spot API
   paths**. `tradesys capture --futures` and any futures trading would fail at
   the first REST call. **[probed]**
2. **F-2 (critical).** A failed depth resync **terminates the whole capture
   run**. A transient Binance 5xx during a three-month collection stops it.
   **[probed]**
3. **F-3 (major).** `tradesys live` can only ever run `FundingCarry` — the one
   strategy that fails its own cost gate. The three that pass it are reachable
   only from backtest scenarios.
4. **F-4 (major).** `BinanceAdapter.positions()` returns `[]` unconditionally.
   On futures, positions are therefore never reconciled. **[probed]**
5. **F-5 (moderate).** `VenueAdapter` declares three streaming methods that
   neither real adapter implements and the conformance suite does not check.

---

## 1. File tree

### 1.1 `crypto/` — the audited system

Line counts. `build/`, `dist/`, `*.egg-info/` and `__pycache__/` exist on disk
but are gitignored and untracked — they are stale local artifacts (`build/lib`
predates `trend.py`, `capture.py` and `scenarios.py`) and are excluded here.

```
crypto/
  SPEC.md                                  1712   the specification, 20 sections
  README.md                                 465
  QUICKSTART.md                             167
  AUDIT.md                                     -   this document
  pyproject.toml                              25   name=tradesys, dep: pyyaml
  risk/limits.yaml                            54   17 limits, each with bounds

  annex/
    A-interfaces.md   338   B-cost-model.md   320   C-validation.md   249
    D-risk.md         197   E-binance.md      246   F-gates.md        178
    G-changes.md      396

  docs/
    adr/0001..0007 + README                 315   decision records
    strategies/{funding_carry 314, stat_arb 184, cascade 137,
                funding_dispersion 124, trend 134}

  ops/
    runbooks/  (10 files)                   629
    dashboards/dashboards.yaml              104
    POSTMORTEM.md                            70

  src/tradesys/
    __init__.py                              14
    accounting.py                           479
    chaos.py                                257
    cli.py                                 1193
    config.py                               208
    costs.py                                270
    demo.py                                 293
    pipeline.py                             571
    scenarios.py                            444
    session.py                              492

    adapters/  base 165  binance 576  bybit 419  conformance 137  sim 636
    core/      errors 97  events 468  ids 83  types 113
    layers/
      l1_data/    archive 395  book 149  quality 200
      l2_features/ audit 151  derivs 158  engine 162  micro 80
                   registry 102  trend 227
      l3_strategy/ base 107  cascade 356  funding_carry 250
                   funding_dispersion 291  stat_arb 211  trend 322
      l4_portfolio/ allocate 177  allocator 168  correlation 118  netting 121
      l5_risk/     approval 167  killswitch 244  limits 147  service 299
                   sizing 113  state 172
      l6_execution/ executor 298  fsm 191  legs 292  reconcile 200
                    startup 85  tca 124
      l7_observability/ alerts 103  audit 209  metrics 275
    live/      binance_live 460  capture 249  runner 429  shadow 160
               streams 197  websocket 255  wiring 225
    research/  archive_replay 170  backtest 228  costmodel 25  harness 507
               registry 203  replay 218  validation 350  viability 375
    security/  redaction 80  signer 255

  tests/     32 files, 787 tests
```

### 1.2 The rest of the repository — not audited

| Path | Files | What it is |
|---|---|---|
| `stockselector/` | 26 | NGX/NYSE equity selector. Separate `pyproject.toml` at repo root. |
| `douvalue/` | 51 | Node.js farm app (`node --test` in CI). |
| `tests/` (root) | 6 | Tests for `stockselector`, not for `tradesys`. |
| `app.py`, `web/`, `data/`, `scripts/` | 12 | Streamlit front end and data cache for `stockselector`. |

These share a git repository with `crypto/` and nothing else. The root
`pyproject.toml` declares `stockselector`; `crypto/pyproject.toml` declares
`tradesys`. CI runs them as separate jobs.

---

## 2. What each module does

### Core (`core/`)
| Module | Purpose |
|---|---|
| `types.py` | Decimal money, integer-nanosecond time. `dec()` refuses floats; `floor_to` always rounds down. |
| `events.py` | Every cross-layer message as a frozen dataclass — `MarketEvent`, `Signal`, `OrderIntent`, `RiskDecision`, `OrderState`, `Fill`, and the venue primitives. |
| `ids.py` | ULID correlation IDs; deterministic `client_order_id(strategy, symbol, seq)` used as the venue idempotency key. |
| `errors.py` | Normalised venue error taxonomy — `UnknownState`, `RateLimited`, `IpBanned`, `FilterViolation`, … |

### Adapters (`adapters/`)
| Module | Purpose |
|---|---|
| `base.py` | `VenueAdapter` Protocol + `FilterRounder` (tick/lot/notional rounding lives inside the adapter). |
| `binance.py` | Endpoints, HMAC and Ed25519 signers, signed-query builder, error mapping, `exchangeInfo` parsing, `BookSequencer`, `ListenKeyManager`, injected `Transport`. |
| `bybit.py` | Bybit V5 equivalent. **Not reachable from any live path** (§7.5). |
| `sim.py` | Deterministic simulator: queue position, latency, fault injection, applies the shared cost model to fills. |
| `conformance.py` | Structural suite — required methods present, no venue vocabulary leaking into the interface. |

### Layers
| Module | Purpose |
|---|---|
| `l1_data/book.py` | Price-level book; microprice, imbalance, depth-within-bps, `walk()` returning `None` when depth cannot fill. |
| `l1_data/quality.py` | Data-quality gates and thresholds. |
| `l1_data/archive.py` | Write-once checksummed raw archive + deterministic versioned `Normaliser`. |
| `l2_features/registry.py` | Feature registration, content-hash versioning, declared lookback and lag. |
| `l2_features/{micro,derivs,trend}.py` | Pure feature functions. |
| `l2_features/engine.py` | Assembles `FeatureSnapshot` stamped with the last input timestamp, not `now()`. |
| `l2_features/audit.py` | Look-ahead audit — prefix recomputation for series features, lag perturbation for point features. |
| `l3_strategy/base.py` | Strategy Protocol, lifecycle states, `declared_stop_distance()`. |
| `l3_strategy/*.py` | Five strategies (§4). |
| `l4_portfolio/` | Netting, correlation on daily strategy P&L, risk-parity solver, and the allocator that applies the weights. |
| `l5_risk/service.py` | 13 ordered checks; may reduce or refuse, never enlarge. |
| `l5_risk/{limits,state,killswitch,approval}.py` | Bounds-validated limit register, portfolio state, kill switches with a recovery matrix, two-person rule. |
| `l6_execution/fsm.py` | Order state machine including the `QUERY` trap state. |
| `l6_execution/executor.py` | The single path from intent to venue. |
| `l6_execution/{reconcile,startup,legs}.py` | Reconciliation, startup gate, leg groups and unwinder. |
| `l7_observability/` | Hash-chained audit log, alert routing, metrics and SLOs. |

### Top level and live
| Module | Purpose |
|---|---|
| `pipeline.py` | L1 event → features → strategies → netting → allocation → risk → execution. One path for backtest, paper and live. |
| `session.py` | Startup gate, dead-man's switch, reconciliation loop, flatten, manual kill. |
| `costs.py` | Fees by tier, slippage from real depth, square-root impact, adverse selection, funding, borrow. |
| `accounting.py` | Books, per-strategy attribution, capacity. |
| `live/websocket.py` | Hand-rolled RFC 6455 client (no websocket dependency available). |
| `live/{streams,runner,shadow,wiring,capture}.py` | Stream sources with backoff, the live runner, shadow venue, credential wiring, archive capture. |
| `live/binance_live.py` | Binance payloads → domain events; gap detection and resync. |
| `research/` | Backtester, trial registry, validation arithmetic and harness, audit replay, archive replay, viability arithmetic. |
| `security/` | Signing service (refuses withdrawal endpoints) and log redaction. |

---

## 3. Test coverage

787 tests + 41 doctests, all passing. **89% statement coverage.**

### Ten weakest modules

| Module | Stmts | Miss | Cover |
|---|---:|---:|---:|
| `l5_risk/sizing.py` | 36 | 26 | **28%** |
| `l6_execution/tca.py` | 67 | 36 | **46%** |
| `cli.py` | 738 | 232 | 69% |
| `live/shadow.py` | 62 | 18 | 71% |
| `l2_features/audit.py` | 52 | 15 | 71% |
| `live/runner.py` | 236 | 68 | 71% |
| `live/websocket.py` | 151 | 42 | 72% |
| `live/streams.py` | 80 | 22 | 72% |
| `adapters/bybit.py` | 164 | 41 | 75% |
| `costs.py` | 89 | 17 | 81% |

The two weakest are weak because they are **not called by anything** (§6.2).
The `live/` cluster at ~71% is the genuine gap: those are the reconnect,
rotation and framing paths that only a real venue exercises.

### Tests per file (top 10 of 32)

`test_live 51`, `test_strategies_new 35`, `test_research 30`, `test_risk 28`,
`test_archive 27`, `test_data_features 26`, `test_harness 25`, `test_cli 25`,
`test_session 22`, `test_accounting 22`.

`l5_risk/sizing.py` is the only module with **no dedicated test file**.

### What CI runs

`.github/workflows/ci.yml`, job `tradesys`, Python 3.10 and 3.12:
`pytest -q`, doctests, `tradesys selfcheck`, `tradesys chaos`. It does **not**
run `tradesys strategies`, `viability`, `limits`, `doctor` or `capture --dry-run`.

---

## 4. Completeness assessment

Scores are judged against what the component would need to run unattended
against production Binance with real money — not against the specification's
own wish list.

### Data ingestion — **70%**

| Present | Missing |
|---|---|
| RFC 6455 client, framing, fragmentation, ping/pong | Depth **REST snapshots are never captured** — the archive holds stream messages only, so a replayed book cannot be rebuilt from its true starting state (acknowledged in `archive_replay.py`) |
| Combined-stream subscription; depth, aggTrade, markPrice, forceOrder decoders | No live decoder for Bybit — second venue is REST-only |
| `BookSequencer` gap detection, resync, cold-start distinction | **F-2:** a failed resync kills the capture process |
| Write-once checksummed archive, hourly partitions, resumable | **F-1:** futures REST paths are wrong |
| Reconnect with jittered backoff, 23h proactive rotation, book discard | Rate-limit backpressure on the REST side is tracked but not acted on |
| Versioned deterministic normaliser, gap annotation | No retention enforcement job (the `Retention` class exists; nothing calls it) |

### Backtest engine with cost model — **85%**

| Present | Missing |
|---|---|
| Same `Pipeline` object as live — proven by `test_same_code_path` | No walk-forward *runner*; the harness computes the statistic but the caller supplies the splits |
| Cost model applied inside the simulated venue **and** the backtester (ADR 0002) | Impact model is square-root with a hardcoded exponent `y=1`, never calibrated |
| Fees by tier, slippage walked against real depth, adverse selection, impact, funding, borrow | Queue model is simplified; no order-book replay at level 3 |
| Costless twin + the 30% review heuristic | Multi-venue latency differences not modelled |
| Trial registry the harness refuses to run without; holdout readable once | |
| Deflated Sharpe, PBO/CSCV, block bootstrap, power, `INCONCLUSIVE` verdict | |

### Risk service — **90%**

All 13 declared checks are implemented and ordered (`service.py:123–235`):
kill switch, strategy enabled, reconciliation clean, feed freshness, symbol
filters, single-order notional, per-trade risk, position limit, concentration,
gross exposure, order rate, liquidation distance, loss state.

| Present | Missing |
|---|---|
| Reduce-or-refuse, never enlarge (asserted in the service and again in the executor) | `liquidation_distance` is supplied by the caller; nothing computes it from venue margin rules |
| Absence of a decision is a reject | `sizing.py` — Kelly, vol-target, CVaR, correlation cap — is **not wired in** (§6.2) |
| 17 bounds-validated limits; out-of-range refuses to load | Limits are process-local; no shared risk service across processes |
| Drawdown ladder ordering enforced at load | |
| Kill switches with a recovery matrix; dead-man's switch | |
| Two-person rule enforced at config load | |

### Execution / order lifecycle — **85%**

| Present | Missing |
|---|---|
| Full FSM: INTENT, PENDING, ACKED, PARTIAL, FILLED, CANCELLED, REJECTED, QUERY | No `amend`/`replace` — modifying an order means cancel and re-place |
| QUERY is a trap state; `may_place_new_order` is false there | No iceberg, TWAP or any child-order slicing |
| Deterministic client order IDs as idempotency keys | `tca.py` exists but nothing calls it (§6.2), so implementation shortfall is never recorded |
| Unknown-state classification: unclassified venue errors are unknown, not failed | Reconciliation compares positions and open orders; it does not compare **balances** |
| Reconciliation with discrepancy classes and a halting subset | |
| Leg groups and an unwinder; maker-preferred with taker fallback | |
| `in_flight()` counts QUERY orders so the pipeline cannot stack duplicates | |

### Binance adapter — **60%**

| Present | Missing |
|---|---|
| HMAC **and** Ed25519 signing; signature is last in the query string | **F-1: spot paths only.** `/api/v3/*` is hardcoded; the futures endpoints select `fapi.binance.com` and would 404 **[probed]** |
| `recvWindow` capped at the API maximum, refuses to exceed it | **F-4:** `positions()` returns `[]` unconditionally — the docstring says "futures overrides this"; nothing does **[probed]** |
| Error mapping including `-1007` unknown, `-1013` filter, `-2010`, 418 IP ban | No `OCO`, no `listenKey` for futures (`/fapi/v1/listenKey` differs) |
| `exchangeInfo` → symbol filters; fee schedule read from the **actual** tier | No weight-aware throttling; weight is recorded, never enforced |
| `BookSequencer`, `ListenKeyManager` (60m validity, 30m keepalive, fresh key per reconnect) | `subscribe_*` protocol methods unimplemented (§6.1) |
| Injected `Transport`, so every rule is testable offline | Order types limited to limit / market / limit-maker / stop-limit |

---

## 5. TODOs and stubs

### TODO / FIXME / HACK / XXX — **none**

```
$ grep -rn "TODO\|FIXME\|XXX\|HACK" src/tradesys tests   →   0 matches
```

### `NotImplementedError` — **none**

The only one that existed (`ShadowVenue.query_order`) was removed at `0f28b37`
because `Executor.resolve_unknown` catches only `OrderNotFound` and
`VenueError`, so anything else escaped and terminated a shadow run.

### Protocol method stubs (`: ...`) — 24, all legitimate

| File | Count | Note |
|---|---:|---|
| `adapters/base.py` | 16 | `VenueAdapter` Protocol — **3 are unimplemented by real adapters**, see §6.1 |
| `live/streams.py` | 3 | `StreamSource` Protocol |
| `live/runner.py` | 3 | `UserStreamKeys` Protocol |
| `adapters/binance.py` | 2 | `Signer`, `Transport` Protocols |

### `pass` bodies — 12, all legitimate

Two are empty exception classes (`ArchiveError`, `WebSocketError`). Ten are
swallowed exceptions in cleanup paths — chmod, socket close, token release,
cancel-during-flatten, signal registration. Each has a comment. The one worth
watching is `session.py:432`: a cancel that fails during a flatten is swallowed,
so a flatten can proceed with a working order still live.

---

## 6. Structural findings

### 6.1 Interface declares what no real adapter implements

`adapters/base.py:85–87` declares `subscribe_book`, `subscribe_trades`,
`subscribe_funding`. Only `SimAdapter` implements them. `BinanceAdapter` and
`BybitAdapter` do not, and `conformance.REQUIRED_METHODS` omits all three — so
the conformance suite passes both adapters while they are missing a fifth of
the declared interface.

Live streaming is genuinely done by `live/`, not through the adapter, so the
methods are vestigial. They should be removed from the Protocol or implemented.
As written the interface overstates what a venue adapter provides.

### 6.2 Exported but never called

| Module | Coverage | Status |
|---|---:|---|
| `l5_risk/sizing.py` | 28% | `fractional_kelly`, `volatility_target`, `conditional_loss_size`, `correlation_adjusted_cap` — exported from `l5_risk/__init__`, **zero call sites in production or tests** |
| `l6_execution/tca.py` | 46% | `TcaRecord`, `implementation_shortfall_bps` — exported from `l6_execution/__init__`, **zero call sites** |

Position sizing is instead done inside each strategy (`trend.py` has its own
volatility targeting). That is defensible, but it means the specification's
sizing rules exist as unused library code while the strategies each roll their
own — and only `trend` does.

`research/costmodel.py` is a 25-line re-export shim for `costs.py`, kept because
Annex B names that path. Intentional.

### 6.3 `l4_portfolio` has two allocation modules

`allocate.py` is the solver (`risk_parity_weights`); `allocator.py` is the
scheduler that calls it. `inverse_vol_weights` is exported and never called.
Not dead, but the split is not obvious from the names.

---

## 7. Findings, ranked

### F-1 — `--futures` sends spot API paths to futures hosts. **Critical.**

`BinanceAdapter._call` builds `f"{endpoints.rest}{path}"` and every `path`
literal in the file is `/api/v3/*`. `BinanceEndpoints.futures_production()`
returns `https://fapi.binance.com`, whose API is `/fapi/v1/*`.

**[probed]**
```
spot      -> https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100
futures   -> https://fapi.binance.com/api/v3/depth?symbol=BTCUSDT&limit=100   ← 404
```

Affects `tradesys capture --futures`, `tradesys live --futures`, and the startup
gate's `reference_data`/`server_time` calls. Every documented workflow that
needs funding or liquidation data specifies `--futures`.

Not caught by tests because `BinanceAdapter` is only ever tested with an
injected fake transport that echoes whatever URL it is given.

### F-2 — A failed depth resync terminates the capture run. **Critical.**

`BinanceFeed.resync` awaits `adapter.book_snapshot`. On failure the exception
propagates through `decode` → `_on_market_message` → `_market_loop`, which
catches only `(WebSocketClosed, OSError, asyncio.IncompleteReadError)`.

**[probed]** `decode: RAISES VenueDown` for a failing REST snapshot;
`market loop catches: [Exception (connect only), (WebSocketClosed, OSError, IncompleteReadError)]`.

The result is a clean stop with a printed error — not a crash — but a process
intended to run unattended for three months stops on the first transient
Binance 5xx or rate-limit during a resync. Combined with F-1 it stops on the
**first depth message** in futures mode.

### F-3 — Only the failing strategy is reachable live. **Major.**

`live/wiring.py:170` instantiates `FundingCarry` and nothing else. There is no
flag to select a strategy.

| Strategy | Cost share | Backtest | Live |
|---|---:|:---:|:---:|
| `trend` | 5.0% | ✅ | ❌ |
| `cascade` | 18.2% | ✅ | ❌ |
| `funding_dispersion` | 31.3% | ✅ | ❌ |
| `funding_carry` | **238%** | ✅ | ✅ |
| `stat_arb` | — | ❌ | ❌ |

`StatArbPairs` has tests but no runnable entry point at all.

Additionally, `build_binance_live` wires a single venue, so `funding_dispersion`
is structurally impossible to run live — it needs two.

### F-4 — Futures positions are never reconciled. **Major.**

`BinanceAdapter.positions()` returns `[]` with the comment *"Spot has balances,
not positions. Futures overrides this."* No subclass exists. **[probed]** it
returns `[]` on a futures adapter.

`TradingSession.reconcile` compares local positions against `adapter.positions()`.
On futures that comparison is against an empty list, so a real venue position
the system does not know about reads as clean. This is failure mode 6 of
SPEC §8.5 — the one the startup gate exists to prevent — reachable through the
adapter it was meant to be protected by.

### F-5 — Conformance does not check the whole interface. **Moderate.**

See §6.1. The suite reports PASS for adapters missing three declared methods.

### F-6 — A failed cancel during a flatten is silent. **Moderate.**

`session.py:430–432` swallows every exception from `executor.cancel` during
`_flatten`. The flatten then places reducing orders while a stale working order
may still be live — which is the specific situation the "cancel first, then
reduce" ordering was written to avoid.

### F-7 — Rate-limit weight is recorded but never enforced. **Moderate.**

`BinanceAdapter` parses `X-MBX-USED-WEIGHT-1M` into `rate_limit_state()`, and
the risk service's check 11 throttles on it. Nothing in the adapter or the live
runner backs off before issuing a request. An IP ban while holding a position
means no data *and* no ability to flatten.

---

## 8. Hardcoded values

### 8.1 Endpoints — `adapters/binance.py:83–95`, `adapters/bybit.py:81–86`

```
https://api.binance.com              wss://stream.binance.com:9443
https://testnet.binance.vision       wss://testnet.binance.vision
https://fapi.binance.com             wss://fstream.binance.com
https://testnet.binancefuture.com    wss://stream.binancefuture.com
https://api.bybit.com                wss://stream.bybit.com/v5
https://api-testnet.bybit.com        wss://stream-testnet.bybit.com/v5
```
Selectable via constructors; not configurable at runtime.

### 8.2 Financial constants

| Value | Where | Note |
|---|---|---|
| `COST_GATE = 0.40` | `research/viability.py:49` | SPEC §1.2 gate |
| `DSR_GATE = 0.95`, `PBO_GATE = 0.50`, `WALK_FORWARD_GATE = 0.70`, `COST_STRESS_MULTIPLE = 1.5`, `MIN_TRADES_FOR_A_VERDICT = 30` | `research/harness.py:46–52` | Validation gates |
| `KELLY_FRACTION = 0.25` | `l5_risk/sizing.py:23` | **Unused** (§6.2) |
| `MIN_WEIGHT = 0.05`, `MAX_WEIGHT = 0.40` | `l4_portfolio/allocate.py:33` | Per-strategy weight bounds |
| `MIN_OBSERVATIONS = 60`, `PESSIMISTIC_PRIOR = 0.5`, `CUT_ALLOCATION_ABOVE = 0.6`, `DISABLE_ABOVE = 0.8` | `l4_portfolio/correlation.py` | Correlation policy |
| `PERIODS_PER_YEAR = 365` | `research/validation.py:32` | Daily annualisation |
| `INTERVALS_PER_YEAR = 3*365` | `l3_strategy/trend.py:96` | 8h funding annualisation |
| `HORIZON_BARS = 32` | `l3_strategy/trend.py` | Stop horizon scaling |
| **`maker/taker fallback "0.001"`** | `adapters/binance.py:468–469` | **Silent fallback if `commissionRates` is absent — a wrong fee tier is assumed rather than refused** |
| `maker 0.0002 / taker 0.0005` | `adapters/sim.py:195` | Simulator default fee |
| Fee tier tables (VIP 0–9, spot and futures) | `research/viability.py:158–174` | **Published schedules copied into code; will go stale** |
| Funding regimes 0.0001–0.0020 | `research/viability.py:176` | Judgement values, labelled as such |

### 8.3 Timing constants

| Value | Where |
|---|---|
| `rotate_after_ns = 23h`, `tick_interval_s = 5.0`, `token_keepalive_s = 1800` | `live/runner.py` `LiveConfig` |
| `open_timeout = 15.0`, `read_timeout = 60.0` | `live/websocket.py:73–74` |
| `VENUE_PING_DEADLINE_S = 600` | `live/websocket.py` |
| `VALIDITY_S = 3600`, `KEEPALIVE_S = 1800` | `adapters/binance.py` `ListenKeyManager` |
| `MAX_RECV_WINDOW_MS = 60_000`, `DEFAULT_RECV_WINDOW_MS = 5_000` | `adapters/binance.py:69–70` |
| `UrllibTransport timeout = 10.0` | `adapters/binance.py:348` |
| `QUERY_ALERT_AFTER_S = 30.0` | `l6_execution/fsm.py:50` |
| `DEFAULT_DELAY_SECONDS = 24h` | `l5_risk/approval.py:37` |
| `DEFAULT_REBALANCE_NS = 24h` | `l4_portfolio/allocator.py:31` |
| `reconcile 5s`, `heartbeat 2s`, `clock drift 50/100ms` | `session.py` `SessionConfig` |
| `batch 2000`, `flush 60s`, `min_free 2GB`, `min_part_records 100` | `live/capture.py` `CaptureConfig` |
| `depth_ms = 100`, `snapshot_depth = 100` | `live/binance_live.py` |

### 8.4 Strategy parameters (defaults, all overridable)

```
trend               entry 1.0   exit 0.3    vol_target 0.20  max_weight 0.18  stop_sigma 2.5
cascade             pressure .35 decay 0.5  recover 0.5      stop_depth 0.5   hold 6h   notional 1000
funding_dispersion  entry .0007 exit .0001  cost .0017       hold 12          notional 1000
funding_carry       entry_z 1.5 exit_z 0.5  cost .003        hold 21          notional 1000
stat_arb            entry_z 2.0 exit_z 0.5  half_life 20     stop_z 4.0       notional 1000
```

`funding_carry.round_trip_cost = 0.003` and
`funding_dispersion.round_trip_cost = 0.0017` are **cost assumptions baked into
the strategy**, not read from the venue's actual fee schedule. If the real tier
differs, the break-even check is wrong and the strategy will not know.

### 8.5 Test and demo fixtures

`START = 1_700_000_000_000_000_000`, `SYMBOL = "BTCUSDT"`, venue names
`sim-perp`/`sim-spot`/`sim-perp-b`, price 60000, tick 0.01, lot 0.00001,
min-notional 10 — in `demo.py:38–47` and `scenarios.py:42–54`. Confined to
fixtures; not reachable from production paths.

---

## 9. Every place an order can be placed

### 9.1 The single venue call

**One line in the production system sends an order to a venue:**

```
src/tradesys/layers/l6_execution/executor.py:190
    ack = await self.adapter_for(sized.venue).place(sized)
```

Nothing else in `src/tradesys/` calls `.place()` except the chaos suite
(§9.4). There is no bypass.

### 9.2 What guards it

`Executor.submit` refuses before reaching line 190 when:

| Guard | Line |
|---|---|
| Execution is halted | 152 |
| `decision is None` — "absence of an approval is not an approval" | 155 |
| `not decision.approved` | 160 |
| The decision's `intent_id` does not match the intent | 162 |
| Risk returned a **larger** quantity than requested | 166 |
| Risk reduced the quantity to zero | 170 |
| An existing machine for this client order ID is not in a state that permits a new order — **including QUERY** | 174 |

### 9.3 Production callers of `Executor.submit`

| Call site | Path |
|---|---|
| `pipeline.py:302` | Main path — target position → intent → risk → submit |
| `pipeline.py:399` | Taker fallback for an unfilled maker order |
| `pipeline.py:458` | Leg-group unwind |
| `session.py:456` | `_flatten` — kill switch, dead-man, or manual kill |

All four construct the intent through `Executor.build_intent` (filter rounding)
and pass a `RiskDecision` from `RiskService.evaluate`. `session.py:456` builds
its decision inline at 450–455 — it goes through the risk service, but with a
synthetic `MarketEvent`, so feed-freshness and mark-price checks evaluate
against a fabricated event rather than a real one.

### 9.4 Non-production callers

| Call site | Adapter | Context |
|---|---|---|
| `chaos.py:95,96,106,144` | `SimAdapter` | Failure-injection scenarios, run by `tradesys chaos` and CI |
| `chaos.py:115,117,153,163` | `SimAdapter` | Direct `.place()` for duplicate/rate-limit/ban scenarios |
| `cli.py:159,180,181` | `SimAdapter` | `selfcheck` gates: no-decision-is-reject, idempotency |
| 14 sites in `tests/` | `SimAdapter`, `ShadowVenue`, fake transports | Test suite |

None can reach a real venue: every one constructs its own simulated adapter.

### 9.5 What receives the order, by mode

`live/wiring.py:_trading_adapter` is the **only** place mode changes behaviour:

| Mode | Receives orders |
|---|---|
| `read_only` | `ShadowVenue` (and strategies are disabled, so no intent is generated) |
| `shadow` | `ShadowVenue` — recorded locally, never sent |
| `paper` | `SimAdapter` priced off the real book |
| `live` | `BinanceAdapter` — **the venue** |

`build_binance_live` refuses `mode=live, testnet=False` without
`confirm_live=True`, and asserts `trading_adapter.name == venue` so the books
cannot split.

---

## 10. Recommended order of work

1. **F-1** — futures REST paths. Blocks every documented data-collection
   workflow. Needs a futures adapter subclass or path templating, plus a test
   that asserts the constructed URL rather than trusting the transport fake.
2. **F-2** — catch venue errors in `_market_loop` and treat a failed resync as
   a reconnect rather than a fatal error. A three-month capture cannot stop on
   a transient 5xx.
3. **F-4** — implement `positions()` for futures, or make the adapter refuse to
   be used in futures mode until it can.
4. **F-3** — a `--strategy` flag, and multi-venue live wiring for dispersion.
5. **F-7** — act on the recorded rate-limit weight before issuing requests.
6. **F-5 / §6.1** — remove the three unimplemented Protocol methods or add them
   to `REQUIRED_METHODS` and implement them.
7. **§6.2** — either wire `sizing.py` and `tca.py` in, or delete them. Exported
   dead code in a risk layer is worse than absent code, because it reads as a
   control that exists.
8. Coverage on `live/` (71–72%) — the reconnect, rotation and framing paths.
