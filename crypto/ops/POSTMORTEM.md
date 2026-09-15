# Post-mortem template

Every SEV1 and SEV2 produces one of these (SPEC §10.5). Blameless, and it must
contain **a new automated test that would have caught it**.

A post-mortem without a test is a story. The test is the only part that stops
the incident recurring, and it is the mechanism by which the failure-mode list
in SPEC §8.5 grows from experience rather than staying fixed at ten.

---

## Incident: <short description>

| | |
|---|---|
| **Severity** | SEV1 / SEV2 |
| **Detected** | <when, and by what — an alert, a person, a reconciliation> |
| **Resolved** | <when> |
| **Financial impact** | <amount, or "none">  |
| **Correlation IDs** | <the ones that trace it> |

## What happened

Plain narrative, in order. No blame, and no "should have".

## Why it happened

The mechanism, not the culprit. Keep asking until the answer is a property of
the system rather than a property of a person. "An operator changed a limit" is
not a root cause; "a limit could be changed by one person during an incident"
is.

## Why it was not caught earlier

Which control should have caught it, and why it did not. If no control existed,
say so — that is the more useful answer.

## Detection

- How long between the failure starting and anyone knowing?
- Did the right alert fire? If a P1 fired without money at risk, that is a
  second defect and it gets its own entry.
- If a person noticed before the system did, that is the finding.

## The test

**Mandatory.** The name of the test, where it lives, and confirmation that it
fails against the old code and passes against the new.

```
tests/test_<area>.py::test_<what it guarantees>
```

If the incident cannot be expressed as a test, say why in a sentence. That
sentence is usually the real finding.

## Actions

| Action | Owner | Due | Done |
|---|---|---|---|
| The test above | | | |
| | | | |

Actions are specific and they have a date. "Improve monitoring" is not an
action.

## What went right

Worth recording. A control that worked is a control worth keeping when
somebody proposes removing it for being noisy.
