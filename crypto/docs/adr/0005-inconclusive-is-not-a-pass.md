# 0005. Validation checks may return inconclusive, and inconclusive does not pass

**Status:** Accepted
**Extends:** SPEC §11.2.

## Context

The specification's validation protocol has pass and fail. Applied to a small
sample, every check still produces a number, and a number invites a decision.
A strategy with four trades has a computable Sharpe ratio and no meaningful
one.

The common way to fool yourself in validation is not to fake a result. It is to
compute one from too little data and then treat it as evidence because it
exists.

## Decision

Every check in the harness may return `INCONCLUSIVE`, and a report containing
one does not pass.

## Consequences

**Gained:** absence of evidence stops reading as evidence. The demo strategy
reports almost everything as unmeasurable, which is the correct answer for
forty-five synthetic periods, and the harness says so rather than producing a
Sharpe ratio.

**Accepted:** a strategy can fail validation by being unmeasurable rather than
by being bad. That is the intended behaviour — a strategy nobody can measure is
a strategy nobody should fund — but it means "not validated" needs reading
before it is acted on.

**Noted:** the threshold is 30 trades, the same floor SPEC §11.2 item 5 puts on
a regime. One number, used consistently.
