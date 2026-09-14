# Institutional Crypto Trading System — Engineering Specification

**Version:** 2.0 (enhancement of the v1.0 build specification dated 14 September 2026)
**Prepared for:** Gi (Samuel John Doupregha)
**Audience:** whoever is building this — one person or ten
**Status:** build specification. Sections marked **HARD REQUIREMENT** are gates, not preferences.

> Nothing in this document is investment advice. Capital deployed in a system built to this
> specification can be lost entirely, including through defects in the system itself.

---

## 0. How to read this document

v1.0 got the framing right and that framing is preserved here: three different goals requiring
three different systems, edge coming from structure rather than prediction, risk as a separate
service, validation as the place where well-funded teams actually fail.

This version exists because v1.0 was a *position paper that reads like a spec*. It tells you that
risk must be able to veto a strategy; it does not tell you what a veto is, what it is carried over,
how long the strategy may wait for one, or what happens when the answer does not arrive. A team
cannot build from that without inventing the contracts themselves, and if they invent them, the
layers stop being independently testable — which was the point of having layers.

What v2.0 adds is in [Annex G](annex/G-changes.md). In summary:

1. **The architecture is now complete.** v1.0 draws seven layers and then specifies three of them.
   L2 (features), L3 (strategy), L4 (portfolio) and L7 (observability) had no sections at all.
   They do now. v1.0 also labelled research "Layer 2", colliding with the features layer — research
   is not a layer, it is an environment, and it is treated as one here.
2. **Contracts, not adjectives.** Every inter-layer boundary has a typed message and a latency
   budget ([Annex A](annex/A-interfaces.md)).
3. **Arithmetic where v1.0 gave a name.** Deflated Sharpe, fractional Kelly, volatility targeting,
   funding carry, market impact, break-even maker economics, and the statistical power of each
   rollout phase are written out ([Annex B](annex/B-cost-model.md), [Annex C](annex/C-validation.md)).
4. **Four numbers in v1.0 were wrong or inconsistent.** They are corrected in place and the
   reasoning is recorded in Annex G. The most consequential: v1.0 sets a maximum-drawdown *target*
   of 20% and a max-drawdown *kill limit* of 15%, which means the system halts permanently before
   it reaches its own stated tolerance.
5. **A second track.** v1.0 assumes 8–10 headcount and a 12-month runway. If that is not the
   situation, most of v1.0 is unbuildable and the honest response is a smaller system, not a
   compressed version of this one. §16 specifies it.
6. **The layers v1.0 forgot are the ones that tell you whether it works.** Accounting and per-strategy
   PnL attribution (§12) are not back-office concerns. Without them you cannot answer "which strategy
   is making money", which means you cannot allocate, which means §7 is decorative.

### 0.1 Conventions

| Notation | Meaning |
|---|---|
| **HARD REQUIREMENT** | A gate. The system does not advance to the next phase until this passes, and it is verified by an automated check, not an opinion. |
| **SHOULD** | Strong default. Deviating requires a recorded decision (§14.4). |
| **MAY** | Genuinely optional. |
| **[A]** / **[B]** | Applies to Track A (small) / Track B (institutional) only. Unmarked text applies to both. |

Every HARD REQUIREMENT has a corresponding check in [Annex F](annex/F-gates.md) that exits non-zero
when unmet. A requirement nobody can fail automatically is a requirement that gets waived at 2am
on the day it matters.

### 0.2 Two tracks

v1.0 describes one system. In practice the first decision is which of two you are building, because
they diverge at the architecture, not just the budget.

| | **Track A — Small** | **Track B — Institutional** |
|---|---|---|
| People | 1–3 | 8–12 (§16.1) |
| Capital | $10k–250k | $2m+ |
| Strategies reachable | Funding/basis carry, cross-venue arb on mid-caps, stat-arb pairs | All of the above plus market making, liquidation positioning |
| Hot path | Python is acceptable | Rust or C++ |
| Colocation | Not initially (§13.1) | Day one |
| Realistic net Sharpe | 1.0–1.8 | 1.5–2.5 |
| Time to first live capital | 4–6 months | 7–9 months |
| Annual run cost | $6k–20k | $1.8m–3.2m (§16.3) |

**Track A is not Track B with the budget removed.** It is a different design: fewer strategies,
longer holding periods, no latency-sensitive edges, and an explicit decision to forgo the entire
class of strategies where the competition is Wintermute. Track A that tries to market-make loses.
Track A that collects funding carry with disciplined risk does not.

Choose the track before §3, record the choice, and re-evaluate only at a phase gate. Mid-build
track switching is how projects end up with the cost structure of B and the capability of A.

---

## 1. Targets

### 1.1 The framing, preserved

"Outcompete all present bots" is three goals requiring three systems:

| Goal | What it means | Reality |
|---|---|---|
| Beat retail bots (3Commas, Pionex, Cryptohopper grids) | Be genuinely profitable net of costs | Achievable in 6–12 months with a strong team |
| Beat professional prop desks (Wintermute, GSR, Amber, Jump) | Win on latency, inventory and capital | Colocation, VIP tiers, 8-figure capital, 3+ years |
| Beat "the market" by prediction | Forecast direction better than everyone | Not a solvable engineering problem |

This spec builds Goal 1 with an architecture that can grow into Goal 2. It does not attempt Goal 3.

**On win rate.** v1.0 says to replace the 70% win-rate target, and is right, but stops at the
criticism. The replacement is §1.2 in full: win rate moves to the monitored-but-not-gated list,
and no decision anywhere in the system reads it. A strategy with a 35% win rate and positive
expectancy ships; a strategy with an 80% win rate and negative expectancy does not, and neither
outcome is a discussion.

### 1.2 Primary metrics — HARD REQUIREMENT for capital deployment

Each is defined by its measurement procedure, because a metric without one is a negotiation.

| Metric | Minimum | Good | Measured how |
|---|---|---|---|
| Net Sharpe | 1.5 | 2.5+ | Daily returns, net of all costs in §11.1, annualised ×√365 (crypto trades every day — using √252 overstates Sharpe by 20%). Rolling 90-day window. |
| Max drawdown | < 20% | < 12% | Peak-to-trough on mark-to-market equity including unrealised and accrued funding, sampled hourly. Not on daily closes — daily sampling systematically understates drawdown. |
| Calmar | > 1.0 | > 2.0 | Trailing 365-day return ÷ max drawdown over the same window. |
| Expectancy per trade | > 0 net of costs | — | (P(win) × avg win) − (P(loss) × avg loss) − costs, per strategy, with a bootstrap 95% CI. The CI lower bound must also exceed zero before scaling (§15). |
| Live-vs-backtest tracking error | < 25% Sharpe degradation | < 10% | Over 90 days live, compared against a backtest re-run on the same period with the same parameters. |
| Strategy capacity | Known and documented | — | AUM at which modelled edge decays 50%. Method in §12.4. **A strategy without a capacity number is not approved for live capital**, because you cannot size an allocation to an unknown ceiling. |

Two additions v1.0 omits:

| Metric | Minimum | Measured how |
|---|---|---|
| Cost ratio | Fees + slippage + funding < 40% of gross PnL | Rolling 30 days. Above 40%, the edge belongs to the exchange, and a small adverse move in fee tier or spread flips the strategy negative. |
| Recovery factor | > 2.0 | Net profit ÷ max drawdown, since inception. Distinguishes a strategy that recovers from one that merely has not drawn down yet. |

### 1.3 Non-goals

- Predicting price direction from price history alone.
- Beating HFT firms on raw latency without colocation.
- Any strategy whose validated Sharpe exceeds the ceiling for its class (§1.4).

### 1.4 The overfitting ceiling, corrected

v1.0 states that any backtest Sharpe above 4.0 is an overfitting signal. That is right for the
strategies v1.0 spends most of its time on and wrong as a universal rule, and stated universally it
will cause a team to discard a genuine result. Sharpe scales with the square root of independent
bets per year, so the ceiling is a function of holding period.

| Strategy class | Typical holding period | Suspicion threshold | Investigate-hard threshold |
|---|---|---|---|
| Directional / trend | Days to weeks | Sharpe > 2.5 | > 4.0 |
| Stat-arb / pairs | Hours to days | Sharpe > 3.5 | > 5.0 |
| Funding / basis carry | Hours to days | Sharpe > 4.0 | > 6.0 |
| Cross-venue arb | Seconds to minutes | Sharpe > 6.0 | > 10.0 |
| Market making | Sub-second | Sharpe > 8.0 | > 15.0 |

Above the suspicion threshold, look for look-ahead bias before celebrating. Above the
investigate-hard threshold, assume a defect until a specific mechanism is identified and
reproduced out-of-sample. **The rule that does generalise is not a Sharpe number: it is that the
backtest must contain a loss month.** A strategy whose backtest has no losing month over multiple
years has almost certainly been fitted to the sample, whatever its Sharpe.

---

## 2. Where the edge comes from

Structural inefficiencies, not forecasts. Assign engineering effort in this order.

### 2.1 Tier 1 — highest confidence, lowest competition sensitivity

**Funding rate / basis arbitrage.** Perpetual funding deviates from fair value during sentiment
extremes. Long spot, short perp when funding is strongly positive; collect funding. Market-neutral.
Modest returns (8–25% APY), high Sharpe, genuinely robust.

- *Requires:* multi-venue funding feed, spot + perp execution, collateral management,
  liquidation-distance monitoring.
- *Carry arithmetic and the break-even that decides entry:* [Annex B §4](annex/B-cost-model.md).
- *The failure mode that matters:* this strategy is short volatility in disguise. It earns steadily
  and loses in a cluster when a funding regime flips and the short perp leg gaps against you while
  spot is illiquid. Size for the cluster, not the average.
- **[A] This is the Track A starting strategy.** It is the only Tier 1 edge that does not require
  sub-50ms execution.

**Cross-exchange arbitrage.** Price discrepancies between venues. Increasingly competitive on
majors, persistent in mid-cap alts and during volatility spikes.

- *Requires:* pre-funded inventory on every venue (transfer latency makes the opportunity dead on
  arrival), sub-50ms execution, borrow lines, fee-tier optimisation.
- *Note v1.0 understates:* the binding constraint is inventory, not latency. Capital sits split
  across venues earning nothing, and that idle capital is a real cost that must appear in the
  strategy's return calculation. Compute returns on total deployed capital, not on the capital that
  happened to be on the winning side.

**Triangular arbitrage.** Inconsistent cross-rates within one venue (BTC/USDT, ETH/BTC, ETH/USDT).
Single-venue means no transfer risk.

- *Requires:* full order book graph, cycle detection at high frequency, atomic-ish execution with
  partial-fill unwinding.
- *Note:* the unwinding logic is the whole strategy. A two-of-three fill leaves naked exposure, and
  the cost of unwinding it exceeds the arbitrage profit several times over. Specify the unwinder
  before the detector.

### 2.2 Tier 2 — higher return, higher skill requirement

