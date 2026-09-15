# 0001. Python on the hot path

**Status:** Accepted
**Deviates from:** SPEC §3.4, which specifies Rust or C++ for the hot path.

## Context

The specification is right that garbage-collector pauses are unacceptable in an
order path measured in microseconds, and the recommendation follows from that.

This system is Track A. Its edges are funding carry and basis, held for hours
to days, entered passively with seconds of timing tolerance. The latency budget
is 40ms, not 2ms, and the constraint that makes Rust necessary does not apply.

## Decision

Python throughout, including the execution path.

## Consequences

**Accepted:** market making is off the table. It was already off the table for
fee-tier reasons (Annex B §5.1 puts it at roughly −5bp per round trip at tier
0), so this costs nothing that was reachable.

**Accepted:** if a latency-sensitive strategy is ever wanted, the hot path is a
rewrite. The layer boundaries and typed messages are designed so it is a
rewrite of one layer rather than of the system, which is the whole reason the
interfaces are specified as they are.

**Gained:** one language for research and production, so the same-code-path
guarantee is a property of the design rather than a thing maintained across a
foreign function interface.

**Watch:** if risk decision latency p99 approaches 40ms, revisit. The indicator
exists and pages.
