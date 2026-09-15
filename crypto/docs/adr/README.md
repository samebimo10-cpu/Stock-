# Architecture decision records

Every deviation from a SHOULD in [SPEC.md](../../SPEC.md) is recorded here with
context, decision and consequences (SPEC §14.4).

The value is a year later, when somebody asks why, and the answer is written
down rather than reconstructed from a commit log by someone who was not there.

One file per decision, numbered, never edited after acceptance. A decision that
changes gets a new record that supersedes the old one, because the fact that we
once believed something is part of the history.

| | Decision | Status |
|---|---|---|
| [0001](0001-python-hot-path.md) | Python on the hot path | Accepted |
| [0002](0002-cost-model-shared.md) | Cost model shared by backtest and simulated venue | Accepted |
| [0003](0003-concentration-floor.md) | Concentration measured against equity as a floor | Accepted |
| [0004](0004-hedge-crosses.md) | The hedge leg crosses rather than only resting | Accepted |
| [0005](0005-inconclusive-is-not-a-pass.md) | Validation checks may return inconclusive | Accepted |
| [0006](0006-reconnection-is-the-callers-job.md) | Reconnection is the caller's job, and the book is always discarded | Accepted |
