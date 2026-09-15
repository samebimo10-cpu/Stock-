# Runbook: bringing a live connection up, and taking it down

**Severity:** not an incident. This is the procedure that stops one.
**Trigger:** somebody is about to run `tradesys live` against a real venue.

## Before you run anything

Check all five. Any "no" stops here.

1. **Key permissions.** Trading enabled, **withdrawals disabled**, IP
   allowlisted. An unrestricted key's Spot & Margin permission silently expires
   after 90 days (Annex E §2); an allowlisted one does not.
2. **Credentials in the environment**, `BINANCE_API_KEY` / `BINANCE_API_SECRET`.
   Not in a file in the repo, not on the command line — there is no flag for it.
3. **Clock.** The startup gate halts above 100ms of drift, because above that
   the venue rejects signed requests anyway. If NTP is not running, fix that
   first.
4. **Which step of the ladder** you are on, and why. SPEC §17.5 is four steps
   and each one exists because something was found during it.
5. **`tradesys validate`.** It exits 1 today. If it still does, the only modes
   that are defensible are `read_only`, `shadow` and `paper`.

## Bringing it up

```bash
tradesys live --dry-run                 # says what it would do, connects to nothing
tradesys live --mode read_only          # step 2: feeds only, no strategy enabled
tradesys live                           # step 3: shadow, testnet
tradesys live --production              # step 3 for real: shadow on production
```

Watch, in this order:

- **The startup gate.** It prints what it checked. If it refuses, it is
  refusing for a reason; the reason is in the message and the answer is never
  to restart until it passes by chance.
- **`sequence_gaps`.** A cold start is not a gap and is not counted. If this
  climbs during a steady connection, the feed is lossy and the book is not to
  be quoted against.
- **`feed_staleness_ms`.** Flagged on the event at 5s, refused by the limit at
  30s. If the p99 is above a second on a healthy link, the depth stream is
  probably still at its 1000ms default.
- **`reconciliation_cycles`.** It should climb on its own timer, at about 5s,
  whether or not the market is doing anything. If it only moves when events
  arrive, the independent poll is not running and a silent feed will not be
  noticed.

## Taking it down

`Ctrl-C` once. The runner stops reading and lets work in progress finish;
it never cancels an order placement mid-flight, because an order whose
outcome nobody learns is the one state SPEC §9.2 has no recovery for.

If it does not exit within a read timeout, that is a defect — capture the
stack before killing it.

**Do not stop a live session with an open position and walk away.** Flatten
first (`tradesys session --kill`, or the manual kill switch), confirm flat
against the venue, then stop.

## When something is wrong

- Connection dropping repeatedly → [feed-disconnection](feed-disconnection.md)
- Positions disagree with the venue → [position-mismatch](position-mismatch.md)
- Signed requests rejected → [clock-drift](clock-drift.md)
- A key may be exposed → [key-compromise](key-compromise.md), immediately

## What this procedure does not cover

Whether the strategy should be trading at all. That is §15's gates, agreed in
writing before there was money at stake, and this runbook has no opinion about
them on purpose.
