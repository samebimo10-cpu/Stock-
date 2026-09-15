# 0003. Single-asset concentration is measured against equity as a floor

**Status:** Accepted
**Deviates from:** SPEC §8.2, which specifies "25% of book".

## Context

Read literally, the limit rejects every opening order. One position is 100% of
a one-position book, so a system starting flat can never take its first
position — not as an edge case but as the normal path.

The limit plainly means "do not let one asset dominate". It assumes a book that
already exists.

## Decision

Measure against `max(gross book, equity)`. A small position against a large
equity is a small fraction; a book grown past its equity is measured on gross
as intended.

## Consequences

**Gained:** the rule keeps its meaning and stops being unsatisfiable at the
moment it first applies.

**Accepted:** while gross is below equity the limit binds on equity rather than
on the book, which is slightly more permissive in absolute terms than the
literal reading. Gross exposure has its own limit and that one is unchanged, so
nothing is unbounded.

**Noted:** this is one of three places where a specification limit turned out
to be degenerate at small scale. The others are recorded in Annex G §4a.
