# Runbook: clock drift

**Severity:** SEV2 above 50ms, SEV1 above 100ms with positions open.
**Trigger:** the `clock_drift` indicator, or a venue rejecting signed requests.

Clock drift is the failure that looks like an authentication problem. Binance
returns `-1021 Timestamp for this request is outside of the recvWindow`, which
reads like a key issue and is not.

## First action

1. The session halts above 100ms because the venue will reject signed requests
   outright at that point. Confirm the halt.
2. **Do not raise `recvWindow`.** It is the obvious move and it is wrong: it
   replaces a loud, diagnosable failure with a silent window in which stale
   requests execute. The API maximum is 60000ms and reaching for it is a
   symptom, not a fix.

## Diagnose

1. `chronyc tracking` — is the daemon running, and what is its offset?
2. Is the stratum-1 source reachable? A time daemon that cannot reach its
   source drifts quietly and reports itself healthy.
3. Compare against the **venue's** clock, not only against NTP. The venue is
   the only clock that can reject us.
4. Check whether drift correlates with load. A host under CPU pressure can
   delay the time daemon enough to matter.
5. Virtualisation: a suspended or migrated VM resumes with a stale clock.

## Recover

Automatic once drift is below 10ms for five minutes.

If drift recurs, the fix is infrastructure, not configuration: PTP rather than
NTP, or a host that is not contended. Do not carry a drifting clock with a
widened window.
