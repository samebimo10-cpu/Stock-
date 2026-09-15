# Runbook: audit path failure

**Severity:** SEV1.
**Trigger:** the audit buffer filled, or the hash chain failed verification.

Trading halts when the audit path is lost. That is deliberate and it surprises
people, so it is worth stating why: **a system that keeps trading while it
cannot record what it is doing cannot be reconciled afterwards.** The position
is recoverable; the explanation is not.

## First action

1. Trading has already halted. Confirm it.
2. Do not clear the buffer to make the error go away. The buffered records are
   the ones describing whatever happened just before the failure, which is the
   window you will most want.
3. If the disk is full, free space elsewhere. Do not delete the audit log.

## Diagnose

Two different failures wear the same alert:

**Buffer full** — the sink is unavailable. Disk full, permissions, the
off-host replica unreachable. Ordinary infrastructure, and the records are
still in memory until the process ends. Restore the path and they flush.

**Chain broken** — verification failed. This is the serious one. Either a
record was altered or removed, or the writer has a defect. Both mean the record
of what the system did cannot be trusted.

```bash
tradesys verify-audit <path>      # names the first record that does not verify
```

The error distinguishes them: a sequence jump means a record was removed, a
`prev_hash` mismatch means one was altered or inserted, and a
contents-do-not-match-their-own-hash means that record was edited in place.

## Recover

**Buffer full:** restore the path, confirm the backlog flushed, then recover.
The log refuses to recover while the backlog is unflushed, deliberately.

**Chain broken:** do not resume until you know which. If a writer defect, fix
it and start a new chain with the old one preserved. If tampering, this is a
security incident — go to [key compromise](key-compromise.md) and treat host
access as suspect.

Either way the post-mortem test is specific: the chain must verify in CI over
the full retention window, and it should already.