**Market making.** Quote both sides, earn spread and rebates, manage inventory. Where the
professional money is. The hard part is not quoting — it is inventory skew, adverse selection
detection, and toxic flow avoidance.

- *Requires:* inventory-aware quoting (Avellaneda–Stoikov as a starting framework, not an endpoint),
  microprice fair value, cancel-replace latency budget, VIP fee tier.
- **Break-even test before any code is written** ([Annex B §5](annex/B-cost-model.md)): at your
  actual fee tier, compute expected spread capture minus adverse selection cost. Below VIP 4,
  maker rebates rarely cover adverse selection on majors. **[A] Track A does not build this.**

**Liquidation cascade positioning.** OI and leverage data reveal liquidation clusters; position
ahead of forced flows.

- *Requires:* OI/liquidation feeds, leverage estimation, strict stop discipline.
- *Fat left tail.* Position sizing for this strategy uses the conditional-loss method in §8.1, not
  Kelly. Kelly on a fat-tailed edge sizes to ruin.

**Statistical arbitrage / pairs.** Cointegrated crypto pairs mean-revert. Works; decays; needs
constant re-estimation.

- *Requires:* rolling cointegration testing, half-life estimation, regime filters, borrow
  availability for shorts.
- *Decay is the design constraint, not a footnote.* Specify the re-estimation cadence and the
  divergence test that retires the pair, in the strategy spec (§6.1), before going live.

### 2.3 Tier 3 — where an LLM genuinely adds value

An LLM is not a price predictor. It is useful for:

- **Regime classification.** Macro context, on-chain flows, funding structure, volatility surface →
  classify regime → route capital between strategies. Runs on a 1h–4h cadence, never per-tick.
- **Event and news ingestion.** Exchange announcements (listings, delistings, maintenance),
  regulatory filings, protocol governance. Listing announcements have short, exploitable windows.
- **Research acceleration.** Hypothesis generation, code scaffolding, backtest interpretation,
  anomaly explanation.
- **Ops narration.** Explain in plain language why the system did something, for review.

**HARD REQUIREMENT — the LLM never has order-placement authority.** It emits signals and parameters
into a deterministic layer that can veto. Concretely, and this is the part v1.0 leaves to
interpretation:

1. Every LLM output is a JSON document validated against a versioned schema
   ([Annex A §6](annex/A-interfaces.md)). Validation failure is dropped and alerted, never coerced.
2. Every numeric field has a hard range declared in config. Out-of-range clamps to the boundary and
   raises a warning; out-of-range by more than 2× rejects the whole document.
3. LLM output may only *reduce* risk unprompted. It can move a strategy's allocation down without a
   second opinion; moving it up requires the allocation to also pass the quantitative portfolio
   optimiser in §7.
4. Rate-limited to the strategy's stated cadence. A regime classifier that suddenly emits 50
   classifications an hour is malfunctioning, and the rate limiter is what notices.
5. Every call is logged with prompt, model, model version, response, latency and schema-validation
   result, and is replayable (§10.4).

**A malfunctioning LLM must be indistinguishable, from the system's point of view, from an LLM that
is switched off.** Test that by switching it off in staging and confirming the system trades on.

### 2.4 Portfolio construction

Run 5–10 uncorrelated strategies, not one. Allocate by risk contribution, not capital. Monitor
correlation continuously; above 0.6 between a pair, cut the allocation to that pair.
Diversification across edges is the single largest contributor to Sharpe in this kind of system.

The mechanics v1.0 leaves unstated — how risk contribution is computed, how correlation is
estimated on short samples without producing noise, and what "cut" means numerically — are §7.

**[A] Track A will run 2–3 strategies, not 5–10, and should be honest that this is the single
largest gap between Track A and Track B Sharpe.** Two uncorrelated strategies is meaningfully better
than one and meaningfully worse than six, and no amount of engineering closes that gap.

---

## 3. Architecture

### 3.1 Seven layers

```
┌──────────────────────────────────────────────────────────────┐
│  L7  OBSERVABILITY  — metrics, alerts, dashboards, audit     │
├──────────────────────────────────────────────────────────────┤
│  L6  EXECUTION      — routing, order lifecycle, reconcile    │
├──────────────────────────────────────────────────────────────┤
│  L5  RISK           — sizing, limits, kill switches          │
├──────────────────────────────────────────────────────────────┤
│  L4  PORTFOLIO      — allocation, netting, correlation       │
├──────────────────────────────────────────────────────────────┤
│  L3  STRATEGY       — signal generation, per-strategy        │
├──────────────────────────────────────────────────────────────┤
│  L2  FEATURES       — derived state, microstructure, regime  │
├──────────────────────────────────────────────────────────────┤
│  L1  DATA           — ingestion, normalisation, storage      │
└──────────────────────────────────────────────────────────────┘

   RESEARCH  — backtest, validation, trial registry  (§11)
   Not a layer. An environment that replays L1 through L6 offline.
```

v1.0 numbered research as "Layer 2" while the diagram already used L2 for features. The distinction
matters beyond tidiness: research is not in the live data path, has different availability
requirements, must never share a database connection with the trading system, and runs the *same
code* as production with a different venue adapter (rule 2 below). Treating it as a layer invites
someone to put it in the request path.

### 3.2 Non-negotiable architectural rules

1. **Risk is a separate service, not a module inside the strategy.** It must be able to veto or
   flatten regardless of what any strategy wants. A strategy that *can* bypass risk is a strategy
   that eventually *will* bypass risk. Enforced structurally: strategy processes hold no venue
   credentials. They physically cannot place an order. The only path to a venue is through risk and
   then execution, and the credentials live only in the signing service (§13.2).
2. **Same code path for backtest, paper and live.** Only the venue adapter changes. If backtest and
   live run different code, backtest results are fiction. Verified by the differential test in
   §14.2, which replays a live session through the backtester and asserts identical decisions —
   without that test the rule is an intention, not a property.
3. **Event-sourced state.** Every tick, signal, order, fill and risk decision is an append-only
   event. Full system state is reconstructible from the log. This is how you debug a bad day.
4. **Exchange state is truth.** Local position state is a cache. Reconcile continuously (§9.4).
5. **Every cross-layer message carries a correlation ID** *(new in v2.0)*. One identifier, minted
   when a market-data event enters L1, is carried through feature, signal, allocation, risk
   decision, order, fill and PnL. Without it, "why did we buy that" takes a day instead of a minute,
   and post-incident review (§10.5) is guesswork.
6. **Every layer degrades to safe, not to best-effort** *(new in v2.0)*. Defaults on failure: L1
   stale → mark stale, stop emitting. L2 missing input → emit nothing, never impute. L3 no features
   → no signal. L4 no correlation estimate → previous allocation, capped. L5 unreachable → execution
   rejects everything. L6 unsure of order state → query, never resend. **No layer's failure path
   results in a new position.**

### 3.3 Interface contracts

Each boundary has a typed message, a schema version, a latency budget and a defined behaviour on
timeout. Full definitions in [Annex A](annex/A-interfaces.md). Summary:

| Boundary | Message | Budget (p99) [B] | On timeout |
|---|---|---|---|
| L1 → L2 | `MarketEvent` | 500 µs | Mark feed stale, halt dependent features |
| L2 → L3 | `FeatureSnapshot` | 1 ms | Strategy emits no signal |
| L3 → L4 | `Signal` | 5 ms | Signal expires unfilled, logged |
| L4 → L5 | `TargetPosition` | 5 ms | Previous target holds, no increase permitted |
| L5 → L6 | `OrderIntent` + `RiskDecision` | 2 ms | **Reject.** Absence of approval is never approval. |
| L6 → venue | `venue order` | 20 ms + RTT | Order-state query, never a resend |
| all → L7 | `AuditEvent` | async, ≤ 1 s | Buffer to disk; **if the buffer fills, halt trading** |

That last row is deliberate and is a real constraint rather than a formality. A system that keeps
trading while it has lost the ability to record what it is doing cannot be reconciled afterwards.
Losing the audit path is a trading-halt condition.

**[A] Track A multiplies every budget by 20** and runs L2–L5 in a single process with in-memory
queues. The contracts stay identical so the split is possible later without a rewrite; only the
transport changes.

### 3.4 Technology

| Component | Track B | Track A | Rationale |
|---|---|---|---|
| Hot path | Rust or C++ | Python 3.12+, `asyncio`, `uvloop` | GC pauses are unacceptable in an order path measured in microseconds. Track A's edges are measured in seconds. |
| Research | Python (Polars, NumPy, JAX) | Same | Ecosystem and iteration speed |
| Message bus | Aeron, NATS or Redpanda | In-process queues + Redis Streams | Low latency, replayable |
| Tick store | ClickHouse or kdb+ | ClickHouse, or Parquet on disk | Columnar, time-series native |
| State / config | PostgreSQL | PostgreSQL or SQLite | Boring and correct |
| Orchestration | K8s for cold path, bare metal for hot | systemd on one box | K8s adds latency — keep it off the critical path |
| Monitoring | Prometheus + Grafana + PagerDuty | Prometheus + Grafana + ntfy/Telegram | Standard |
| Secrets | HashiCorp Vault / AWS Secrets Manager | `age`-encrypted file, key on a hardware token | §13.2 |

Frameworks worth evaluating before building from scratch: **NautilusTrader** (Rust core, Python API,
production-grade adapters — the strongest starting point for either track), **Hummingbot** (market
making; weaker for custom research), **Freqtrade** (retail tier, fast prototyping only). A serious
team builds the hot path and borrows the adapters.

**[A] Track A should start from NautilusTrader rather than from nothing.** Writing a venue adapter,
an order-lifecycle state machine and a backtester is roughly four months of the six-month runway,
and none of it is where the edge lives. Adopting a framework makes rules 2 and 3 of §3.2 someone
else's solved problem. The build order in §20 assumes this choice.

### 3.5 Repository layout

One repository. Strategy code, risk code and infrastructure move together or they drift apart.

```
/core          venue-agnostic domain types, event schemas, correlation IDs
/adapters      one module per venue; the only code that knows a venue exists
  /binance     /okx     /bybit     /sim   <- sim is the backtest adapter
/layers
  /l1_data     ingestion, normalisation, sequence-gap handling, archive
  /l2_features derived state; pure functions of L1 events, no I/O
  /l3_strategy one module per strategy + the strategy spec that justifies it
  /l4_portfolio allocation, netting, correlation
  /l5_risk     THE RISK SERVICE. Separate deployable. Own repo permissions.
  /l6_execution routing, order FSM, reconciliation, TCA
  /l7_observability metrics, audit sink, alert rules
/research      backtester, validation harness, trial registry, notebooks
/ops           runbooks, chaos scenarios, deployment, dashboards-as-code
/docs          this spec, annexes, ADRs (§14.4), strategy specs
```

Two structural constraints, enforced in CI by an import-graph check:

- `/layers/l3_strategy` **may not import** `/adapters`. Strategies cannot reach a venue.
- `/layers/l5_risk` **may not import** `/layers/l3_strategy`. Risk cannot be made to depend on what
  a strategy wants, which is the code-level expression of §3.2 rule 1.

