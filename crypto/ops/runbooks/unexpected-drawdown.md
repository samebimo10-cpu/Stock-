# Runbook: unexpected drawdown

**Severity:** SEV1.
**Trigger:** the drawdown ladder — amber 6%, soft 8%, hard 12%.

The ladder exists so that acting at 8% makes 12% rare. Treat amber as the
incident; by hard stop the decisions have been made for you.

## First action

By rung:

| Rung | System has already | You do |
|---|---|---|
| Amber 6% | Alerted. No new strategies, no size increases. | Look now, while it is cheap. |
| Soft 8% | **Halved every allocation.** Positions held. | Written review before restoring size. |
| Hard 12% | **Flattened everything. Full stop.** | Two-person authorisation and full revalidation. |

Do not restore allocations to get the loss back. That is the decision the
ladder exists to take out of your hands.

## Diagnose

The question is not "why are we down" but **"is this within what we modelled"**.

1. **Compare against the Monte Carlo 5th percentile.** Every strategy has one
   from validation. A drawdown inside it is expected; the strategy is behaving.
2. **Beyond 1.5× that figure is a verdict, not a datapoint.** It means the risk
   model is wrong, which means every position size in the system is wrong.
   Stop and rebuild (SPEC §15.2).
3. **Which strategy?** Per-strategy attribution answers this directly. A
   drawdown concentrated in one strategy is a strategy problem. Spread evenly
   across supposedly uncorrelated strategies is a **correlation** problem, and
   the more serious of the two.
4. **Check realised correlations against the estimates.** Correlations rise in
   stress, which is why the estimator uses the higher of the 20- and 60-day
   windows. If realised has gone well past even that, the diversification you
   sized for was not there.
5. **Costs or direction?** Compare realised costs against modelled. A drawdown
   that is mostly fees is a different problem with a different fix.

## Recover

- **Soft:** written review, one operator, allocations restored deliberately.
- **Hard:** two distinct people, plus full revalidation of every live strategy
  under SPEC §11.2. The same person approving twice does not satisfy this and
  the switch will not accept it.
