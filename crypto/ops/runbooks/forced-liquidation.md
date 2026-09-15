# Runbook: forced liquidation

**Severity:** SEV1.
**Trigger:** the venue liquidated a position, or liquidation distance breached
25% of mark.

If this happened, a control failed before it. The liquidation-distance monitor
auto-deleverages well before the venue's threshold precisely so the venue never
gets to make this decision for us.

## First action

1. **Establish what is left.** A liquidation changes the position without any
   order of ours, so local state is wrong by definition. Reconcile first.
2. **Check the other leg.** For a hedged position, losing the perpetual leg to
   liquidation leaves the spot leg naked and long. That is a directional
   position nobody sized, and it is usually the larger problem.
3. **Flatten the survivors** unless you can state why holding them is
   deliberate.

## Diagnose

The specific question: **why did auto-deleverage not fire first?**

1. **Was the monitor running?** Liquidation distance is computed per venue from
   venue margin rules. A venue whose distance was never populated has no
   monitor, and that is a wiring defect rather than a market event.
2. **Was the move faster than the monitor's cadence?** Possible, and it means
   the cadence is wrong for this instrument's volatility.
3. **Was margin shared?** Cross-margin means a loss elsewhere can liquidate a
   position that was individually fine. If the book is cross-margined, the
   25% distance on one position is not the number that mattered.
4. **Delta-neutral is not liquidation-proof.** The legs sit in different margin
   accounts, and an upward move can liquidate a short perpetual while the spot
   leg is fine and unable to help. This is called out in the strategy
   specification for exactly this reason.

## Recover

Two people. A liquidation means the sizing was wrong, and sizing is not a
one-person change.

1. Re-estimate the tail **from the mechanism, not from the sample**. The sample
   now contains one event; that is not a distribution.
2. Reduce size, or raise the deleverage threshold above 25%, or both.
3. Revalidate the strategy before it trades again.
4. If the loss exceeded 5% of equity, this is a kill criterion under SPEC
   §15.2: stop, do not restart on judgement.