---

## 4. L1 — Data

Data quality is the highest-leverage investment in the system. A brilliant strategy on bad data is a
losing strategy, and it is a losing strategy that looks like a winning one right up until it trades.

### 4.1 Required feeds

**Market data**
- Full L2 order book, incremental depth updates, sequence-gap detection, automatic resync
- Individual trades with aggressor side
- Best bid/offer at maximum available frequency
- Klines as a convenience layer only — **never as the research primitive**

**Derivatives**
- Funding rates: current, predicted, historical
- Open interest
- Mark price, index price, basis
- Liquidation stream
- Long/short account ratios

**Reference**
- Symbol filters: tick size, lot size, min notional, max position. These change, and when they
  change they break bots (§17.4).
- Fee schedule and current VIP tier
- Exchange announcements: listings, delistings, maintenance windows

**On-chain** (Tier 1/2 strategies)
- Stablecoin mint/burn, exchange net flows, whale wallet movement, DEX liquidity depth

### 4.2 Hard requirements

- **Multi-venue from day one.** Binance, OKX, Bybit minimum. Single-venue dependency is an
  existential risk — see §18. **[A]** Track A may trade one venue initially but **must** build the
  adapter interface with two implementations, and one of them must be exercised in CI. An interface
  with a single implementation is not an interface.
- **Nanosecond timestamps, exchange-side and local-receive.** The delta is both a latency
  measurement and a data-quality signal.
- **Sequence-gap detection on every stream.** Detect, log, resync, and mark the affected window
  unusable for research. The marking is the part that gets skipped and the part that matters:
  research silently trained on a gap window is how a backtest learns to trade a reconnection.
- **Immutable raw archive plus a normalised layer.** Never overwrite raw. Normalisation logic will
  change; raw data will not.
- **Clock discipline.** PTP, or chrony against a stratum-1 source. Drift above 100 ms causes Binance
  to reject signed requests outright (§17.4).

### 4.3 Storage layout

v1.0 requires an immutable archive without saying what it looks like, which in practice means
everyone invents a different one.

```
raw/    venue=X/ stream=Y/ date=YYYY-MM-DD/ hour=HH/ *.jsonl.zst
        Exact bytes from the wire + local receive timestamp. Write-once.
        Checksummed. Never read by the trading system, only by normalisation.
norm/   venue=X/ symbol=Z/ date=.../ *.parquet
        Typed, deduplicated, gap-annotated. The research primitive.
        Regenerable from raw by a pure function, and regenerating it must be a
        routine operation, not a heroic one.
feat/   Derived features, versioned by feature-code hash (§5.3).
```

Retention: `raw` indefinitely for traded symbols (it is the only irreplaceable asset in the
system — a strategy can be rewritten, last March cannot be re-recorded); `norm` indefinitely;
`feat` 90 days, since it is regenerable.

**HARD REQUIREMENT:** normalisation is a pure, versioned function of raw. Re-running version *N* on
the same raw bytes produces byte-identical `norm` output. Verified in CI on a fixed sample.

### 4.4 Data-quality gates — HARD REQUIREMENT

v1.0 names the checks; these are the thresholds. Run daily, per venue, per stream. Any day failing
any gate is **excluded from research datasets** and flagged in the audit log.

| Check | Green | Amber | Red (day excluded) |
|---|---|---|---|
| Sequence gaps per stream per day | 0 | 1–5 | > 5 |
| Total gap duration | < 1 s | 1–30 s | > 30 s |
| Duplicate message rate | < 0.01% | 0.01–0.1% | > 0.1% |
| Crossed-book incidents | 0 | 1–3 | > 3 |
| Feed staleness, max quiet period on an active symbol | < 5 s | 5–30 s | > 30 s |
| Local−exchange timestamp p99 | < 100 ms | 100–500 ms | > 500 ms |
| Clock drift vs NTP peer | < 10 ms | 10–50 ms | > 50 ms |
| Trade/book consistency (trades outside the recorded book) | < 0.1% | 0.1–1% | > 1% |

Amber for three consecutive days escalates to red. This catches the degradation that never quite
trips a threshold, which is the shape most real feed problems have.

**A red day is not only a research exclusion.** If a red condition is live rather than historical,
it is a kill-switch trigger (§8.3) — the same measurement, read in real time.

---

## 5. L2 — Features

*Absent from v1.0 entirely.* The features layer is where look-ahead bias is introduced, and
therefore where it must be structurally prevented rather than reviewed for.

### 5.1 Responsibility

Pure functions from L1 events to derived state. No I/O, no network, no clock reads, no randomness.
This is not a style preference: purity is what makes the layer replayable, and replayability is
what makes rule 2 of §3.2 testable.

### 5.2 Required features

**Microstructure**
- Microprice: `(bid_size × ask_px + ask_size × bid_px) / (bid_size + ask_size)`. Use this as fair
  value, not mid. Mid is wrong whenever the book is imbalanced, which is most of the time.
- Order book imbalance at multiple depths (1, 5, 20 levels)
- Realised volatility over multiple horizons (1m, 5m, 1h, 24h)
- Trade flow imbalance: signed volume over rolling windows
- Effective spread and quoted depth within *k* bps
- Queue position estimate for resting orders (for market making, this is the strategy)

**Derivatives**
- Annualised basis per venue, per expiry
- Funding rate z-score against its own trailing distribution (raw funding is not comparable across
  assets or regimes)
- Open-interest change relative to price change — the sign of the pair distinguishes new positioning
  from unwinding
- Estimated liquidation clusters from OI and leverage ratios

**Cross-venue**
- Price dispersion across venues, fee-adjusted
- Lead-lag: which venue moves first, estimated on a rolling window

**Regime**
- Volatility regime: trailing realised vol bucketed against a long-run distribution
- Trend/chop classification
- LLM regime label (§2.3), as one input among several and never as an override

### 5.3 Hard requirements

- **Every feature declares its lookback and its lag.** A feature computed from a bar may not be used
  for a decision timestamped at or before that bar's close. The classic killer, and it is invisible
  in review because the code looks correct — it is the timestamps that are wrong.
- **Point-in-time correctness.** Feature values are stamped with the timestamp of the *last input
  event* that produced them, not with computation time. The backtester asserts that no decision
  consumes a feature stamped later than the decision.
- **Feature versioning.** Each feature has a version and a content hash of its code. Changing the
  computation creates a new version; it never silently changes history. Backtests record which
  feature versions they used, so a result can be reproduced two years later.
- **No imputation in the live path.** A missing input yields a missing feature, and a strategy
  handles the missing case explicitly. Imputation is a research convenience that becomes a
  production lie.

### 5.4 Look-ahead audit — HARD REQUIREMENT

An automated test, not a code review. For each feature, shift every input forward by one event and
assert the feature output changes only in the expected direction. A feature that is unchanged by
shifting its inputs forward is reading the future. Runs in CI on every feature change.

---

## 6. L3 — Strategy

*Absent from v1.0 as a section, though it is what most of the document is about.*

### 6.1 The strategy specification — HARD REQUIREMENT

**No strategy is coded before its specification is written and reviewed.** v1.0 requires a written
economic rationale; this is the template it must fill, stored at
`/docs/strategies/<name>.md`. The purpose is to make it expensive to ship a strategy nobody can
explain, because the backtest will always be willing to explain it for you.

```markdown
# Strategy: <name>                      Owner: <person>   Status: research|paper|live|retired

## 1. Economic rationale
Who is the counterparty?                 Be specific. "The market" is not a counterparty.
Why do they trade against me?            What need are they meeting at my expense?
Why does this persist?                   Structural reason, not "it has worked so far".
What would end it?                       Name the specific change that kills this edge.

## 2. Mechanics
Instruments, venues, entry, exit, holding period, expected trades/day.

## 3. Parameters
Table: name, range, chosen value, sensitivity. HARD LIMIT: 6 free parameters.

## 4. Risk profile
Return distribution shape. Where is the tail? What is the worst plausible day, and is
that estimated from the sample or from the mechanism? Correlation to the other live
strategies. Behaviour in each regime of §11.2 item 5.

## 5. Capacity
$ at which modelled edge decays 50%, with the method (§12.4) and the binding constraint
(book depth / borrow / funding pool / fee tier).

## 6. Costs
Fee tier assumed, maker/taker mix, expected slippage, funding, borrow.
Cost as % of gross PnL. If above 40%, justify or stop here.

## 7. Validation results
Every item of §11.2, with numbers. Trial count and deflated Sharpe. Holdout result,
recorded once.

## 8. Kill criteria                       Pre-registered. Signed before go-live.
Live Sharpe below X over Y days → disable.
Divergence from backtest beyond Z → disable.
Named structural change (from §1) observed → disable.

## 9. Monitoring
Which L7 dashboards and alerts are specific to this strategy.
```

Section 8 is pre-registered and signed before go-live precisely because the moment to decide when
to stop is the moment before there is money on the table and a reason to move the line.

### 6.2 Strategy contract

- A strategy is a **pure function** of `FeatureSnapshot` → `Signal | None`. No venue access, no
  order placement, no risk decisions, no direct state mutation.
- A `Signal` expresses *desired exposure* — target position, urgency, price limit, validity window —
  not an order. Translating desire into orders is L6's job, and keeping that boundary is what lets
  execution improve without touching strategy code.
- Strategies are **individually disableable at runtime** without restarting the system, because the
  alternative is that disabling a misbehaving strategy requires a restart during the incident it is
  causing.
- Every strategy exposes a **health endpoint**: last signal time, signals today, current exposure,
  live-vs-expected divergence.

### 6.3 Strategy lifecycle

```
research → paper → micro-live → live → (degraded) → retired
```

Transitions are gated (§15) and recorded. `degraded` is a first-class state that v1.0 has no room
for: reduced allocation, still trading, under investigation. Without it, every problem becomes a
binary between ignoring it and turning the strategy off, and in practice teams choose ignoring.

---

## 7. L4 — Portfolio

*Absent from v1.0 as a section.*

### 7.1 Allocation by risk contribution

Allocate so each strategy contributes an equal share of portfolio risk, not equal capital. Given
strategy volatilities and a correlation matrix, solve for weights *w* such that each strategy's
marginal contribution to portfolio volatility is equal. Full formulation and the solver in
[Annex B §6](annex/B-cost-model.md).

Constraints on the solution:
- No strategy above 40% of risk budget, whatever the optimiser says
- No strategy below 5% (below that it is not earning its operational complexity — retire it or
  size it properly)
- Sum of gross exposure within the §8.2 limit
- Turnover penalty, so the allocator does not churn the book chasing estimation noise

### 7.2 Correlation estimation

The practical problem v1.0 skips: correlation estimated on a short sample is mostly noise, and the
optimiser will act on that noise with great confidence.

- Estimate on **daily strategy PnL**, not on asset returns. Two strategies trading the same asset
  can be uncorrelated; two trading different assets can be identical.
