# Runbook: feed disconnection

**Severity:** SEV2 while flat, SEV1 with positions open.
**Trigger:** `feed_staleness` breach, sequence gaps, or a silent stream.

## First action

The session halts new orders automatically on feed staleness and **holds**
positions. That is correct: a stale feed means you cannot price, and flattening
blind is worse than waiting.

Confirm the halt took: `tradesys session` → kill switch `HALTED` on
`feed_staleness`.

## Diagnose

In this order, because the second case is the dangerous one:

1. **Is the connection down, or is it up and silent?** A down connection is
   loud. A connected stream delivering nothing looks exactly like a quiet
   market. The independent REST reconciliation poll is what distinguishes
   them, and it is why that poll is not redundant.
2. **User data stream specifically.** An expired `listenKey` produces a stream
   that connects and delivers nothing. Fills stop arriving, the system believes
   it is flat, and it opens more against a position it already holds — failure
   mode 7 in SPEC §8.5. Check the keepalive: the key is valid 60 minutes, we
   send a `PUT` every 30, and a reconnect must fetch a **fresh** key rather
   than reusing one.
3. **Sequence gaps.** A gap discards the local book and resyncs from a REST
   snapshot. Confirm the affected window is marked unusable — research trained
   on a gap window learns to trade a reconnection.
4. **24-hour drop.** Connections close at 24 hours by design. If reconnects
   cluster at a 24-hour boundary, that is the cause and the fix is to rotate
   proactively at ~23 hours.

## Recover

Automatic once the feed is green for five minutes. Nothing to authorise.

If it recurs on a cadence, that is a defect, not an incident: file it, and note
that data-quality amber for three consecutive days escalates to red on its own
(SPEC §4.4).
