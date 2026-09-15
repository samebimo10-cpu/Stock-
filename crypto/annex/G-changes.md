# Annex G — What changed from v1.0, and why

The v1.0 build specification of 14 September 2026 is the frame for [SPEC.md](../SPEC.md). This annex
records every substantive change so the reasoning is auditable rather than assumed.

Three categories: **corrections** (v1.0 was wrong or internally inconsistent), **structural gaps**
(v1.0 promised a thing it did not specify), and **additions** (material v1.0 omits entirely). A
fourth section records what was deliberately kept unchanged, which matters as much.

---

## 1. Corrections

### 1.1 Max drawdown: 15% kill limit under a 20% target

**v1.0:** §1.1 sets a max-drawdown target of "< 20%"; §6.2 sets a max-drawdown limit of 15% with
action "full stop, strategy revalidation required".

**Problem.** The kill limit sits *below* the stated tolerance, so the system stops permanently while
still inside the range it declared acceptable. There is no space between "this is fine" and "this is
over", and no intermediate response at all.

**v2.0** (SPEC §8.2, Annex D §1.1): a ladder — amber at 6%, soft trigger at 8% halving allocations,
hard stop at 12%, with 20% retained as the tolerance describing the outcome *including the
reaction*. The hard stop is tightened rather than loosened, because the point of acting at 8% is to
make 12% rare.

### 1.2 The Sharpe > 4.0 overfitting rule

**v1.0:** §1.3 makes "any strategy whose backtest Sharpe exceeds 4.0" an explicit non-goal.

**Problem.** Sharpe scales with the square root of independent bets per year. The rule is sound for
the multi-day directional strategies v1.0 mostly discusses and simply wrong for the high-frequency
strategies v1.0 also recommends — a genuine cross-venue arbitrage or market-making strategy can
exceed Sharpe 4.0 without any overfitting. Applied universally, the rule discards real results.

**v2.0** (SPEC §1.4): thresholds by strategy class and holding period, from 2.5 for directional to
8.0 for market making. The rule that does generalise replaces it: **the backtest must contain a
losing month.**

### 1.3 "90 days; Sharpe > 1.5 live" as a phase gate

**v1.0:** §9, Phase 4 exit criteria.

**Problem.** That measurement is not available at 90 days. The t-statistic of an observed Sharpe
over `T` years is about `SR × √T`; at SR 1.5 over 0.25 years, `t ≈ 0.75`. The observed value could
plausibly land anywhere from −1 to +4 with the strategy unchanged. A gate on it scales on noise in
one direction and kills on noise in the other.

**v2.0** (SPEC §15.1, Annex C §5): every gate is re-specified in terms of what its duration can
actually establish. Phase 4 gates on **consistency with the backtest** (a one-sided z-test that can
genuinely fail) plus cost accuracy and limit discipline. Sharpe is recorded and explicitly not
gated. A table of time-to-significance by Sharpe is included so the point cannot be forgotten.

### 1.4 Colocation described as "a 100–300 ms improvement"

**v1.0:** §8.1.

**Problem.** Stated without a baseline, and without saying which strategies the improvement is worth
anything to. It reads as an instruction to spend the money in month 1.

**v2.0** (SPEC §13.1): concrete RTT figures for Tokyo, Europe and Nigeria, plus the decision rule —
colocation is decisive for market making and close to irrelevant for funding carry, where entry
tolerance is measured in seconds. Track A gets an in-region Tokyo VPS at $40/month, which removes
the 300 ms and the route instability, and defers dedicated hardware until a strategy's economics
demand it.

### 1.5 Research labelled "Layer 2"

**v1.0:** §5 is titled "Layer 2 — Research and backtesting" while the architecture diagram already
assigns L2 to features.

**Problem.** Beyond the collision, it invites someone to place research in the live request path.
Research has different availability requirements and must never share a database connection with
the trading system.

**v2.0** (SPEC §3.1, §11): research is an *environment* that replays L1–L6 offline, drawn outside
the layer stack. L2 is restored to features.

### 1.6 listenKey keepalive "every 30 minutes"

**v1.0:** §11.4 states the User Data Stream listenKey is "kept alive with a PUT every 30 minutes".

**Problem.** The cadence is right as a safety margin, but v1.0 does not state the underlying
validity, so an implementer cannot reason about what happens when one keepalive fails.

**v2.0** (SPEC §17.4, Annex E §6.2): the key is valid for **60 minutes** and a PUT extends it by
another 60; keepalive at 30 minutes so a single failed request is survivable. Adds the requirement
to fetch a **fresh** key on reconnect, and the independent REST reconciliation poll that detects a
stream which is connected and silent.

### 1.7 Fractional Kelly applied to every strategy class

**v1.0:** §6.1 prescribes 0.25× Kelly plus volatility targeting across the board.