- Minimum 60 observations before an estimate is used. Below that, assume correlation 0.5 between
  any pair — a deliberately pessimistic prior that costs a little diversification and prevents the
  optimiser from concentrating on a coincidence.
- Ledoit–Wolf shrinkage toward a constant-correlation target.
- Compute both a 60-day and a 20-day estimate. **Use the higher.** Correlations rise in stress, and
  the stress estimate is the one that will be true when it matters.
- Above 0.6 for a pair: halve the combined allocation and alert. Above 0.8: disable the worse
  performer of the two and require review before it returns.

### 7.3 Netting

Before orders reach risk, net offsetting intentions across strategies. If strategy A wants +10 BTC
and strategy B wants −8 BTC, the system trades +2, and the internal crossing is recorded at mid so
each strategy's PnL is still attributed correctly (§12.2).

This is not a micro-optimisation. On a book of 5–10 strategies it routinely removes 20–40% of gross
turnover, and turnover is fees — which is the difference between §1.2's cost ratio passing and
failing.

**Netting never increases a position.** If netting would produce a larger absolute exposure than
either strategy requested, it is a bug; assert against it.

### 7.4 Rebalance cadence

Continuous re-optimisation is expensive and unstable. Re-optimise allocations daily at a fixed time,
on a correlation breach, or on a strategy state change. Intraday, strategies trade within their
allocated risk budget without re-solving the portfolio.

---

## 8. L5 — Risk

Specified before strategy, deliberately. Risk is the layer that decides whether the operation
survives a bad month, and it is built first.

### 8.1 Position sizing — one rule per strategy class

v1.0 prescribes fractional Kelly and volatility targeting across the board. Kelly is the wrong tool
for two of the strategy classes v1.0 itself recommends, so the rule is split.

**Directional and stat-arb strategies: fractional Kelly at 0.25×, volatility-targeted.**

Full Kelly is theoretically optimal and practically ruinous, because your edge estimate is wrong.
The quarter is not arbitrary: if the true edge is half your estimate, quarter-Kelly still grows,
while half-Kelly is at the ruin boundary. Additional requirement v1.0 omits: **the Kelly fraction
uses the lower bound of the 95% confidence interval on edge, not the point estimate.** An edge of
2bps ± 3bps sizes to zero, which is the correct answer.

**Market making: inventory-based, not Kelly.** Size comes from the Avellaneda–Stoikov reservation
price and inventory penalty. Kelly has no meaning when you are quoting both sides.

**Fat-tailed strategies (liquidation positioning): conditional-loss sizing.** Size so that the
estimated 99th-percentile adverse move costs no more than 1% of equity. Kelly on a fat-tailed edge
sizes to ruin, slowly and then quickly.

**All classes:**
- **Volatility targeting.** Scale position size inversely to realised volatility so risk per
  position stays constant. Use a floor on the volatility estimate — as realised vol approaches zero
  the naive formula sizes to infinity, and this has killed real systems.
- **Hard cap: 2% of portfolio equity at risk per position.**
- **Correlation-adjusted sizing.** Correlated positions count against a shared limit; two 2%
  positions with correlation 0.9 is one 4% position wearing a disguise.

Formulas: [Annex B §7](annex/B-cost-model.md).

### 8.2 Limits — enforced in the risk service, not in strategy code

| Limit | Value | Action on breach | Reset |
|---|---|---|---|
| Per-trade risk | 2% of equity | Reject order | n/a |
| Daily loss | 3% of equity | Flatten all, halt | Manual, next UTC day |
| Weekly loss | 7% of equity | Halt | Mandatory review (§8.4) |
| **Max drawdown** | **12%** | **Full stop, revalidation required** | **Two-person authorisation** |
| Gross exposure | 3× equity | Reject new exposure | Automatic when below |
| Single-asset concentration | 25% of book | Reject | Automatic |
| Order rate | Venue limit × 0.7 | Throttle | Automatic |
| Live-vs-backtest divergence | 2σ over 30 days | Auto-disable that strategy | Review |
| **Venue balance concentration** | **40% of capital on any one venue** | **Alert + sweep** | **Automatic** |
| **Liquidation distance** | **< 25% from mark** | **Auto-deleverage** | **Automatic** |
| **Single-order notional** | **max(2% equity, 5× median order)** | **Reject** | **n/a** |
| **Consecutive rejects** | **5 on one strategy** | **Disable strategy** | **Manual** |

**The max-drawdown correction.** v1.0 sets a 15% drawdown kill limit against a 20% drawdown
*target*, which means the system stops permanently while still inside its own declared tolerance,
leaving no room between "acceptable" and "dead". It is set to 12% here, deliberately *below* the 20%
target, with the gap doing real work: a soft trigger at 8% halves all allocations and requires
review, and the hard stop at 12% ends trading. The 20% target then describes the outcome including
the reaction, not the level at which nobody reacts.

The four added limits are each drawn from a failure mode in §8.5 that the v1.0 limit table does not
constrain — venue concentration for counterparty risk, liquidation distance for margin death,
single-order notional for fat-finger, consecutive rejects for the desync-to-infinite-loop path.

### 8.3 Pre-trade checks

Ordered cheapest-first so the common rejection costs the least. **Any check failing rejects; there
is no override path in code.** An override requires a config change under the two-person rule
(§13.2), which cannot be executed in the heat of an incident by one person — which is the point.

```
1. Kill switch engaged?              → reject all
2. Strategy enabled?                 → reject
3. Reconciliation clean?             → reject (startup gate, §9.5)
4. Feed fresh for this symbol?       → reject
5. Symbol filters (lot/tick/notional)→ reject, log as defect (L6 should have rounded)
6. Single-order notional             → reject
7. Per-trade risk ≤ 2%               → reject
8. Position limit after fill         → reject or partial
9. Concentration limit               → reject
10. Gross exposure limit             → reject
11. Order rate budget                → throttle (queue, do not reject)
12. Liquidation distance after fill  → reject
13. Daily/weekly loss state          → reject if halted
```

Budget: p99 under 2 ms [B] / 40 ms [A]. **Timeout is a reject.** Absence of an approval is never an
approval, and a risk service that fails open is worse than no risk service, because it creates the
belief that positions are checked.

### 8.4 Kill switches — HARD REQUIREMENT

**Automated triggers:** drawdown breach; latency spike beyond budget; feed staleness; position
reconciliation mismatch; order rejection rate spike; exchange connectivity loss; unexpected margin
ratio; audit buffer full (§3.3); risk service heartbeat missed.

**Manual:** a single command that flattens everything and disables all strategies. Every operator
has it. **Tested weekly in production during low-risk hours** — an untested kill switch is a
hypothesis, and weekly testing in staging tests staging.

**Dead-man's switch:** the system auto-flattens if the risk service stops heartbeating (2 s
interval, 10 s tolerance [B]). A trading system that keeps trading after its risk service dies is
the worst possible failure mode in the document.

**Recovery procedure** — *absent from v1.0, and the absence is what produces the 3am unilateral
restart.* A kill switch with no defined way back is a switch that gets bypassed rather than reset.

| Trigger class | Flatten? | Return to trading requires |
|---|---|---|
| Feed staleness | Halt new orders, hold positions | Feed green for 5 min, automatic |
| Latency spike | Halt new orders | Latency green for 5 min, automatic |
| Connectivity loss | Hold, then flatten after 60 s | Reconnect + full reconciliation clean |
| Reconciliation mismatch | Halt immediately | Manual investigation, root cause recorded, one operator |
| Rejection-rate spike | Disable affected strategy | Root cause recorded, one operator |
| Daily loss | Flatten all | Next UTC day + operator acknowledgement |
| Weekly loss | Flatten all | Written review, two people |
| Max drawdown | Flatten all | Full revalidation (§11.2) of every live strategy, two people |
| Dead-man | Flatten all | Risk service healthy + reconciliation + one operator |

**On restart after any flatten, reconciliation runs before any strategy is permitted to emit a
signal** (§9.5). No exceptions, including the exception everyone wants to make for "we only
restarted for a config change".

### 8.5 The failure modes that actually kill trading systems

Rank these above strategy risk in engineering priority. Each has a named defence and a test.

| # | Failure | Mechanism | Defence | Test (§14) |
|---|---|---|---|---|
| 1 | Double position | Network timeout → retry → two fills | Idempotency key (`newClientOrderId`) on every order. Never retry-and-hope. | Chaos: drop the response after the exchange accepts |
| 2 | State desync | Local position ≠ exchange position | Continuous reconciliation; exchange is truth | Chaos: mutate local state, assert detection < 5 s |
| 3 | Fat-finger config | Decimal misplaced in a size parameter | Hard bounds validation at config load; staging rejects out-of-range | Unit: every config field has a declared range and a rejection test |
| 4 | Infinite loop | Bug causes rapid-fire orders, burns fees, hits limits | Order-rate circuit breaker **independent of strategy logic** | Chaos: strategy that emits 10k signals/s |
| 5 | Liquidation | Margin miscalculation | Liquidation-distance monitor with auto-deleverage well before the exchange threshold | Chaos: simulate a 30% adverse mark move |
| 6 | Restart without state | System restarts, ignores open positions, opens more | Mandatory reconciliation-on-startup gate | Integration: restart with open positions |
| 7 | **Silent fill loss** | listenKey expires, fills never arrive, system believes it is flat | listenKey keepalive + **REST position poll as an independent check** (§17.4) | Chaos: kill the user data stream mid-position |
| 8 | **Stale-balance rejects** | Local balance wrong → `-2010` → strategy retries forever | Treat `-2010` as a reconciliation trigger, not a retry | Chaos: inject `-2010` |
| 9 | **Clock drift** | Signed requests rejected wholesale (`-1021`) | chrony + drift monitor + halt above 50 ms | Chaos: skew the clock 200 ms |
| 10 | **Partial-fill orphan** | Multi-leg strategy fills one leg | Per-strategy unwinder with its own timeout, specified before the strategy | Chaos: fill leg 1, reject leg 2 |

Items 7–10 are added in v2.0. Each has caused a documented production loss in systems of this
shape, and each is invisible in a backtest because the backtest has no listenKey, no clock and no
partial fills unless it was deliberately built to have them (§11.1).

---

## 9. L6 — Execution

Poor execution destroys more edge than poor strategy. On a strategy with 5 bps of gross edge, 3 bps
of avoidable slippage removes 60% of it.

### 9.1 Requirements

- Smart order routing across venues by **effective price** = quoted price + fees + expected slippage
  + transfer cost + a funding-differential term for perps
- Maker-preferred logic with a configurable taker-fallback timeout — post, wait, cross only if the
  signal is decaying
- Order slicing (TWAP, VWAP, POV) for anything large relative to book depth
- Iceberg orders to hide size
- Post-only flags where the strategy's economics depend on maker fees
- Cancel-replace optimisation — for market making this is the hot path; budget for it explicitly
- Full order lifecycle state machine with timeout handling **at every state**

### 9.2 Order lifecycle state machine

