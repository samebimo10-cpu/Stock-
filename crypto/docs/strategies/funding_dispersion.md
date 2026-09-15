# Strategy specification: cross-venue funding dispersion

**Status:** research. Never run against real data.
**Strategy ID:** `funding_dispersion`
**Code:** [`src/tradesys/layers/l3_strategy/funding_dispersion.py`](../../src/tradesys/layers/l3_strategy/funding_dispersion.py)

## 1. The claim

Two venues list the same perpetual and pay different funding. Short the one
paying, long the one receiving, and collect the difference.

## 2. Why it is better than the hedged carry

The carry strategy collects the funding **level**: 0.01% per eight hours at
baseline, against a 0.20% round trip, which needs twenty days to break even.
This collects the **differential**, which is routinely several times either
venue's level, because each venue clears its own order flow and its own crowd.

The position is delta-neutral by construction rather than by a hedge that has
to be chased — both legs are the same instrument.

## 3. What it costs instead

Not a free lunch, and each of these is real:

1. **Two venues means two of everything** — keys, withdrawal paths,
   counterparties. Venue risk stops being diversifiable and becomes the
   dominant risk.
2. **Capital is split**, so gross exposure is double the net position for the
   same economic exposure, and the gross exposure limit binds sooner.
3. **Convergence is not guaranteed.** Dispersion persists *because* moving
   collateral between venues is slow and risky. We are paid for that, which
   means we are carrying it.
4. **The unwinder is load-bearing.** Legs on two venues that fill
   asymmetrically leave a naked perpetual.

## 4. The claim that was wrong

The first version of this file argued that both legs could rest, because
neither is chasing the other's price, and therefore that the strategy avoided
the taker cost that hurts the hedged carry.

**Running it falsified that within one scenario.** The two legs are on opposite
*sides* — one buying, one selling — and in a rising market a resting buy does
not fill while a resting sell does. The taker fallback fired on the buy leg
every time.

The lesson generalises and is worth more than the strategy:
**delta-neutrality protects the position, not the entry.** Legging into a
neutral position in a trending market has the same problem as legging into a
hedge, because the problem was never net exposure — it was one side of a
two-sided order pair being on the wrong side of a moving price. ADR 0004 found
this for the hedged carry; ADR 0007 records that it generalises.

Consequences, all of them corrections rather than tuning:

- The cost model now says **one crossing leg**: 0.17% per round trip, not 0.10%.
- The entry threshold was **re-derived from the corrected cost**: 0.07% per
  interval, up from 0.05%.
- The expected trip count **fell from 26 a year to 10**, because a 0.07%
  differential is rarer than a 0.05% one.
- The honest annual upper bound is therefore **about 4%**, not 7%.

## 5. Why it still clears the gate

| | |
|---|---|
| Fills per round trip | 4 (two legs, in and out) |
| Legs that cross | 1 |
| Round-trip cost at tier 0 | 0.17% of notional |
| Expected gross per trade | 0.54% |
| **Cost share of gross** | **31.3%** against a 40% gate |

It clears with margin, and the margin is thin. A fee-tier change or a wider
spread regime moves it materially, which is exactly what SPEC §11.2's cost
sensitivity test is for.

## 6. Rules

**Entry.** Differential above 0.07% per interval, both venues' rates observed
within one interval of each other, and the break-even check passing: the spread
must cover the round trip inside the maximum hold.

**Sizing.** Equal notional per leg. Both maker-preferred — one will cross
anyway, but in a flat market both rest and the trade costs half as much.
Marking them aggressive would pay the spread even when unnecessary, which is
paying for the bad case in the good one.

**Exit.** Differential converging back inside 0.01% per interval, or twelve
intervals elapsed — dispersion mean-reverts faster than the level does, because
anyone who can move collateral arbitrages it.

## 7. Measured

`tradesys strategies`, against a synthetic scenario where the differential
widens and closes **while price trends throughout** — the condition that broke
the hedged carry:

| | |
|---|---|
| Round trips | 4 |
| Gross / net | 9.31 / 5.94 |
| **Cost share** | **36.2%** against a predicted 31.3% |

The first run of this measured **64%**, and the cause was not the spread. The
taker fallback was set to one funding interval, so the second leg crossed eight
hours late and price drift was charged as though it were spread. **A two-leg
trade's second leg must be on within minutes of the first**, because the cost
of arriving late is drift, and drift over eight hours dwarfs any spread.

## 8. Kill criteria

1. Hit rate below 50% over 20 trades (specified as 70%).
2. Any trade where one leg filled and the other did not within the leg timeout,
   more than twice in 20 trades — the unwinder working is not the same as the
   execution working.
3. Realised cost share above 45% over 20 trades.
4. Either venue's withdrawal or transfer path unavailable for more than 24h.

## 9. Before any capital

As the other two, plus: **this needs two production venues**, which doubles the
key-management surface and the reconciliation load, and it needs the §17.5
ladder run on both independently before either is trusted with the pair.
