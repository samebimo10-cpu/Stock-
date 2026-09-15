# Strategy specification: liquidation cascade reversion

**Status:** research. Never run against real data.
**Strategy ID:** `cascade`
**Code:** [`src/tradesys/layers/l3_strategy/cascade.py`](../../src/tradesys/layers/l3_strategy/cascade.py)

## 1. The claim

When a liquidation cascade runs, price overshoots. Buy the overshoot once the
forced selling has stopped and price has turned.

## 2. Why it might be real

A liquidation is the one order in the book placed by someone with no opinion
about the price. When enough arrive at once, the resulting price is not a view
about value — it is a queue of margin calls clearing against whatever depth
remains. It stops when the positions are gone, not when the price is right.

This is a **liquidity premium**, not a forecast: we are paid to supply the
depth that vanished, in the seconds when supplying it feels worst. That is why
it can persist while being entirely public.

## 3. Why it pairs with trend

One buys strength, the other buys collapse. Their correlation is structurally
negative in exactly the moments that matter — the week trend has its worst day
is a week this has its best. SPEC §7.2 insists correlation be estimated on
daily strategy P&L rather than on assets, because two strategies on the same
symbol can be uncorrelated and two on different symbols can be identical. These
two are the first kind, by construction rather than by estimate.

## 4. Why it clears the cost gate

| | |
|---|---|
| Fills per round trip | 2 |
| Legs that cross | 1 — on purpose, see §5 |
| Round-trip cost at tier 0 | 0.12% of notional |
| Expected gross per trade | 0.66% (62% × 1.8% − 38% × 1.2%) |
| **Cost share of gross** | **18.2%** against a 40% gate |

Rare — a handful of real cascades a month — which caps capacity but not the
ratio, and the ratio is what the gate measures.

## 5. Rules

**Entry**, all four required:

1. `cascade_pressure` peaked above 0.35 — forced flow at 35% of ordinary volume
   over the same window. 0.05 is a Tuesday.
2. Pressure has decayed to half its peak or less.
3. **Price has retraced off the extreme** by at least an eighth of the
   cascade's depth. See §7 — this is the condition whose absence lost money.
4. There is still room to the target.

**Execution: aggressive, and this is the one strategy where paying the spread
is right rather than lazy.** The premise is that liquidity vanished for a few
seconds; an order that waits for a better price waits for the dislocation to
close, which is the event it was supposed to profit from.

**Exit**, checked in this order:

1. **Stop** — half the cascade's depth beyond its extreme. Absolute: a stop
   that can be talked out of is not a stop.
2. **Target** — half the depth back from the extreme. Not the whole way: the
   last third of a reversion is slow and thin and is where the edge is worst.
3. **Time stop** — if it has not reverted within the window, the premise was
   wrong. This was information, and information does not revert.

Everything is scaled to the **cascade's own depth** rather than to ATR. See §7.

## 6. Measured

`tradesys strategies`, against a synthetic calm-cascade-recovery scenario:

| | |
|---|---|
| Round trips | 1 |
| Gross / net | 26.47 / 25.86 |
| **Cost share** | **2.3%** against a predicted 18.2% |

**One trade. The measurement establishes that the machinery works and nothing
else** — you cannot infer a hit rate from a single observation, and the 2.3%
is better than predicted only because that one trade happened to work.

## 7. What the build found

Three failures, in order, each a real design fault rather than a typo.

**The episode was forgotten at the moment it became tradeable.** The entry
condition is "pressure has decayed from its peak", and the first version reset
the peak as soon as pressure fell — destroying the state the entry needed at
exactly the moment it needed it. It never entered a single cascade. The
episode now survives quiet observations for a grace period equal to the maximum
hold.

**It entered while the cascade was still falling.** With flow decay as the only
condition, it bought three times during a collapse, was stopped three times,
and *lost money in a scenario that recovered 60% of the drop*. Flow decay is
necessary and it is not sufficient: the confirmation is a retracement that has
actually begun. Waiting costs part of the move, and it is the difference
between fading a dislocation and catching a knife.

**An ATR-scaled stop assumes evenly spaced observations, and a cascade is
precisely when they are not.** Events arrive seconds apart during one and hours
apart around it, so the range estimate is a blend of two time scales and the
stop it produces is meaningless. Everything is now scaled to the cascade's own
depth, which is the one scale that is certainly right because it is the thing
being faded.

A fourth was in the scenario rather than the strategy: the first version spaced
the cascade at one liquidation per hour, so each fell outside the next one's
measurement window and pressure never accumulated. **A scenario whose
resolution is coarser than the mechanism it tests measures the scenario.**

## 8. Risk profile

- **Losses are fast and correlated with everything.** A cascade that does not
  revert is usually a cascade with news behind it, and that is the same moment
  every other long position is hurting.
- **Capacity is small.** Depth has vanished, which is the premise; size is
  limited by the book we are buying into.
- **Worst case is a cascade that is the first leg of a crash.** The stop and
  the time stop are both aimed at that, and neither makes it pleasant.

## 9. Kill criteria

1. Hit rate below 45% over 30 trades (specified as 62%).
2. Average loser more than 1.5× the average winner over 30 trades.
3. More than 3 consecutive stops.
4. Any trade where the stop was not honoured — a defect, not a loss.

## 10. Before any capital

As §10 of the trend specification. The liquidation stream (`forceOrder`) must
be archived for months before any of this can be tested honestly, and the
scenario in §6 tests the code, not the edge.