*Absent from v1.0, which requires "a full state machine with timeout handling at every state" and
leaves the states to the reader.* Every state has a timeout and a defined expiry action. Full
transition table in [Annex A §4](annex/A-interfaces.md).

```
                 ┌──────────┐
                 │ INTENT   │ strategy signal, pre-risk
                 └────┬─────┘
              risk approve │ reject → REJECTED
                 ┌────▼─────┐
                 │ PENDING  │ sent, no ack.  timeout 5s → QUERY
                 └────┬─────┘
                 ┌────▼─────┐
                 │ ACKED    │ exchange has it
                 └────┬─────┘
       ┌──────────────┼───────────────┐
  ┌────▼────┐   ┌─────▼──────┐  ┌─────▼─────┐
  │ PARTIAL │   │   FILLED   │  │ CANCELLED │
  └────┬────┘   └────────────┘  └───────────┘
       │ timeout → decide: chase, hold, or cancel-remainder
  ┌────▼────┐
  │  QUERY  │ state unknown. Poll until resolved. NEVER resend.
  └─────────┘
```

**`QUERY` is the single most important state and the one most often missing.** A `-1007 TIMEOUT`
response does not mean the order failed — it means the outcome is unknown. Systems without a
`QUERY` state resolve unknown by resending, and resending an order that actually filled is failure
mode #1 in §8.5. An order may sit in `QUERY` indefinitely; it may never transition to a state that
places a new order.

### 9.3 Hard requirements

- **Idempotency on every order via client order ID.** Non-negotiable. The ID is deterministic from
  (strategy, symbol, intent sequence) so a retry after a crash regenerates *the same* ID and the
  exchange rejects the duplicate for you.
- **Reconciliation loop every 5 seconds minimum:** open orders, positions, balances, against
  exchange truth.
- **Startup reconciliation gate.** No strategy runs until reconciliation completes cleanly.
- **Transaction cost analysis on every fill:** implementation shortfall vs arrival price, logged
  and reviewed weekly.

### 9.4 Reconciliation algorithm

v1.0 says "reconcile continuously". This is what that means, and the discrepancy classes matter more
than the loop:

```
every 5s, per venue:
  fetch open orders, positions, balances
  compare against local cache
  classify each discrepancy:
    MISSING_LOCAL   exchange has a position/order we do not know about
                    → HALT. This is an unknown exposure. Never auto-adopt:
                      adopting it means trading a position no strategy asked for.
    MISSING_REMOTE  we believe in an order the exchange does not have
                    → query by client order ID; if genuinely absent, mark
                      terminal and emit a correction event
    QTY_MISMATCH    same position, different size
                    → exchange wins; emit correction; if > 0.1% of equity, HALT
    PRICE_MISMATCH  avg entry differs
                    → exchange wins; correct PnL attribution; log
  emit ReconciliationReport to L7 every cycle, including the clean ones
```

The clean reports matter: the absence of a report is then itself an alertable condition, which is
how you notice that reconciliation stopped running rather than that it stopped finding problems.

Three consecutive failed reconciliation cycles is a kill-switch trigger.

### 9.5 Startup gate — HARD REQUIREMENT

```
1. Load config, validate every field against declared bounds  → fail = exit
2. Connect venues, fetch exchangeInfo, cache symbol filters   → fail = exit
3. Fetch all positions, orders, balances
4. Compare with last persisted state
5. Discrepancy?  → require operator acknowledgement. Do not auto-resolve.
6. Verify clock drift < 50 ms                                 → fail = exit
7. Verify risk service reachable and healthy                  → fail = exit
8. ONLY NOW: enable strategies, one at a time, logging each
```

Step 5 is the one under pressure during an incident, and the one that must not be automated.

### 9.6 Transaction cost analysis

Per fill, recorded: arrival price (mid at signal time), decision price, execution price,
implementation shortfall in bps, fee paid, maker/taker, queue wait, slippage vs modelled slippage.

Weekly review compares **modelled** costs against **realised** costs per strategy. Divergence above
20% means the backtest cost model is wrong, which means every backtest is wrong, which is a
research-halt condition and not a rounding issue. This closed loop between live TCA and the
backtest cost model is the mechanism that keeps §11.1 honest over time; without it, the cost model
is calibrated once and decays quietly.

---

## 10. L7 — Observability

*Absent from v1.0 as a section despite appearing in the architecture diagram.* Every layer emits;
L7 is the layer that makes the system explicable.

### 10.1 Service level indicators

| SLI | Target | Page? |
|---|---|---|
| Feed uptime per venue | 99.9% | Yes |
| Feed staleness p99 | < 500 ms | Yes |
| Risk decision latency p99 | < 2 ms [B] / 40 ms [A] | Yes |
| Order ack latency p99 | < 100 ms | No, alert |
| Reconciliation success rate | 100% | Yes on 2 consecutive failures |
| Audit write success | 100% | Yes |
| Strategy signal-to-order latency p99 | < 50 ms [B] | No |
| Clock drift | < 10 ms | Yes above 50 ms |

### 10.2 Alert taxonomy

Three severities, and the discipline is in what does *not* page.

- **P1 — page immediately, 24/7.** Money at risk right now: kill switch fired, reconciliation
  mismatch, connectivity loss with open positions, liquidation distance breach, drawdown breach,
  audit failure.
- **P2 — notify, respond within business hours.** Degradation: single feed down with others healthy,
  latency above budget without loss, one strategy disabled, data-quality amber.
- **P3 — dashboard only.** Informational: allocation change, daily PnL, fill rate drift.

**A P1 that fires without money at risk is a defect in the alert**, and gets fixed at the same
priority as a defect in the code. Alert fatigue is the mechanism by which the one real page gets
ignored, and it is caused by exactly this.

### 10.3 Dashboards

Dashboards are defined as code in `/ops` and reviewed with the code they describe.

1. **Trading** — PnL (realised, unrealised, funding accrued), positions, exposure vs limits,
   per-strategy contribution
2. **Risk** — distance to every limit as a percentage, kill switch status, drawdown vs the 8%/12%
   thresholds, liquidation distance per venue
3. **Execution** — fill rates, maker ratio, slippage vs model, rejections by error code, TCA
4. **Data** — feed health, gaps, staleness, latency percentiles, quality-gate status
5. **System** — service health, heartbeats, queue depths, resource use

The first screen an operator opens at 3am should answer one question: *is money at risk right now,
and is the system already handling it.* Design dashboard 2 for that question and nothing else.

### 10.4 Audit log — HARD REQUIREMENT

Append-only, tamper-evident (hash-chained), off-host replicated. Every decision, with its
correlation ID, sufficient to answer "why did the system do that" without inference.

**Replay requirement:** given the audit log for a window, the research environment reproduces every
decision the live system made, bit for bit. This is the same mechanism that proves rule 2 of §3.2
and it is the difference between a debuggable system and a plausible story about a bad day.

### 10.5 Incidents

| Severity | Definition | Response |
|---|---|---|
| SEV1 | Loss > 1% equity, or unknown exposure, or trading while risk is down | Page, flatten if unsure, post-mortem within 48h |
| SEV2 | Loss 0.25–1%, or a limit breached without loss | Notify, post-mortem within a week |
| SEV3 | Defect with no financial impact | Ticket |

**Every SEV1 and SEV2 produces a written, blameless post-mortem containing a new automated test that
would have caught it.** A post-mortem without a test is a story. This is the mechanism by which
§8.5's list of failure modes grows from experience rather than staying fixed at ten.

---

## 11. Research and validation

This is where most well-funded trading projects fail. Not in the strategy, not in the
infrastructure — in the validation. Budget accordingly: roughly 40% of research time, and if that
sounds high, note that it is the phase where failure is cheapest.

### 11.1 The cost model — HARD REQUIREMENT

A backtest without an honest cost model is a random number generator with good graphics. Required
components, with formulas in [Annex B](annex/B-cost-model.md):

- Maker and taker fees at the **actual** VIP tier, BNB discount if applicable
- Slippage modelled from **real order book depth**, not a flat percentage
- **Market impact** as a function of size vs available depth — your own order moves the book
- **Partial fills and queue position.** For maker strategies queue position is the entire game;
  modelling a maker strategy without it produces a fantasy
- **Latency**, order-to-exchange and fill-to-system, sampled from the *measured* distribution, not
  assumed
- **Funding payments** at actual settlement times, not averaged
- **Borrow costs** for shorts, including the borrow being unavailable
- **Rejected orders, rate limits, exchange downtime**

*Added in v2.0, because each silently inflates results:*
- **Fee tier decay.** Tier depends on trailing 30-day volume. A backtest that assumes VIP 4
  throughout while the live account sits at VIP 1 for the first two months is wrong in the period
  that decides whether you continue.
- **Adverse selection.** Maker fills are not random. You are filled preferentially when the price is
  about to move against you. Model it as a conditional drift after fill, estimated from data.
- **Funding on the losing side.** Backtests that model funding received frequently omit funding
  paid during the periods the position is inverted.

**Review rule of thumb, retained from v1.0 because it is the best single sanity check in the
document:** if modelling costs properly does not cut backtest returns by at least 30%, the cost
model is wrong. Not the strategy — the model. Go and find what is missing.

### 11.2 Validation protocol — HARD REQUIREMENT, no exceptions

1. **Walk-forward analysis.** Optimise on window *N*, test on *N+1*, roll. Never a single
   in-sample optimisation.
2. **Purged K-fold cross-validation with embargo.** Standard CV leaks in time series. Purge
   overlapping samples; embargo a window after each test fold.
3. **Locked-away holdout.** The most recent 20% of data. Touched **once**, at the final go/no-go.
   If a strategy fails on holdout it is dead — you do not re-tune and re-test. Enforced technically:
   holdout lives in a separate store the research environment cannot read, and access is logged
   (§11.3). Discipline that depends on remembering to be disciplined is not discipline.
4. **Deflated Sharpe ratio.** Adjust for the number of trials. A Sharpe of 2.0 after 500 backtests is
   not a Sharpe of 2.0. Formula in [Annex C §2](annex/C-validation.md).
5. **Regime testing.** Evaluated separately across bull, bear, chop and high-volatility regimes. A
   strategy that works in one regime needs a regime filter, and the filter needs its own validation
   — including the cost of being wrong at the regime boundary, which is where filters fail.
6. **Monte Carlo on trade sequence.** Reshuffle 10,000 times. Report the **5th-percentile**
   drawdown, not the observed one. Size against that number.
7. **Parameter sensitivity.** Plot performance across the parameter surface. A narrow profitable
   spike is overfitting; robust strategies sit on broad plateaus.

*Added in v2.0:*

8. **Transaction-cost sensitivity.** Re-run at 1.5× and 2× modelled costs. A strategy that dies at
   1.5× costs is one fee-tier change from dead, and fee tiers change.
9. **Data-quality sensitivity.** Re-run excluding all amber data days (§4.4). A material change
   means the result depends on suspect data.
10. **Reality check on the counterparty.** State who loses the money. If nobody can name them,
    return to §6.1 section 1. This is a soft gate enforced by a human, and it catches the class of
    strategy that passes every statistical test because it has fitted a data artefact.

