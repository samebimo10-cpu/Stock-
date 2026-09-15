# 0004. The hedge leg crosses rather than only resting

**Status:** Accepted
**Relates to:** SPEC §2.1, §7.1.

## Context

Both legs of the carry pair were originally passive, which is the cheap
execution and the obvious choice for a strategy earning basis points per day.

It does not work. A resting bid is not hit in a rising market, so the
perpetual filled, the spot did not, and seven of eight leg groups broke. A
market-neutral pair became a directional short in exactly the conditions that
produce the funding the strategy is there to collect.

## Decision

The primary leg rests. The hedge leg is maker-preferred: it posts at the near
touch and crosses if it has not filled by the fallback deadline.

## Consequences

**Gained:** the pair is actually hedged. Break rate went from 87.5% to zero.

**Accepted, and it is expensive:** measured costs went from roughly a quarter
of gross profit to roughly two thirds, failing the 40% cost gate. Paying the
spread on one leg is the price of being hedged, and the honest conclusion is
that this strategy does not clear its costs at tier 0.

**Learned:** maker entry does not help when the market is trending away, which
is exactly when the hedge is needed. The fallback fires on every order in the
demo scenario. That is a real property of the strategy rather than a defect in
the execution, and it is recorded in the strategy specification.

**Watch:** the taker fallback deadline is a genuine trade-off. Too short and
every order crosses; too long and the hedge is late. It is a parameter, and it
should be measured rather than guessed.
