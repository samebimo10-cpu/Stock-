# Crypto trading system — engineering specification

This directory holds the build specification for an institutional-grade crypto trading system.
It is **documentation, not code**. No bot is built here yet; this is the frame the bot gets built
against.

> Nothing here is investment advice. Capital deployed in a system built to this specification can
> be lost entirely, including through defects in the system itself.

## Start here

**[SPEC.md](SPEC.md)** — the specification. Twenty sections, from targets through to build order.

Read §0 first. It sets two things that determine everything after: the conventions for what is a
gate versus a preference, and **the choice between Track A (1–3 people, $10k–250k) and Track B
(8–12 people, $2m+)**. The tracks are different designs, not different budgets for one design, and
choosing wrongly is expensive in both directions.

## Annexes

| | What it is for |
|---|---|
| [A — Interfaces and event schemas](annex/A-interfaces.md) | The typed message at every layer boundary, latency budgets, the order state machine, the venue adapter interface, the LLM output schema |
| [B — Cost model and sizing](annex/B-cost-model.md) | Fees, slippage from real book depth, market impact, queue position, funding carry break-even, market-making break-even, risk parity, Kelly, volatility targeting |
| [C — Validation arithmetic](annex/C-validation.md) | Deflated Sharpe, probability of backtest overfitting, purged cross-validation, Monte Carlo, the live-vs-backtest test, and how long until a result means anything |
| [D — Risk limits and state machines](annex/D-risk.md) | The limit register, the drawdown ladder, the kill-switch state machine, the recovery matrix, reconciliation discrepancy classes |
| [E — Binance integration](annex/E-binance.md) | Endpoints, error codes and the correct response to each, symbol filters, rate limits, WebSocket lifecycle, testnet checklist |
| [F — Gate checklists](annex/F-gates.md) | Machine-checkable exit criteria for every phase |
| [G — What changed from v1.0](annex/G-changes.md) | Every correction and addition against the source specification, with reasoning |

## Provenance

v2.0 enhances a v1.0 build specification dated 14 September 2026. v1.0's framing, priorities and
much of its text are preserved; [Annex G](annex/G-changes.md) records every change.

The short version of what v2.0 adds:

- **The architecture is complete.** v1.0 drew seven layers and specified three. Features, strategy,
  portfolio and observability now have sections.
- **Contracts instead of adjectives.** Every layer boundary has a typed message and a timeout
  behaviour, so "independently deployable" is a property rather than a claim.
- **Arithmetic where v1.0 gave a name.** Deflated Sharpe, Kelly, funding carry, market impact,
  maker break-even, and the statistical power of each rollout phase.
- **Four numbers corrected**, the most consequential being a maximum-drawdown kill limit set below
  the stated drawdown tolerance.
- **A second track** for a system one person can actually build and, more importantly, can leave
  alone for 48 hours.
- **Books.** Per-strategy profit-and-loss attribution, without which no allocation decision is more
  than an opinion.

## The code

`src/tradesys/` is the Phase 0 foundation, built in the dependency order of
[SPEC.md §20](SPEC.md#20-build-order). It is Track A: Python, one venue adapter
plus a simulator, one strategy.

```
src/tradesys/
  core/         Decimal money, nanosecond timestamps, correlation IDs, the
                Annex A message set, the normalised venue error taxonomy
  adapters/     the only code that knows a venue exists
                base.py  the interface + filter rounding
                sim.py   deterministic simulator with fault injection
                binance.py  signing, filters, error mapping, listenKey, sequencing
  layers/
    l1_data/         local order book, sequence gaps, the eight quality gates
    l2_features/     pure features, versioned by content hash, look-ahead audit
    l3_strategy/     the strategy contract and funding carry
    l4_portfolio/    netting, correlation on short samples, risk parity
    l5_risk/         limits, the thirteen ordered checks, kill switches, sizing
    l6_execution/    order state machine, reconciliation, TCA, startup gate
    l7_observability/ hash-chained audit log, alert taxonomy
  research/     cost model, trial registry, validation arithmetic, backtester
  pipeline.py   the one path, used by backtest and live alike
  demo.py       a runnable scenario
risk/limits.yaml   the limit register, loaded with bounds validation
```

### Run it

```bash
cd crypto
pip install -e ".[dev]"

python -m pytest -q                              # 200 tests
python -m pytest --doctest-modules src/tradesys -q
tradesys selfcheck                               # the machine-checkable Phase 0 gates
tradesys demo                                    # funding carry through the live pipeline
```

### What the code enforces rather than describes

Each of these is a specification rule that would otherwise be an intention.
Every one has a test that fails when it is broken.

| Rule | Where | How it is enforced |
|---|---|---|
| Strategies cannot reach a venue | SPEC §3.5 | An import-graph test. `l3_strategy` may not import `adapters`. |
| Risk cannot depend on strategies | SPEC §3.5 | The same test, in the other direction. |
| A timeout is not a rejection | SPEC §9.2 | The order state machine has no transition out of `QUERY` except resolution by the venue, so an order of unknown state can never place another. |
| Absence of approval is not approval | SPEC §8.3 | The executor refuses a `None` risk decision by name. |
| Risk reduces or refuses, never enlarges | SPEC §8.2 | Asserted in the service and re-checked in the executor, with a property test over generated sizes. |
| A misplaced decimal must not load | SPEC §8.5 | Every limit declares a range; out-of-range fails at load, and the drawdown ladder must be ordered. |
| Same code path for backtest and live | SPEC §14.2 | One `Pipeline`. A differential test replays a recorded session and demands identical decisions, plus a negative control that proves the comparison can fail. |
| A backtest must register its trial | SPEC §11.3 | The backtester refuses to construct without a registry. Abandoned and crashed runs still count. |
| Losing the audit path halts trading | SPEC §3.3 | The log buffers, then raises, then reports that trading must stop. |
| Look-ahead bias is detected, not reviewed for | SPEC §5.4 | A causality check that catches full-sample normalisation, and a lag check for point features. |

### Three things the build changed about the spec

Writing the code found three places where the specification is degenerate at
small scale. All three are corrected in the code with the reasoning recorded
at the point of the fix, and they are the kind of thing only an implementation
surfaces.

1. **The 25% single-asset concentration limit makes the first trade
   impossible.** One position is 100% of a one-position book. Measured against
   `max(gross book, equity)` instead, the rule keeps its intent and a small
   book can still open a position.
2. **The 40% per-strategy weight cap is infeasible below three strategies.**
   Two strategies cannot both sit under 40% of a budget summing to 100%. The
   allocator relaxes the cap to equal weight and reports that it did, because
   the real constraint is "you do not have enough strategies".
3. **The default carry holding limit sat exactly at break-even.** Thirty
   funding intervals is precisely what tier-0 fees need at baseline funding, so
   the default admitted a trade with zero expected profit. It is 21 now.

## Where the build starts

[SPEC.md §20](SPEC.md#20-build-order) is dependency-ordered. The first six items are infrastructure
and the risk service; no strategy is written until item 13. That ordering is deliberate and is the
same advice v1.0 gives: build the thing that says no before the thing that wants to act, and write
down your experiments before you start running them.

Reading time for the full set is around two hours. Section 0, section 8 and Annex G are the hour
best spent if that is all there is.
