# Runbook: API key compromise

**Severity:** SEV1. The highest-urgency procedure here.
**Trigger:** a key in a log, a repository, a screenshot, an unexplained order,
or any doubt at all.

Doubt is enough. Rotating a key that was fine costs an hour. Not rotating a key
that was leaked can cost everything.

## First action

In this order, and do not wait for confirmation of anything:

1. **Revoke the key at the venue.** Not in our config — at the venue. Our
   config controls what we do; revocation controls what anyone else can.
2. **Revoke it in the signing service** so nothing here keeps trying to use it.
3. **Check for withdrawals.** Our keys have withdrawals disabled and the signer
   refuses withdrawal endpoints regardless, so this should be impossible twice
   over. Check anyway — the point of defence in depth is that you verify the
   layers rather than assume them.
4. **Flatten if anything is unexplained.** An unexplained position after a
   suspected key leak is not a reconciliation puzzle.

## Diagnose

1. **How did it get out?** The usual route is an exception handler printing a
   request. Search logs for the key's prefix, and for signature-shaped values.
   Log redaction is tested, so a hit is itself a defect to fix.
2. **Scope it.** Keys are per strategy and per environment, so one compromise
   is contained and attributable. Which strategy, which environment, which
   venue, and what could that key do.
3. **Check the IP allowlist.** A restricted key leaked to an address that is
   not on the list cannot trade. That is the difference between an incident and
   a scare, and it is why restriction is mandatory rather than advisable.
4. **Venue-side audit.** Pull the venue's own API access log. Ours tells you
   what we did; theirs tells you what was done.

## Recover

1. Issue a new key: Ed25519, trading only, **withdrawals off**, IP-restricted.
2. Store the private key in the signing service. It does not go anywhere else,
   and it does not pass through the trading process.
3. Rotate every other key of the same scope. If one leaked by a mechanism, the
   others leaked by the same mechanism.
4. Fix the leak path before resuming. Resuming with the route still open means
   doing this again with a fresh key.

Post-mortem is mandatory and the test is specific: a case that would have
caught this particular leak path in redaction or in review.