**Problem.** Kelly is meaningless for market making, where you quote both sides and size comes from
inventory, and actively dangerous for fat-tailed strategies such as liquidation positioning, where
it sizes to ruin. v1.0 recommends both strategies.

**v2.0** (SPEC §8.1, Annex B §7): one sizing rule per class — fractional Kelly for directional and
stat-arb, inventory-based for market making, conditional-loss (CVaR) for fat-tailed. Adds the
requirement that Kelly uses the **lower bound of the 95% CI on edge**, not the point estimate, and a
mandatory volatility floor, without which the formula sizes to infinity as realised volatility
approaches zero.

---

## 2. Structural gaps filled

### 2.1 Four of seven layers were never specified

**v1.0** draws a seven-layer architecture and writes sections for L1 (data), L5 (risk) and L6
(execution). **L2 features, L3 strategy, L4 portfolio and L7 observability have no sections at
all** — which is notable because L7 is where you find out whether any of it is working.

**v2.0** adds: §5 (features, including the look-ahead audit that makes point-in-time correctness
testable), §6 (strategy, including the mandatory strategy-spec template), §7 (portfolio, including
risk-parity mechanics, correlation estimation on short samples, and netting), §10 (observability,
including SLIs, a three-level alert taxonomy, dashboards and the incident process).

### 2.2 "Independently testable and independently deployable" with no interfaces

**v1.0** §3 claims each layer is independently testable and deployable, then describes no boundary
in typed terms. Without contracts, teams invent their own and the layers stop being independent.

**v2.0**: [Annex A](A-interfaces.md) specifies every message, its schema version, its latency budget
and its timeout behaviour. The load-bearing one: **absence of a `RiskDecision` is a reject**, never
an approval.

### 2.3 "Full order lifecycle state machine" with no states

**v1.0** §7.1 requires "full order lifecycle state machine with timeout handling at every state" and
lists no states.

**v2.0** (SPEC §9.2, Annex A §4.3): the full transition table, with `QUERY` as an explicit trap
state. `QUERY` is the state most often missing in real systems, and its absence is what turns a
`-1007` timeout into a double fill — which v1.0 correctly names as the number one failure mode
while omitting the mechanism that prevents it.

### 2.4 "Reconcile continuously" as an algorithm

**v1.0** §3 rule 4 and §7.2 require continuous reconciliation without specifying what a discrepancy
is or what to do with each kind.

**v2.0** (SPEC §9.4, Annex D §4): six discrepancy classes with per-class actions. The important
rule: **`MISSING_LOCAL` is never auto-adopted** — finding a position you cannot explain is a reason
to halt, not to start managing it.

### 2.5 Kill switches with no way back

**v1.0** §6.3 specifies automated triggers, a manual switch and a dead-man's switch, and says
nothing about returning to trading.

**Why it matters:** a kill switch with no defined recovery path gets bypassed rather than reset,
typically by one tired person during the incident.

**v2.0** (SPEC §8.4, Annex D §3): a recovery matrix for every trigger. Transient, externally
verifiable conditions recover automatically; conditions implying the system's model of reality is
wrong require a human, and the most serious require two.

### 2.6 "The LLM never has direct order-placement authority" as a mechanism

**v1.0** §2.3 states the rule and says outputs are "schema-validated and bounds-checked".

**v2.0** (SPEC §2.3, Annex A §6): the actual schema, the bounds table, the rate limit, and the
asymmetry that enforces the rule — `strategy_adjustments` is capped at **1.0**, so the model can
halve an allocation but cannot raise one. Raising requires the quantitative optimiser. Plus the test
that proves it: switch the LLM off in staging and confirm the system trades on.

### 2.7 "Same code path for backtest, paper and live" as a verified property

**v1.0** §3 rule 2 asserts it. Nothing checks it, so it remains an intention.

**v2.0** (SPEC §14.2): a nightly differential test that replays a recorded live session through the
backtester and asserts identical decisions in identical order. Divergence is a P1 and invalidates
backtest results until resolved. This is the single most valuable test in the document, because the
failure it catches — a backtest that measured different software from the one holding positions —
is both common and expensive.

### 2.8 Data-quality gates with no thresholds

**v1.0** §4.3 names the checks: gap count, duplicate rate, crossed books, latency percentiles,
staleness.

**v2.0** (SPEC §4.4): numeric green/amber/red thresholds for eight checks, an escalation rule (three
consecutive ambers become red), and the observation that a red condition read in real time is a
kill-switch trigger rather than only a research exclusion.

---

## 3. Additions