### 11.3 Overfitting controls

- **Trial registry — HARD REQUIREMENT.** Every backtest run is logged automatically by the harness:
  strategy, parameters, data range, timestamp, result, code hash. Deflated Sharpe uses the **true**
  trial count from the registry, not the remembered one. Self-reported trial counts are always low,
  not from dishonesty but because failed experiments do not feel like trials.
  **The registry is written by the harness, not by the researcher. A backtest that runs without
  registering does not run — the harness refuses to start without a registry connection.**
- **Prefer few parameters.** More than 5–6 free parameters on a single strategy is a warning; §6.1
  makes 6 a hard limit.
- **Written economic rationale before coding.** "The backtest works" is not a rationale (§6.1).
- **Survivorship bias.** The universe must include delisted tokens. Excluding them inflates altcoin
  backtests enormously — this is one of the largest single biases available in crypto research,
  because the delisted tail is where the losses were.
- **Look-ahead bias.** Audit every feature (§5.4). The classic killer is using a bar's close to make
  a decision timestamped at that same close.
- **Holdout access log.** Every read of the holdout store is logged with who, when and why. Two
  reads of the holdout for the same strategy is a process failure, and it is a process failure that
  is invisible unless it is logged.

---

## 12. Accounting, attribution and capacity

*Absent from v1.0 entirely.* Without this section you cannot answer "which strategy is making
money", which makes §7 decorative and makes every allocation decision an opinion.

### 12.1 Books

- **Realised PnL:** closed trades, net of fees, in USD terms at execution time.
- **Unrealised PnL:** open positions marked to venue mark price, not last trade. Last trade can be
  an outlier; mark price is what the exchange liquidates against, so it is what matters.
- **Funding accrual:** accrued continuously between settlements, not booked in lumps. Lumpy booking
  makes the equity curve look like it has jumps, which corrupts the drawdown and Sharpe measures in
  §1.2.
- **Borrow accrual:** same treatment.
- **Fee ledger:** every fee, by venue, strategy and maker/taker, because §1.2's cost ratio is only
  as good as this ledger.
- **Equity:** the single number the risk limits in §8.2 are computed against. Defined as
  `cash + unrealised + accrued funding − accrued borrow`, computed the same way everywhere. Two
  definitions of equity in one system means two different drawdown numbers and an argument during
  an incident.

### 12.2 Per-strategy attribution

Every fill carries its originating strategy ID. Internal crossings from netting (§7.3) are booked to
both strategies at mid, so netting improves the aggregate without distorting attribution.

Shared costs — infrastructure, data, idle capital — are allocated by risk contribution and reported
separately from trading costs. A strategy that is profitable gross and unprofitable after its share
of a $40k/year market data bill is unprofitable, and this is the only place that becomes visible.

### 12.3 Reporting cadence

Daily: PnL by strategy, costs, limit utilisation, incidents.
Weekly: TCA review, model-vs-realised cost divergence, correlation matrix, strategy health.
Monthly: strategy revalidation, capacity re-estimate, fee tier check.
Quarterly: full system audit, chaos test results, key rotation.

### 12.4 Capacity estimation

**HARD REQUIREMENT: no strategy goes live without a capacity number** (§1.2).

Method: re-run the backtest at increasing size, with market impact modelled from real book depth
(not extrapolated from small fills). Plot net return against deployed capital. Capacity is the
capital at which net return falls to half the small-size return.

Cross-check against the binding constraint, which is usually not impact:
- Book depth within the strategy's price tolerance
- Borrow availability for short legs
- Funding pool size for carry strategies — you are one of several collecting it, and your own size
  moves the funding rate
- Fee tier thresholds, which can work in your favour as size grows

Report capacity as a range with the binding constraint named. **Deploy at most 25% of estimated
capacity**; the estimate is made with the same models that §11.1 warns are optimistic.

---

## 13. Infrastructure, security, operations

### 13.1 Infrastructure

**Colocation.** Binance matching engines run in AWS Tokyo (`ap-northeast-1`). Deploy there.

v1.0 calls this "a 100–300 ms improvement" without saying over what, which makes it hard to decide
against. Concretely, approximate round-trip times to `api.binance.com`:

| From | RTT | Viable for |
|---|---|---|
| AWS `ap-northeast-1`, same AZ | 1–5 ms | Market making, cross-venue arb, everything |
| Europe (Frankfurt/London VPS) | 220–280 ms | Carry, stat-arb, slow strategies |
| Lagos / Port Harcourt | 280–400 ms, variable | Carry only, and badly |

**The correction that matters is not the number, it is when to spend it.** Colocation is the
difference between a viable and non-viable *market-making* strategy. It is close to irrelevant for
funding-rate carry, where the position is held for hours and entry timing tolerance is seconds.

**[A] Track A does not need Tokyo colocation in month 1.** A $40/month VPS in Tokyo (not colocated,
just in-region) captures most of the benefit for carry and stat-arb: it removes the 300 ms and the
route instability, which is what actually breaks signed requests and fill handling from Nigeria. Do
that on day one; defer dedicated hardware until a strategy's economics demonstrably require it.

**In both tracks, the bot never connects from Nigeria.** Not for latency reasons alone — for route
stability and because the ISP-level block on `binance.com` (§18) makes a Nigerian egress path an
unnecessary variable.

Also required:
- Separate the hot path (bare metal or dedicated instances) from research and monitoring. A
  research job that pins the CPU must not be able to add latency to an order.
- Redundant connectivity, automated failover — but **failover is flat-and-restart, not resume**. A
  system resuming from stale state is more dangerous than a system that is down.
- Backup region, cold standby.

### 13.2 Security — HARD REQUIREMENTS

- **API keys: trading enabled, withdrawals DISABLED. Always. No exception, ever.** If a key with
  withdrawal rights leaks, the loss is total and instant, and no other control in this document
  matters.
- **IP allowlisting on every key.** Binance keys with unrestricted IP access have their Spot &
  Margin trading permission expire after 90 days; IP-restricted keys do not expire. The security
  control and the operational control point the same way here.
- **Ed25519 keys**, which Binance recommends over HMAC for both performance and security. The
  private key never leaves the signing service.
- **Signing service.** A separate process holding keys, exposing only "sign this request". The
  trading system never handles key material; a memory dump of the trading process yields nothing.
  It enforces its own allowlist of endpoints — a request to a withdrawal endpoint is refused at the
  signer even if a key somehow had the permission, which is defence in depth against the one
  failure that is unrecoverable.
- **Secrets in Vault or AWS Secrets Manager** [B] / `age`-encrypted with the key on a hardware
  token [A]. Never in the repo, never in committed environment files, never in logs. Log redaction
  is tested, because the usual way a key reaches a log is an exception handler printing a request.
- **Separate keys per strategy and per environment,** so a compromise is contained and attributable.
- **Cold storage for the majority of capital.** Only active trading capital on exchange (§19).
- **Full audit log, append-only, tamper-evident** (§10.4).
- **Two-person rule for config changes to production risk limits.** Technically enforced: the risk
  config is in a repository requiring two approvals, and the risk service refuses to load a config
  whose signature chain does not show two distinct signers. **[A]** With one person, the substitute
  is a mandatory 24-hour delay between committing a risk-limit change and it taking effect, which
  does not prevent a bad decision but does prevent a bad decision made at 3am during a drawdown.
- **Key rotation quarterly**, and immediately on any suspicion. Rotation is a rehearsed procedure
  with a runbook, not an improvisation.

### 13.3 Operations

- **On-call rotation with clear escalation.** Crypto is 24/7 and so is the failure surface.
  **[A]** A single operator cannot be on call 24/7, and pretending otherwise is a design flaw, not
  a staffing one. Track A compensates structurally: tighter automated limits, auto-flatten on
  anything ambiguous, and no strategy whose risk profile requires a human inside an hour.
- **Runbooks** for: exchange outage, feed disconnection, position mismatch, unexpected drawdown,
  key compromise, forced liquidation, clock drift, and audit failure. Each names the first action,
  the diagnostic, and who to call.
- **Chaos testing in staging** (§14.3): kill the feed, kill the risk service, inject latency,
  simulate partial fills and rejections.
- **Cadence:** weekly performance review, monthly strategy revalidation, quarterly full system
  audit.

---

## 14. Testing and change management

*Absent from v1.0, which lists chaos scenarios under operations and never states what "tested"
means.*

### 14.1 Test pyramid

| Level | Scope | Gate |
|---|---|---|
| Unit | Pure functions: features, sizing, cost model | 90% coverage on `l2`, `l5`; 100% on sizing and limit arithmetic |
| Property | Invariants: netting never increases exposure, rounding never exceeds a filter, risk never approves above a limit | Hypothesis/proptest, runs in CI |
| Replay | Recorded market sessions through the full stack | Byte-identical decisions vs the recorded run |
| Integration | Against testnet | Every order type, every error path |
| Chaos | Failure injection (§14.3) | All §8.5 scenarios pass before live |
| Acceptance | Phase gates ([Annex F](annex/F-gates.md)) | Automated, exits non-zero |

### 14.2 The same-code-path test — HARD REQUIREMENT

Rule 2 of §3.2 is an assertion until this test exists:

```
1. Record a live (or paper) session: every inbound event, every decision, with correlation IDs
2. Replay the recorded inbound events through the backtester with the sim adapter
3. Assert: identical signals, identical order intents, identical risk decisions,
   in identical order
4. Any divergence is a P1 defect. Backtest results are invalid until it is resolved.
```

Run nightly against the previous day. This is the only thing standing between the team and the
most common expensive failure in the field: a backtest that measured different software from the
one holding the positions.

### 14.3 Chaos scenarios — required before any live capital

Each of the ten failure modes in §8.5, injected in staging, with an asserted expected behaviour:
feed kill mid-position; risk service kill (dead-man must flatten); 500 ms latency injection; order
response dropped after exchange acceptance; partial fill then venue rejection; clock skew 200 ms;
listenKey expiry; `-2010` injection; rate-limit 429 storm; venue returns 418; strategy emitting
10,000 signals/second.

**Re-run quarterly and after any change to L5 or L6.** Chaos tests that ran once, a year ago, test
a system that no longer exists.

### 14.4 Change management

- **Risk config** (§13.2): two approvals, signature chain verified at load.
- **Strategy parameters:** versioned, reviewed, effective at a stated time, recorded in the audit log
  so a PnL change can be attributed to a parameter change rather than to the market.
- **New strategy:** follows §6.3 lifecycle. No shortcuts from research to live, including for a
  strategy that is "obviously" fine.
- **Deployment:** blue/green for cold path. For the hot path, flatten, deploy, reconcile, resume —
  never a rolling upgrade with open positions, because a rolling upgrade with open positions means
  two versions of the position logic are live at once.
- **Architecture Decision Records** in `/docs/adr/`. Every deviation from a SHOULD in this
  specification is an ADR with context, decision and consequences. The value is a year later when
  somebody asks why, and the answer is written down instead of reconstructed.

