# Strategy: stat_arb

**Owner:** unassigned
**Status:** research
**Implementation:** `src/tradesys/layers/l3_strategy/stat_arb.py`
**Template:** [SPEC.md §6.1](../../SPEC.md#61-the-strategy-specification--hard-requirement)

> This one was written before the code, which is the order the specification
> requires and which the first strategy did not follow.

---

## 1. Economic rationale

**Who is the counterparty?**
Whoever is moving one leg of the pair for a reason that has nothing to do with
the pair: a large holder rebalancing, a forced liquidation, an index flow, a
listing or delisting. They need to trade one asset in size and do not care that
its usual relationship to another has stretched.

**Why do they trade against me?**
They are paying for immediacy in one name. I sell it to them and hedge with the
other name, so I carry the relationship rather than the direction. That is a
service with a price, and the price is the spread.

**Why does this persist?**
Flow-driven dislocation is a mechanism, not a mispricing. As long as somebody
occasionally has to trade size in a hurry, something has to absorb it, and
absorbing it is compensated.

**What would end it?**
The relationship breaking — and unlike the carry strategy's failure mode, this
one is *expected*. Every pair stops being a pair eventually. The question is
only whether we notice before or after it costs us. Three specific ends:

1. **A structural change in one leg.** A protocol migration, a token swap, a
   delisting. Sudden, and the half-life filter will not catch it because the
   spread is still stationary right up until it is not.
2. **Decay.** More capital finds the same pair; the spread compresses toward
   the cost of trading it. Slow, and visible in falling realised profit per
   round trip.
3. **Regime change in correlation.** The pair holds in calm and breaks in
   stress, which is the worst pattern because backtests are mostly calm.

**This edge decays, and the strategy is built to notice.** That is what the
half-life filter and the rolling re-estimation are for.

## 2. Mechanics

| | |
|---|---|
| Instruments | Two, traded only as a spread and never either one alone |
| Entry | Spread z-score beyond `entry_z`, and half-life within `max_half_life` |
| Exit | Spread z-score back inside `exit_z` |
| Stop | Spread z-score beyond `stop_z`, closed at a loss |
| Holding period | Hours to days, bounded by the half-life filter |
| Hedging | By the estimated ratio, **not by equal notionals** |

The hedge ratio is re-estimated on a rolling window. A ratio that was right
last quarter is a directional position this quarter, and that is how a pairs
book quietly stops being market-neutral.

Both legs are one leg group. A half-filled pair is a directional position, so
it is unwound rather than completed (SPEC §2.1).

## 3. Parameters

Five free parameters. The hard limit is six.

| Name | Range | Chosen | Sensitivity |
|---|---|---|---|
| `entry_z` | 1.5 – 3.0 | 2.0 | Moderate. Wider entries trade less and pay the round trip less often. |
| `exit_z` | 0.0 – 1.0 | 0.5 | Moderate. **Not zero**: waiting for perfect reversion gives back the move and occasionally waits forever. |
| `max_half_life` | 5 – 40 obs | 20 | **High, and it is the important one.** See below. |
| `stop_z` | 3.0 – 6.0 | 4.0 | High in the tail, irrelevant in the body. |
| `base_notional` | any | 1000 | Scales linearly. Not an edge parameter. |

**On `max_half_life`.** This decides whether a pair is tradeable at all. A
spread that reverts over three months is a fact about the world rather than a
strategy: the position has to be financed, hedged and watched for three months
to collect it, and the financing alone will exceed the spread. The filter
refuses those, and it also refuses spreads that are not reverting at all, which
is the answer that matters most.

## 4. Risk profile

**Shape.** Many small wins, occasional large losses. Short volatility, like the
carry strategy, which is why the two must be treated as one correlation cluster
until measured otherwise (SPEC §7.2).

**Where is the tail?**
A pair stops being a pair. The spread widens and keeps widening, and a position
that was mean-reverting becomes a leveraged bet on a relationship that no
longer exists. Averaging in — the natural instinct, since a wider spread looks
like a better entry — converts this from a loss into a catastrophe.

The stop exists because of that instinct. `stop_z` closes the position at a
loss rather than holding it in hope, and it is a hard stop on spread width
rather than a discretionary judgement about whether the relationship still
holds.

**Estimated from the mechanism.** The worst plausible outcome is not the worst
spread in the sample. It is the spread going to a level that implies no
relationship at all, which no calm-period sample contains.

**Correlation to the other live strategy.** Expected low in normal conditions
and **high in stress**, since both are short-volatility. The estimator's use of
the higher of the 20- and 60-day windows is what is supposed to catch that, and
it should be verified rather than assumed.

**Behaviour by regime**, to be filled from the validation run:

| Regime | Expected | Measured |
|---|---|---|
| Bull trending | Weak. Trends break spreads. | — |
| Bear trending | Weak, same reason. | — |
| Chop | Best. Mean reversion is the whole thesis. | — |
| High volatility | Mixed. Wider spreads, wider stops, worse fills. | — |
| Crisis | **Expect the tail here.** Correlations go to one and pairs stop pairing. | — |

## 5. Capacity

**Not yet estimated. Not approved for live capital** (SPEC §1.2).

Expected binding constraint: **book depth on the less liquid leg**. A pairs
trade is only as large as its thinner side, and the thinner side is usually the
one with the dislocation. Borrow availability matters too if the short leg is
spot rather than a perpetual.

## 6. Costs

| | |
|---|---|
| Fee tier assumed | Tier 0, deliberately pessimistic |
| Maker/taker mix | Primary posts, paired leg is maker-preferred with a fallback |
| Round trip | Four fills per round trip, so roughly twice the carry strategy's |
| Slippage | From real depth, worse on the thin leg |
| Borrow | Applies if the short leg is spot |
| Cost as % of gross | **To be measured.** Gate is below 40%. |

**Four fills per round trip is the headline cost fact.** Two legs in, two legs
out. A pairs strategy needs roughly twice the gross edge of a single-leg one to
clear the same cost gate, and the carry strategy already fails that gate at
tier 0. Measure before assuming this one does better.

## 7. Validation results

**None. Nothing in this section has been run.**

Required before `paper`, per SPEC §11.2 and [Annex F](../../annex/F-gates.md).
Two items deserve particular attention for this strategy:

- [ ] **Survivorship.** The universe must include delisted tokens. A pairs
      backtest that only sees survivors never sees the pair that stopped being
      a pair, which is the entire tail.
- [ ] **Regime testing**, with crisis weighted heavily. A pairs strategy that
      works in chop and breaks in stress looks excellent in most samples.
- [ ] Walk-forward, purged cross-validation, deflated Sharpe, probability of
      overfitting, Monte Carlo, parameter sensitivity, cost sensitivity,
      capacity, holdout evaluated once.

## 8. Kill criteria

**Pre-registered. To be signed before go-live.**

| Trigger | Action |
|---|---|
| Live-vs-backtest divergence z below −2.0 over 30 days | Auto-disable |
| Realised half-life exceeds `max_half_life` for 30 days | Retire the pair. The relationship has changed. |
| Two stop-outs on the same pair within 30 days | Retire that pair. Twice is not bad luck. |
| Realised correlation to the carry strategy above 0.8 | Halve the combined allocation; the diversification was not real |
| Drawdown beyond 1.5× the Monte Carlo 5th percentile | **Stop and rebuild.** |

Signed: ______________________  Date: ____________

## 9. Monitoring

- Spread z-score against the entry, exit and stop lines, per pair
- **Rolling half-life against `max_half_life`** — the leading indicator of a
  relationship changing, and it moves before the profit does
- Hedge ratio over time. A drifting ratio is the pair changing shape.
- Leg group break rate. Rising means the legs stopped filling together.
- Realised profit per round trip, for decay
- Correlation against the carry strategy, continuously
