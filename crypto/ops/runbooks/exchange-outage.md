# Runbook: exchange outage

**Severity:** SEV1 while positions are open, SEV3 while flat.
**Trigger:** connectivity loss, sustained 5xx, or a maintenance window.

## First action

Do **not** flatten immediately. You cannot trade on a venue that is down, and
an order queued against a returning venue executes at whatever the reopening
print is.

1. Confirm the session has halted new orders: `tradesys session` → kill switch
   should show `HALTED`, engaged on `connectivity_loss`.
2. Check exposure on the venue that is down, and on every other venue. **A
   hedged position with one leg on a dead venue is a directional position.**
3. If the other leg is live and the outage looks longer than minutes, reduce
   the live leg. You are not closing the trade; you are removing the direction
   you did not choose.

## Diagnose

- Venue status page and the venue's own announcement feed.
- Is it us or them: does a second venue respond? `tradesys session` reports
  per-venue reconciliation.
- Distinguish **outage** from **ban**: HTTP 418 is an IP ban earned by ignoring
  429s, and it is our defect, not theirs. See
  [feed disconnection](feed-disconnection.md).

## Recover

The session auto-flattens 60 seconds after connectivity loss (Annex D §3), and
returning to trading requires **reconnection plus a clean reconciliation**.

1. Wait for the venue, do not poll it aggressively. Aggressive polling into a
   recovering venue is how an outage becomes a ban.
2. Run reconciliation before enabling anything. The venue may have filled,
   cancelled or expired orders while we could not see it.
3. Enable strategies one at a time. All at once into a thin reopening book
   reproduces the outage's effect at full size.

**Do not** raise `recvWindow` to cope with a slow venue. That replaces a loud
failure with a silent window in which stale requests execute.
