# Runbooks

The eight situations SPEC §13.3 requires a written procedure for. Each has the
same three headings, in the order you need them at 3am:

1. **First action** — what to do before understanding anything. Usually this
   reduces exposure. Understanding comes second because exposure does not wait.
2. **Diagnose** — the specific things to look at, in order, with the command.
3. **Recover** — what it takes to resume, including who has to authorise it.

Two rules that apply to every runbook here:

- **Never disable risk to get trading working again.** If the path back runs
  through switching off a control, the incident is now worse than whatever
  caused it.
- **Write the post-mortem, and put a test in it.** Every SEV1 and SEV2 produces
  a blameless post-mortem containing a new automated test that would have
  caught it (SPEC §10.5). A post-mortem without a test is a story.

| Runbook | Severity | Recovery needs |
|---|---|---|
| [Exchange outage](exchange-outage.md) | SEV1 with positions open | Reconnect and clean reconciliation |
| [Feed disconnection](feed-disconnection.md) | SEV2, SEV1 with positions open | Automatic after 5 minutes green |
| [Position mismatch](position-mismatch.md) | SEV1 | One operator, cause recorded |
| [Unexpected drawdown](unexpected-drawdown.md) | SEV1 | Depends on rung; 12% needs two people |
| [Key compromise](key-compromise.md) | SEV1 | Revoke first, ask questions second |
| [Forced liquidation](forced-liquidation.md) | SEV1 | Two people, and a sizing review |
| [Clock drift](clock-drift.md) | SEV2, SEV1 above 100ms | Automatic after 5 minutes below 10ms |
| [Audit failure](audit-failure.md) | SEV1 | Path restored and backlog flushed |

## Before you need them

```bash
tradesys selfcheck    # the machine-checkable gates
tradesys chaos        # inject each failure and confirm the guarantee holds
tradesys session      # status, indicators, pages
```

The chaos suite is the rehearsal. Run it quarterly and after any change to
risk or execution: a runbook for a behaviour the system no longer has is worse
than no runbook, because it will be followed.