| Addition | Where | Why it is not optional |
|---|---|---|
| **Track A: the small-capital, one-to-three-person system** | SPEC §0.2, §16.2 | v1.0 assumes 8–12 people and $1.8m–3.2m/year. With no smaller design specified, a solo reader runs v1.0 with the scope intact and the discipline dropped, which is the wrong half to drop. Track A drops scope instead: no market making, no 24/7 on-call, slower edges, tighter automated limits. |
| **Accounting, PnL attribution and capacity** | SPEC §12 | v1.0 has no books. Without per-strategy attribution you cannot answer "which strategy is making money", which makes the portfolio layer decorative and every allocation an opinion. |
| **Capacity as a hard gate** | SPEC §1.2, §12.4 | v1.0 lists capacity as a primary metric and never requires it before go-live. You cannot size an allocation against an unknown ceiling. |
| **Testing and change management** | SPEC §14 | v1.0 lists chaos scenarios under operations and never defines what "tested" means. Adds the test pyramid, the same-code-path test, the chaos suite, ADRs, and deployment rules. |
| **Four more failure modes** | SPEC §8.5 items 7–10 | Silent fill loss via listenKey expiry, stale-balance reject loops, clock drift, partial-fill orphans. Each has caused documented production losses and each is invisible in a backtest. |
| **Four more risk limits** | SPEC §8.2 | Venue concentration (counterparty risk), liquidation distance (margin death), single-order notional (fat-finger), consecutive rejects (desync loops). v1.0's failure-mode list names these dangers; its limit table does not constrain them. |
| **Three more cost-model components** | SPEC §11.1 | Fee-tier decay, adverse selection on maker fills, funding paid on the inverted side. Each silently inflates backtest results. |
| **Three more validation steps** | SPEC §11.2 items 8–10 | Cost sensitivity at 1.5× and 2×, data-quality sensitivity excluding amber days, and a human check that someone can name the counterparty. |
| **Deflated Sharpe and PBO as arithmetic** | Annex C §2 | v1.0 names deflated Sharpe; the formula, the trial-count source and the DSR > 0.95 gate were missing. |
| **Funding-carry break-even arithmetic** | Annex B §4 | The headline "8–25% APY" is not the strategy. At tier-0 fees and baseline funding, break-even requires a **ten-day hold** — which changes the strategy's design, not just its returns. |
| **Market-making break-even arithmetic** | Annex B §5.1 | Makes v1.0's "below VIP 4, rebates rarely cover adverse selection" quantitative: at tier 0 the trade is roughly −5 bp per round trip before any skill is applied. This is why Track A does not build it. |
| **Signing service** | SPEC §13.2 | v1.0 says the private key never leaves the signing service without specifying one. Adds the endpoint allowlist, so a withdrawal request is refused at the signer even if a key somehow carried the permission. |
| **Two-person rule made technical** | SPEC §13.2 | v1.0 states the rule as policy. A policy enforced by memory is not enforced: the risk service refuses a config whose signature chain lacks two distinct signers, and Track A substitutes a mandatory 24-hour delay. |
| **Repository layout with enforced import rules** | SPEC §3.5 | Makes "risk is a separate service" checkable in CI: strategies cannot import adapters, risk cannot import strategies. |
| **Machine-checkable gates** | Annex F | v1.0's gates are prose, and prose gates get waived under pressure. |
| **Nigeria: ISA 2025 and the SEC VASP regime** | SPEC §18 | v1.0 says "engage counsel on the SEC's current framework". There is now a specific framework: virtual assets recognised as securities, SEC as regulator, VASP registration, the ARIP incubation route. Adds the distinction that decides whether any of it binds a proprietary trader: these regimes govern *providing services to third parties*. |
| **Correlation estimation on short samples** | SPEC §7.2 | v1.0 gives the 0.6 threshold without saying how to estimate the number. Adds shrinkage, a 60-observation minimum with a pessimistic 0.5 prior below it, and the max of the 20-day and 60-day estimates, since correlations rise in stress. |
| **Netting** | SPEC §7.3 | Removes 20–40% of gross turnover on a multi-strategy book, which is the difference between the cost ratio passing and failing. |
| **The `degraded` strategy state** | SPEC §6.3 | Without a middle state, every problem is a binary between ignoring it and switching the strategy off, and teams choose ignoring. |
| **Incident severities and post-mortems** | SPEC §10.5 | Every SEV1/SEV2 post-mortem must contain a new automated test. This is how the failure-mode list grows from experience instead of staying fixed at ten. |

---

## 4. Kept unchanged, deliberately

Some of v1.0 is better than what would replace it, and is preserved close to verbatim:

- **The three-goals framing** (SPEC §1.1). It is the most valuable paragraph in v1.0 and it settles
  the architecture before any technical decision is made.
- **"Risk is a separate service, not a module inside the strategy."** v2.0 only adds the mechanism
  that makes it structurally true.
- **The 30% cost-model heuristic** — if modelling costs properly does not cut returns by at least
  30%, the model is wrong. The single best sanity check in the document.
