# 0007. A two-leg trade's cost is drift, not spread

**Status:** Accepted
**Supersedes nothing. Generalises:** [0004](0004-hedge-crosses.md).
**Relates to:** SPEC §7.1, §11.1.

## Context

ADR 0004 recorded that the hedge leg of the carry pair must cross the spread,
because a resting bid is not hit in a rising market. It framed the cost as the
spread paid on one leg, and concluded that hedged carry does not clear its
costs at tier 0.

Building the funding dispersion strategy tested that framing, because
dispersion was supposed to escape it: both legs are the same instrument, so the
position is delta-neutral by construction and there is no hedge to chase. Both
legs could therefore rest.

They could not. The two legs are on opposite *sides*, and in a rising market a
resting buy does not fill while a resting sell does. The fallback fired on the
buy leg every time.

More importantly, the measured cost was far larger than any spread. At an
eight-hour fallback deadline the strategy spent 64% of gross on costs; at a
one-hour deadline, on identical data, it spent 36%. The spread did not change.
What changed was how long the second leg spent waiting while price moved.

## Decision

The cost of legging into a multi-leg position is **price drift between the
first fill and the last**, and the spread is a second-order term.

Therefore:

- Every multi-leg strategy sets its taker fallback in **minutes**, sized
  against the instrument's drift, not against the strategy's own cadence.
  Deriving it from the funding interval — which is what "one interval" meant —
  is deriving an execution parameter from an economic one.
- Cost models for multi-leg strategies count one crossing leg. Claiming zero
  requires an argument about why neither side is ever on the wrong side of a
  moving price, and delta-neutrality is not that argument.

## Consequences

**Gained:** dispersion's measured cost share fell from 64% to 36% — inside the
gate — by changing one deadline. Nothing about the strategy's economics
changed; the execution stopped throwing away the edge.

**Learned, and this is the transferable part:** *delta-neutrality protects the
position, not the entry.* The exposure is flat once both legs are on. Getting
both legs on is a two-sided order problem, and it is identical whether the
second leg is a hedge, a mirror, or a third leg of a triangle.

**Corrected:** the dispersion strategy's entry threshold was re-derived from
the honest cost (0.05% → 0.07% per interval) and its expected trip count fell
from 26 a year to 10, because a wider differential is rarer. Its honest annual
upper bound is about 4%. That is a real strategy and a small one, and saying so
is the point.

**Also corrected, and it matters more:** the carry strategy's headline 68.7%
cost ratio was measured on a scenario emitting one bar per eight-hour funding
interval — the same artifact. Re-measured at hourly resolution with a one-hour
fallback, the same code on a comparable scenario measures **11%**.

Both numbers are synthetic and neither is a property of the strategy. The
conclusion that survives is the arithmetic one, not the measured one: carry
collects the funding *level*, which is small against a fixed round trip, and
`tradesys viability` says that independently of any scenario. **A cost ratio
measured on synthetic data measures the scenario.**

**Watch:** a fallback in minutes means more crossing in a fast market, which is
the correct trade but not a free one. The deadline is a parameter and it should
be measured against realised drift, not guessed — as this one was, twice.