---

## 15. Phased rollout

Each phase is a gate. Automated checks in [Annex F](annex/F-gates.md).

| Phase | Duration | Capital | Exit criteria |
|---|---|---|---|
| 0. Infrastructure | Months 1–3 | $0 | Data pipeline live; quality gates green 30 consecutive days; same-code-path test passing; all §14.3 chaos scenarios passing |
| 1. Research | Months 2–6 | $0 | ≥3 strategies pass full §11.2 including untouched holdout; each with a capacity number and a signed kill-criteria section |
| 2. Paper | Months 5–8 | $0 | 60 days; live-vs-backtest divergence < 15% Sharpe; zero unexplained divergences |
| 3. Micro-live | Months 7–9 | $5k–10k | 30 days; **zero critical incidents; behaviour exactly as specified**; TCA within 20% of model |
| 4. Small live | Months 9–12 | $50k–100k | 90 days; no limit breach; realised costs within 20% of model; drawdown within the §8.2 soft trigger |
| 5. Scale | Month 12+ | Staged | Scale only while marginal Sharpe holds; stop at 25% of capacity (§12.4) |

**[A] Track A timeline:** Phase 0 compressed to months 1–2 by adopting a framework (§3.4), Phase 1
months 2–4 with one strategy rather than three, Phase 2 at 30 days, Phase 3 at $2k–5k. First live
capital around month 5. The gates themselves are not compressed; the scope is.

### 15.1 What a phase gate can and cannot establish

*This is the most important correction in v2.0, because getting it wrong causes the team to draw a
confident conclusion from noise and then scale on it.*

v1.0's Phase 4 exit criterion is "90 days; Sharpe > 1.5 live". **That measurement is not available
in 90 days.** The t-statistic of an observed Sharpe over *T* years is approximately `SR × √T`, so
the time required to distinguish a Sharpe from zero at 95% confidence is `T = (1.96 / SR)²`:

| True Sharpe | Time to establish significance |
|---|---|
| 1.0 | 3.8 years |
| 1.5 | 1.7 years |
| 2.0 | 12 months |
| 2.5 | 7 months |
| 3.0 | 5 months |

Ninety days at a true Sharpe of 1.5 produces a t-statistic of about 0.75. The observed Sharpe over
that window could plausibly land anywhere from −1 to +4, and **both a great quarter and a terrible
quarter are consistent with the same underlying strategy.** Teams that scale on a good quarter and
kill on a bad one are responding to noise in both directions.

So each phase is gated on what it can actually measure:

| Phase | Can establish | Cannot establish |
|---|---|---|
| 3. Micro-live | Correctness. Zero incidents. Fills as modelled. Costs as modelled. | Anything about profitability — at $5k, noise dominates entirely |
| 4. Small live | Cost model accuracy. Absence of catastrophic divergence. Limit discipline. | That Sharpe exceeds 1.5 |
| 5. Scale | Accumulating evidence, quarter by quarter | A verdict before roughly 18 months |

The honest gate for Phase 4 is therefore **"live results are not statistically inconsistent with the
backtest"** — a one-sided test that the live Sharpe is not below the backtest Sharpe by more than
the sampling error would allow ([Annex C §4](annex/C-validation.md)). That is a real test, it can
fail, and it does not pretend to knowledge nobody has at 90 days.

**Do not compress these phases.** The temptation after a good paper-trading month is to skip to
Phase 4. The teams that do this discover their cost model was wrong with real money on the table.

### 15.2 Kill criteria — when to stop and rebuild

- Live Sharpe below 0.5 after 90 days at Phase 4 *(as a trigger to investigate, not a verdict —
  see §15.1)*
- Drawdown exceeding 1.5× the Monte Carlo 5th-percentile expectation. **This one is a verdict.** It
  means the risk model is wrong, and a wrong risk model invalidates every position size in the
  system.
- Live-vs-backtest divergence unexplained within 2 weeks of investigation
- Any single incident causing loss above 5% of equity
- *Added:* realised costs above 1.5× modelled for 30 days — the §11.1 failure, caught in the place
  where it is still cheap
- *Added:* two SEV1 incidents from the same root cause. The first is bad luck; the second means the
  post-mortem process (§10.5) is not working, and that is more dangerous than the incident

---

## 16. Team, budget and the one-person question

### 16.1 Track B team

| Role | Count | Responsibility |
|---|---|---|
| Quant researcher | 2–3 | Strategy development, validation, capacity analysis |
| Systems engineer (Rust/C++) | 2 | Hot path, execution, order book |
| Data engineer | 1–2 | Ingestion, storage, quality |
| Infrastructure / SRE | 1 | Deployment, monitoring, colocation, reliability |
| Risk engineer | 1 | Risk service, limits, kill switches — **reports independently of the trading desk** |
| Compliance / legal | 1 (fractional) | Jurisdictional structuring, tax, reporting |

The risk engineer reporting independently is structural, not bureaucratic. A risk function that
reports to the P&L owner is a risk function that gets overruled on exactly the day it matters.

**Hire the risk engineer first**, before the quant researchers. The ordering is deliberate: it
guarantees the risk layer exists before there is a strategy impatient to trade.

### 16.2 Track A: what one person can actually build

**[A]** v1.0 has no answer for a solo operator, which leaves "do it anyway, smaller" as the implied
advice, and that is how the discipline gets dropped rather than the scope.

What one competent engineer can build in six months:
- Data ingestion for 2 venues, spot + perps, with quality gates
- A backtester with an honest cost model — or, better, NautilusTrader's, calibrated
- One or two strategies, most likely funding carry and a basis or pairs strategy
- A genuine risk service, as a separate process, with real limits and a dead-man switch
- Reconciliation, order FSM, audit log
- Prometheus + Grafana + phone alerts

What one person cannot build, and should therefore not plan a strategy around:
- Market making at competitive latency
- 24/7 human on-call
- Multi-venue arbitrage requiring pre-funded inventory across four venues
- Original research at a rate that outpaces edge decay

**The single-operator risk that dominates all of these is that the operator is asleep, ill, or
travelling.** Design for it rather than around it: automated limits are the whole safety net, so
they are tighter than Track B's, and every ambiguous condition flattens instead of waiting for
judgement. A Track A system that cannot be left alone for 48 hours is not finished.

### 16.3 Budget

| Item | Track B (annual) | Track A (annual) |
|---|---|---|
| People | $1.4m–2.4m | Your time |
| Colocation / compute | $120k–300k | $500–2,400 (Tokyo VPS) |
| Market data | $60k–200k | $0–3,000 (exchange feeds are free) |
| Software / tooling | $40k–80k | $0–1,200 |
| Legal / entity / compliance | $80k–200k | $3,000–15,000 (§18) |
| Audit / security | $30k–60k | $0–2,000 |
| **Total** | **$1.8m–3.2m** | **$6k–24k** |

Track A's budget is small enough that **the dominant cost is opportunity cost**, and the dominant
risk is spending eighteen months on a system that a straightforward carry strategy would have
matched. Set a personal go/no-go date before starting, and write it down next to the §15 gates.

---

## 17. Venue integration

Full detail in [Annex E](annex/E-binance.md). This section covers what shapes the architecture.

### 17.1 Adapter interface

Binance is **one implementation among several from day one**. The adapter interface is defined in
[Annex A §5](annex/A-interfaces.md) and every venue implements it, including the simulator used for
backtesting. If Binance-specific concepts leak above the adapter boundary, multi-venue is not real
and the regulatory hedge in §18 does not exist.

**Test that the abstraction holds by running the full test suite against two venues' testnets.** An
adapter interface with one working implementation is a Binance client with extra indirection.

### 17.2 Environments

| Environment | Base URL | Purpose |
|---|---|---|
| Spot testnet | `https://testnet.binance.vision` | Free, fake money, real API surface |
| Futures testnet | `https://testnet.binancefuture.com` | Perps testing |
| Spot production | `https://api.binance.com` | Live; `api1`–`api4` as alternates |
| Futures production | `https://fapi.binance.com` | USD-M futures |
| Market data WS | `wss://stream.binance.com:9443` | Streams |
| WebSocket API | `wss://ws-api.binance.com:443/ws-api/v3` | Order placement, lower latency than REST |

Spot testnet keys are issued at `testnet.binance.vision` via GitHub login. **Testnet books are thin
and unrealistic — testnet validates correctness, never profitability.** A strategy that is
profitable on testnet has learned to trade a simulator.

### 17.3 Key setup

**Testnet (week 1):** authenticate at `testnet.binance.vision` with GitHub → generate an Ed25519
key pair → store the private key in the signing service → confirm `GET /api/v3/time`, then a signed
`GET /api/v3/account` → place, query and cancel an order end to end.

**Production:** full KYC → 2FA via authenticator app, not SMS → API Management → create an Ed25519
key → enable Spot & Margin and/or Futures, leave **Enable Withdrawals OFF** → restrict to your
Tokyo egress IPs (unrestricted keys' trading permission expires after 90 days; restricted ones
persist) → separate keys per strategy for attribution and blast-radius containment → consider
sub-accounts to isolate strategies and capital.

### 17.4 The details that break bots in production

These cause live failures after a clean backtest. Each one maps to a test in §14.3.

**Signing and time.** Every signed request needs `timestamp` and takes optional `recvWindow`
(default 5000 ms, maximum 60000 ms — the maximum is a hard API limit, and raising it toward that
ceiling to paper over drift replaces a loud failure with a silent one). Clock drift produces
`-1021 Timestamp for this request is outside of the recvWindow`. Run chrony or PTP; resync above
50 ms drift; halt above 100 ms. The signature is over the exact query string in the exact order
sent — reordering breaks it.

**Symbol filters.** Fetch `GET /api/v3/exchangeInfo` at startup and cache. `LOT_SIZE` (quantity a
multiple of `stepSize`), `PRICE_FILTER` (price a multiple of `tickSize`), `MIN_NOTIONAL` (order
value floor), `MAX_NUM_ORDERS`, `PERCENT_PRICE_BY_SIDE` (reject bands around current price).
Rounding wrongly produces `-1013`. **Round quantity down to step size, always** — rounding up can
breach a position limit that the risk layer already approved against the pre-rounding number.
Re-fetch filters daily and on any `-1013`; filters change without notice and a cached filter is a
stale assumption.

**Rate limits.** Weight-based, per IP. Read `X-MBX-USED-WEIGHT-1M` on every response and back off
proactively at 70% of budget (§8.2). HTTP 429 means slow down; **HTTP 418 means you have been
IP-banned for ignoring 429s**. Exponential backoff with jitter; never retry tight. Order limits are
per account and separate from weight limits, so a system can be well inside its weight budget and
still be rejected.