- **Tier 1 / Tier 2 / Tier 3 edge classification** and the honest placement of the LLM in Tier 3.
- **The six original failure modes** (SPEC §8.5 items 1–6), ranked above strategy risk. Correct, and
  correctly prioritised.
- **The validation protocol's seven steps** (SPEC §11.2 items 1–7), including the locked-away
  holdout and the refusal to re-tune after a holdout failure. v2.0 adds only the technical
  enforcement, because discipline that depends on remembering to be disciplined is not discipline.
- **"Do not compress these phases."**
- **§12's honest risk assessment.** Its last point — that a strong engineering team is specifically
  dangerous because it can build something impressive fast enough to skip validation — is the
  sentence most worth re-reading before Phase 3.
- **The instruction to hire the risk engineer first.**

---

## 4a. Corrections the implementation found

v2.0 was written before the code. Building the Phase 0 foundation in
`src/tradesys/` surfaced three places where a limit is degenerate at small
scale - each one a rule that reads correctly and cannot be satisfied by the
book it would first apply to. They are corrected in the code, with the
reasoning recorded at the point of the fix, and noted here because they are
the class of defect only an implementation finds.

### 4a.1 The 25% single-asset concentration limit blocks the first trade

**The rule** (SPEC §8.2): single-asset concentration above 25% of the book is
rejected.

**The problem.** One position is 100% of a one-position book. Measured purely
on gross, the limit rejects every opening order, and the system can never take
its first position - not as an edge case but as the normal path from a flat
start.

**The fix.** Measure against `max(gross book, equity)`. A $600 position against
$100k of equity is 0.6% and passes; a book that has grown past its equity is
measured on gross as intended. The rule keeps its meaning - do not let one
asset dominate - and stops being unsatisfiable at the moment it first applies.

### 4a.2 The 40% per-strategy weight cap is infeasible below three strategies

**The rule** (SPEC §7.1): no strategy above 40% of risk budget.

**The problem.** Two strategies cannot both sit below 40% of a budget that must
sum to 100%. The cap assumes the 5-10 strategy book §2.4 recommends, and Track
A explicitly runs two or three. As written it makes the allocator unsolvable
for the track this document added.

**The fix.** The allocator relaxes the cap to equal weight when the book is too
small for it, and **reports that it relaxed it**. Concentration on a
two-strategy book is forced rather than chosen, and the binding constraint is
"you do not have enough strategies" - a portfolio problem, not a solver
problem, and one the operator should see rather than have smoothed over.

### 4a.3 The carry strategy's default holding limit sat exactly at break-even

**The problem.** Annex B §4.2 establishes that tier-0 fees at baseline funding
need thirty funding intervals to break even. A maximum holding period of
thirty intervals therefore admits a trade with exactly zero expected profit,
which is the worst possible default: it looks like a considered number and it
authorises trading for nothing.

**The fix.** 21 intervals, seven days, which leaves the margin that makes the
check worth having. The general point is worth keeping: **a threshold set
equal to a break-even is not a threshold.**

### 4a.4 The delta that triggers a resync must not be discarded

**The problem.** Annex E §6.1 says "on any gap: discard, resync from a REST
snapshot". Read literally — and it was implemented literally — that discards
the delta that revealed the gap as well as the book. The snapshot is then one
update behind, the next delta reports a gap of its own, and that resync leaves
another hole. The loop gets tighter the busier the market is, which is to say
it arrives precisely when it does the most damage.

**The fix.** The triggering delta is re-offered to the sequencer after the
snapshot and applied if it is now contiguous, which is Binance's own documented
procedure (buffer, snapshot, apply the first delta whose range spans the
snapshot's last update id). Annex E §6.1 now says so explicitly.

### 4a.5 A cold start is not a sequence gap

**The problem.** The first depth delta on any connection has nothing to apply
itself to, so the gap detector fired on it. `sequence_gaps` would therefore
have incremented once per connection, including every healthy 23-hour rotation
— and a counter that increments when nothing is wrong cannot be alerted on,
which was the only reason it existed.

**The fix.** A cold start resyncs like a gap but is not counted as one. The
resulting snapshot is still marked `resync_in_progress`, because it is still
not research-grade data; it is simply not an incident.

**The general point:** a health metric that moves during normal operation is
not a health metric.

---

---

## 5. One thing v2.0 does not fix

v1.0's §12 warns that most attempts fail, and that they fail in validation more often than in
engineering. **Nothing in v2.0 changes that base rate.** A more complete specification reduces the
chance of failing for a reason someone already knew about; it does not make the edge real, and it
cannot make an overfitted backtest profitable.

The specific risk this version adds is that a document this detailed can substitute for judgement.
Every gate here is a floor, not a ceiling. Passing all of them does not make a strategy correct — it
makes it not yet known to be wrong.
