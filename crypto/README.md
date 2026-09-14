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

## Where the build starts

[SPEC.md §20](SPEC.md#20-build-order) is dependency-ordered. The first six items are infrastructure
and the risk service; no strategy is written until item 13. That ordering is deliberate and is the
same advice v1.0 gives: build the thing that says no before the thing that wants to act, and write
down your experiments before you start running them.

Reading time for the full set is around two hours. Section 0, section 8 and Annex G are the hour
best spent if that is all there is.