**WebSocket handling.** Connections drop at 24 hours by design — expect it and reconnect cleanly,
with the reconnect path exercised in testing rather than discovered in production. Respond to ping
frames within 10 minutes or be disconnected. The **User Data Stream** requires a `listenKey`, valid
for 60 minutes and extended another 60 by a `PUT`; send the keepalive every 30 minutes so a single
missed request is survivable. Forgetting this is a classic source of silently missed fill
notifications — failure mode #7 in §8.5, and the reason for the independent REST position poll.
Depth stream: maintain the local book with sequence-number validation and resync from the REST
snapshot on any gap.

**Order handling.** Always set `newClientOrderId` — this is the idempotency key.
`-2010 Account has insufficient balance` is usually stale local balance state rather than an actual
shortfall, so treat it as a reconciliation trigger. **A `-1007 TIMEOUT` response does not mean the
order failed.** Execution status is unknown: query before retrying, or double-fill (§9.2, `QUERY`).

**Fees.** Fee tier depends on 30-day volume and BNB holdings; holding BNB gives a 25% spot discount.
At low tiers, taker fees consume most strategy edge. Model your **actual** tier and recompute
strategy viability at each tier you might plausibly reach — including downward, since volume falls
as well as rises.

### 17.5 Live testing sequence

1. **Testnet, 2–4 weeks.** Every order type, every error path. Deliberately induce failures:
   disconnect mid-order, send invalid quantities, blow through rate limits. Verify recovery in every
   case.
2. **Production read-only, 1 week.** Real keys, no trading permission. Validate real feeds, real
   latency, real book depth against testnet assumptions. This step is where testnet's fictions
   surface, and skipping it moves that discovery to step 4.
3. **Production shadow mode, 2–4 weeks.** Full system running, orders generated and logged but not
   sent. Compare theoretical fills against actual market movement.
4. **Micro-live, 30 days, $5k–10k.** Full risk limits active. The question is not "did it make
   money" — at this size noise dominates (§15.1). The question is "did it behave exactly as
   specified, with zero incidents."
5. **Scale per §15.**

---

## 18. Jurisdiction: operating from Nigeria

*This materially affects how the operation is structured, and it has moved since v1.0 was drafted.
Verified against public reporting as of September 2026; re-verify before deploying capital. This is
not legal advice.*

### 18.1 Binance and Nigeria — current state

- Binance discontinued all naira services in March 2024, converting remaining NGN balances to USDT.
  Crypto-to-crypto trading and withdrawals to external wallets continue to function; the consumer
  website is blocked by Nigerian ISPs.
- The **CBN** case over alleged unauthorised operations remains in court. The CBN closed its
  testimony in April 2026 and proceedings continued through mid-2026.
- The **FIRS** tax matter — a claim of roughly $2bn in back taxes for 2022–2023 alongside a much
  larger economic-damages claim — has been in out-of-court settlement discussions, adjourned
  repeatedly through 2026.

### 18.2 What changed since v1.0: the SEC now has a framework

v1.0 says only "engage Nigerian counsel on the SEC's current digital-asset framework". There is now
a specific framework to engage counsel *about*, and knowing its shape changes the structuring
decision:

- The **Investments and Securities Act (ISA) 2025** formally recognises virtual assets as
  securities and names the SEC as the regulator for digital-asset service providers. This ended the
  period of genuine legal ambiguity that preceded it.
- **VASP registration** runs under ISA 2025 plus the SEC's Digital Assets Rules, with requirements
  covering governance, technology risk management, AML/CFT controls, investor protection, capital
  adequacy and reporting. Registration fees are in the region of ₦30m.
- The SEC's **Accelerated Regulatory Incubation Programme (ARIP)** grants preliminary approval in
  principle, allowing operation under supervision ahead of full registration.

**The distinction that determines whether any of this binds you:** these regimes govern *providing
services to third parties* — running an exchange, custody, an offering platform. A proprietary
trading system deploying only its owner's capital is a different activity and is generally not a
VASP. But that boundary is exactly the question to put to counsel in writing, because it is the
difference between a tax question and a licensing question, and it changes the moment anyone else's
money enters the system.

### 18.3 Practical implications

1. **API access is unaffected by the website block.** `api.binance.com` is a separate endpoint from
   `binance.com`, and the infrastructure is in AWS Tokyo regardless (§13.1). The bot never connects
   from Nigeria.
2. **Fiat on/off-ramp must be solved separately.** Capital enters and exits as stablecoin. Use a
   licensed Nigerian ramp, or hold capital offshore entirely.
3. **Structure the entity offshore.** A corporate account in a clear jurisdiction removes the
   personal-exposure question and gives cleaner banking. This is the standard approach for
   Nigeria-based operators running exchange-facing systems.
4. **Multi-venue is a regulatory hedge, not just a technical one.** Build the adapter interface so
   Binance is one implementation among several from day one (§17.1). If Binance access changes, you
   switch venues rather than shut down. This is the single highest-value line in v1.0 and it is why
   §17.1's two-testnet requirement is not pedantry.
5. **Tax treatment of trading profits is a separate question from licensing,** and applies whether
   or not you are a VASP. Settle it before profits exist rather than after.
6. **Engage two counsel in parallel:** Nigerian counsel on ISA 2025 applicability and tax, and
   offshore corporate counsel on structuring. v1.0 lists this at step 6 of its next steps; it
   belongs in parallel with the build because the answer can change the build.

### 18.4 Currency and capital notes

Naira devaluation risk applies to capital held in NGN, not to a USD-denominated book. If your
capital originates in naira, the conversion into stablecoin is itself a trade with timing risk, and
it should be recorded in the books (§12.1) as such rather than treated as a zero-cost boundary.

---

## 19. Honest risk assessment

A document that only describes the path to success is a sales document.

**The edge decays.** Every documented crypto edge has shrunk as competition arrived. Assume any
strategy has a finite lifespan and build the research pipeline to keep producing new ones. A firm is
a strategy factory, not a strategy. **[A]** This is the hardest part of Track A: one person cannot
easily outpace decay, so Track A should favour the slowest-decaying edges (funding carry, basis)
over the fastest (cross-venue arb on majors).

**Costs eat the edge.** The single most common failure: backtest shows 40% annual, live shows −5%,
and the difference is entirely fees and slippage. This is why §11.1 is a hard requirement and why
§9.6 feeds realised costs back into the model continuously.

**Capacity is low.** Most genuine crypto edges work at $100k and stop working at $10m. Know your
capacity before you raise or deploy against an assumed return (§12.4).

**Counterparty risk is real and not diversifiable by strategy.** FTX was profitable to trade on
until it was not. Exchange failure, account freeze or withdrawal suspension can destroy the
operation regardless of trading performance. Hold minimum viable balances on venue, sweep profits
out on a schedule, and enforce the 40% venue concentration limit in §8.2. **This risk is not in the
Sharpe ratio and no amount of trading skill reduces it.**

**Regulatory risk in this jurisdiction is elevated and moving.** See §18. Structure for it rather
than hoping around it.

**Operational risk exceeds strategy risk in the first year.** The list in §8.5 is ranked above
strategy risk for a reason: a strategy that is wrong loses slowly and legibly, while a double-fill
bug or a missed liquidation loses in minutes.

**Most attempts fail.** Well-funded teams with strong engineers fail at this regularly, and they
fail in validation more often than in engineering. The best engineers in the world cannot make an
overfitted backtest profitable — and the specific danger of a strong engineering team is that it
can build something impressive quickly enough to skip the validation discipline that would have
caught the problem.

**The risk this document adds.** A spec this detailed can substitute for judgement. Every gate here
is a floor, not a ceiling, and passing all of them does not make a strategy correct — it makes it
not-yet-known-to-be-wrong. Treat §8 and §11 as the parts that keep you solvent long enough to find
out.

---

## 20. Build order

Dependency-ordered. Each item is buildable once the ones above it exist.

**Phase 0 — foundation**
1. Repository, CI, import-graph checks (§3.5)
2. Event schemas and correlation IDs ([Annex A](annex/A-interfaces.md))
3. Venue adapter interface + **two** implementations (Binance testnet, sim)
4. L1 ingestion, raw archive, normalisation, quality gates (§4)
5. Audit log and replay (§10.4)
6. **Risk service, standing alone, with limits, kill switches and dead-man** (§8) — *before any
   strategy exists*
7. Order FSM, idempotency, reconciliation (§9)
8. Backtester with the §11.1 cost model
9. Trial registry (§11.3) — **before the first backtest runs**
10. Same-code-path test (§14.2) and the chaos suite (§14.3)

**Phase 1 — research**
11. Feature layer + look-ahead audit (§5)
12. Validation harness: walk-forward, purged CV, deflated Sharpe, Monte Carlo (§11.2)
13. First strategy spec written (§6.1) — *before the first strategy is coded*
14. First strategy, validated end to end
15. Portfolio layer once there is more than one strategy (§7)

**Phase 2 onward**
16. Paper trading, 30–60 days
17. Accounting and attribution (§12) — *required before allocation decisions are made*
18. Observability: dashboards, alerts, runbooks (§10, §13.3)
19. Testnet sequence, then production read-only, then shadow (§17.5)
20. Micro-live under full limits

The ordering of items 6 and 9 is the ordering v1.0 recommends in its own next-steps list, and it is
correct for the same reason in both: build the thing that says no before you build the thing that
wants to act, and build the record of your experiments before you start running them.

### 20.1 Immediate next steps

1. **Choose the track** (§0.2) and write down why.
2. Assign or hire the risk engineer first [B], or accept the constraints of §16.2 in writing [A].
3. Stand up data ingestion for Binance, OKX and Bybit — full L2, archived raw.
4. Build the backtester with the §11.1 cost model **before writing a single strategy**.
5. Generate testnet keys and build the venue adapter against testnet.
6. Write the trial registry before running the first backtest.
7. Engage Nigerian and offshore counsel in parallel with the build (§18.3).
8. **Set the §15 gates in writing and agree them with stakeholders before there is money at stake
   and an incentive to move them.**

---

## Annexes

| | |
|---|---|
| [A — Interfaces and event schemas](annex/A-interfaces.md) | Typed messages, latency budgets, order FSM transition table, venue adapter interface, LLM output schema |
| [B — Cost model and sizing arithmetic](annex/B-cost-model.md) | Fees, slippage, impact, queue position, funding carry, maker break-even, risk parity, Kelly, vol targeting |
| [C — Validation arithmetic](annex/C-validation.md) | Deflated Sharpe, purged CV with embargo, Monte Carlo, live-vs-backtest test, power analysis |
| [D — Risk limits and state machines](annex/D-risk.md) | Full limit register, kill-switch state machine, recovery matrix, reconciliation classes |
| [E — Binance integration reference](annex/E-binance.md) | Endpoints, error codes, filters, rate limits, WebSocket lifecycle, checklists |
| [F — Gate checklists](annex/F-gates.md) | Machine-checkable exit criteria per phase |
| [G — What changed from v1.0](annex/G-changes.md) | Every enhancement and correction, with reasoning |

---

*Specification v2.0. Derived from the v1.0 build specification of 14 September 2026, whose framing,
priorities and much of whose text are preserved. Corrections and additions are enumerated in
Annex G. Not investment advice.*
