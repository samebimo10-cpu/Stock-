# 0002. The cost model is shared by the backtest and the simulated venue

**Status:** Accepted
**Relates to:** SPEC §3.2 rule 2, §11.1.

## Context

The cost model started under `research/`, which is where the specification
describes it. The simulated venue then needed it too, to charge impact and
adverse selection into fill prices rather than reporting them separately.

Importing from `research` inside an adapter made the package graph circular,
and the obvious fixes — a late import, a duplicated formula — both amount to
having two cost models that agree until they do not.

## Decision

The cost arithmetic lives at `tradesys.costs`, above both. `research.costmodel`
re-exports it so the name the specification uses keeps working.

## Consequences

**Gained:** one implementation. The backtest and the simulated venue cannot
disagree about what a trade costs, which is the content of rule 2 applied to
costs specifically.

**Accepted:** the module sits outside the layer structure, alongside
`pipeline.py` and `accounting.py`. Cost arithmetic is domain knowledge rather
than a layer, and forcing it into one would have been tidier on the diagram and
worse in the code.
