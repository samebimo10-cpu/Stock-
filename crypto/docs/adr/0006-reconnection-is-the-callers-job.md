# 0006. Reconnection is the caller's job, and the book is always discarded

**Status:** Accepted
**Relates to:** SPEC §4.2, §9.5, Annex E §3, §6.1.

## Context

Every WebSocket library worth using reconnects for you. It is the feature
people choose them for, and on a depth stream it is actively wrong.

A reconnect means an unknown number of updates were missed — possibly none,
and "possibly none" is not something the client side can establish. A library
that reconnects transparently hands back a stream that looks continuous and is
not, and the local book carries on being updated across the hole. The book is
usually still roughly right afterwards, which is how a stale level survives
long enough to be quoted against.

The same argument applies to the private stream, differently: a `listenKey`
reused across a reconnect yields a socket that opens successfully and then
delivers nothing at all.

## Decision

`WebSocketClient` handles one connection and ends the iteration when it drops.
`LiveRunner` owns reconnection: it discards every local book unconditionally on
every connect, backs off exponentially with full jitter, rotates proactively at
23 hours, and fetches a fresh private-stream token each time.

`stop()` abandons a blocked *read* immediately but never cancels work in
progress.

## Consequences

**Gained:** a reconnect is visible to the code that has to care about it. The
resync path runs on every connection rather than only on the rare detected gap,
so it is exercised constantly instead of being tested for the first time during
an incident.

**Accepted:** a few hundred lines of RFC 6455 framing that a dependency would
have provided. Worth it here — the package has no HTTP or WebSocket dependency
at all, which is why every failure path in it is testable offline, and the
failure paths are the ones a live venue will not reproduce on demand.

**Accepted:** full jitter means a reconnect can be almost immediate. That is
the point: without jitter, every process watching the same venue retries in
lockstep after the same outage, and from Binance's side a synchronised
reconnect storm is indistinguishable from an attack. An IP ban while holding a
position is worse than a gap in the feed — no data *and* no ability to flatten.

**Watch:** the 23-hour rotation assumes the venue's 24-hour limit. If Binance
changes it, the rotation becomes either useless or too frequent. It is a
configuration value for that reason, not a constant.
