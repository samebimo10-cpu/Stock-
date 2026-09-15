# Runbook: position mismatch

**Severity:** SEV1. Always.
**Trigger:** reconciliation reports `MISSING_LOCAL` or a material `QTY_MISMATCH`.

This is the one where the temptation is worst, so it is worth saying plainly:
**never adopt a position you cannot explain.** Adopting it means managing
exposure no strategy requested and no risk check approved. Trading stops until
a human understands it.

## First action

1. Trading is already halted; confirm it. `tradesys session` → kill switch
   engaged on `missing_local_position` or `reconciliation_mismatch`.
2. **Do not flatten yet.** Flattening an unexplained position can be the wrong
   direction if the position is a leg of something.
3. Record the exact numbers now: local quantity, venue quantity, symbol, venue,
   timestamp. They will change.

## Diagnose

1. **Is it ours?** Query the venue's order history for the instrument. An order
   we placed and lost track of has a client order ID with our prefix.
2. **Is it a QUERY that resolved?** An order whose outcome was unknown may have
   filled after we stopped looking. Check for machines stuck in `QUERY`:
   these are the expected source, and they are also the benign one.
3. **Is it a broken leg group?** One leg filled and the unwinder did not get to
   the other. `tradesys session` reports open leg groups.
4. **Is it someone else's?** A shared sub-account, a manual trade, or a key
   used elsewhere. If a key was used outside this system, go to
   [key compromise](key-compromise.md) immediately.
5. **Replay it.** The audit log reconstructs positions from records alone. If
   the reconstruction matches our local state and not the venue's, the fill
   never reached us — a feed problem. If it matches the venue's, we recorded
   it and lost it — a state problem.

## Recover

One operator, after investigation, with the cause written down. Not automatic,
at any threshold, ever.

1. Resolve the position deliberately: flatten it, or adopt it with an explicit
   decision recorded against a named strategy.
2. Reconcile clean.
3. Acknowledge, which clears the trigger: `tradesys session --operator <name>`.
4. Enable strategies one at a time.

Post-mortem with a test. A mismatch that happened once will happen again.
