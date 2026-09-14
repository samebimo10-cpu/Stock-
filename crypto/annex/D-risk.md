# Annex D — Risk limits, state machines and reconciliation

Companion to [SPEC.md](../SPEC.md) §8 and §9.4. The risk service is the first thing built
(SPEC §20) and the only service that can stop the system.

---

## 1. Limit register

Every limit is declared in one file, `risk/limits.yaml`, loaded at startup with bounds validation
(SPEC §8.5 failure mode 3) and changeable only under the two-person rule (SPEC §13.2).

```yaml
schema_version: 1
equity_definition: cash_plus_unrealised_plus_accrued   # SPEC §12.1 — one definition, everywhere

limits:
  per_trade_risk:            {value: 0.02,  unit: equity_fraction, action: reject}
  daily_loss:                {value: 0.03,  unit: equity_fraction, action: flatten_and_halt,
                              reset: next_utc_day_with_ack}
  weekly_loss:               {value: 0.07,  unit: equity_fraction, action: flatten_and_halt,
                              reset: written_review_two_person}
  drawdown_soft:             {value: 0.08,  unit: equity_fraction, action: halve_allocations}
  drawdown_hard:             {value: 0.12,  unit: equity_fraction, action: full_stop,
                              reset: revalidate_all_two_person}
  gross_exposure:            {value: 3.0,   unit: equity_multiple,  action: reject_new}
  asset_concentration:       {value: 0.25,  unit: book_fraction,    action: reject}
  venue_concentration:       {value: 0.40,  unit: capital_fraction, action: alert_and_sweep}
  liquidation_distance:      {value: 0.25,  unit: pct_from_mark,    action: auto_deleverage}
  single_order_notional:     {value: max(0.02*equity, 5*median_order), action: reject}
  order_rate:                {value: 0.7,   unit: venue_limit_fraction, action: throttle}
  consecutive_rejects:       {value: 5,     unit: count_per_strategy, action: disable_strategy}
  backtest_divergence:       {value: -2.0,  unit: z_score_30d,      action: disable_strategy}

bounds:                    # SPEC §8.5 #3: every field has a declared range; load fails outside it
  per_trade_risk:      [0.001, 0.05]
  daily_loss:          [0.01,  0.10]
  drawdown_hard:       [0.05,  0.25]
  gross_exposure:      [1.0,   5.0]
```

The `bounds` block is what stops a misplaced decimal. A config declaring `per_trade_risk: 0.2`
instead of `0.02` fails to load rather than sizing every position ten times too large, and it fails
at load time rather than at the first fill.

### 1.1 The drawdown ladder

SPEC §8.2 corrects v1.0's inconsistency here — v1.0 set a 15% hard stop against a 20% target,
leaving no room between "tolerable" and "dead". The ladder:

| Level | Drawdown | Action | Reversible |
|---|---|---|---|
| Green | < 6% | Normal | — |
| Amber | 6–8% | Alert, no new strategies, no size increases | Automatic |
| **Soft** | **8%** | **Halve every allocation; written review** | One operator |
| **Hard** | **12%** | **Flatten all; full stop** | Two people + full revalidation |
| Target ceiling | 20% | Should never be reached, because the ladder acted | — |

The 20% figure in SPEC §1.2 is a *tolerance* describing the outcome including the reaction, not a
level at which something finally happens.

---

## 2. Kill-switch state machine

```
                    ┌──────────┐
      ┌────────────►│  ACTIVE  │◄────────────┐
      │             └────┬─────┘             │
      │        trigger fires │               │ recovery conditions met
      │             ┌────▼─────┐             │  (per §3 matrix)
      │             │ HALTING  │  no new orders; existing orders cancelled
      │             └────┬─────┘
      │      ┌───────────┴───────────┐
      │ ┌────▼─────┐          ┌──────▼──────┐
      │ │  HALTED  │          │ FLATTENING  │ reducing to zero, reduce_only
      │ │ positions│          └──────┬──────┘
      │ │   held   │          ┌──────▼──────┐
      │ └────┬─────┘          │    FLAT     │
      │      │                └──────┬──────┘
      └──────┴───────────────────────┘
                 via RECOVERING: reconcile → verify → enable strategies one at a time
```

Rules:

- `HALTING` is always entered before `FLATTENING`. Cancel resting orders first, or the flattening
  orders compete with your own stale quotes.
- `FLATTENING` uses `reduce_only` on every order. A flattening routine that can open a position is
  the worst possible bug in the worst possible moment.
- `RECOVERING` runs the full startup gate (SPEC §9.5), including reconciliation, regardless of how
  brief the halt was.
- **Strategies are re-enabled one at a time, with a settling period between each.** Enabling all of
  them simultaneously after a halt reproduces whatever condition caused the halt, at full size.

### 2.1 Dead-man's switch

```
risk service  ──heartbeat every 2s──►  execution service
execution service: if no heartbeat for 10s  →  FLATTENING, autonomously
```

The execution service flattens **without asking**, because the service it would ask is the one that
is not responding. This is the one place in the system where a component acts on positions without
risk approval, and it is safe precisely because its only possible action is to reduce.

Track A tolerance: 30 s, reflecting a Python hot path and a single host.

**Test this weekly in production** (SPEC §8.4) by stopping the risk service during low-risk hours
and confirming the flatten. A dead-man's switch verified only in staging is verified in the
environment where it does not matter.

---

## 3. Recovery matrix

The section v1.0 omits. A kill switch with no defined route back gets bypassed rather than reset,
usually by one tired person at 3am.

| Trigger | State entered | Positions | Return to `ACTIVE` requires |
|---|---|---|---|
| Feed staleness | `HALTED` | Held | Feed green 5 min → automatic |
| Latency above budget | `HALTED` | Held | Latency green 5 min → automatic |
| Order rate breach | `HALTED` (throttle first) | Held | Rate below 50% budget → automatic |
| Connectivity loss | `HALTED`, then `FLATTENING` at 60 s | Held, then flat | Reconnect + clean reconciliation |
| Rejection-rate spike | Strategy disabled | Held | Root cause recorded, one operator |
| Reconciliation mismatch | `HALTED` immediately | Held | Manual investigation + recorded cause |
| `MISSING_LOCAL` position | `HALTED` immediately | Held, **never auto-adopted** | Investigation, one operator |
| Liquidation distance | Auto-deleverage | Reduced | Distance > 35% → automatic |
| Daily loss | `FLATTENING` | Flat | Next UTC day + acknowledgement |
| Weekly loss | `FLATTENING` | Flat | Written review, two people |
| Drawdown soft (8%) | Allocations halved | Held | Written review, one operator |
| Drawdown hard (12%) | `FLATTENING` | Flat | Full revalidation (SPEC §11.2), two people |
| Dead-man | `FLATTENING` | Flat | Risk healthy + reconciliation + one operator |
| Audit buffer full | `HALTED` | Held | Audit path restored + backlog flushed |
| Clock drift > 100 ms | `HALTED` | Held | Drift < 10 ms for 5 min → automatic |

Design principle visible in the column shapes: **conditions that are transient and externally
verifiable recover automatically; conditions that imply the system's model of reality is wrong
require a human.** Auto-recovery from a reconciliation mismatch would mean resuming trading while
not knowing what you hold.

---

## 4. Reconciliation discrepancy classes

Referenced from SPEC §9.4.

| Class | Meaning | Action | Escalation |
|---|---|---|---|
| `CLEAN` | Everything matches | Emit report, continue | — |
| `MISSING_LOCAL` | Exchange has a position or order we do not know about | **HALT** | P1 immediately |
| `MISSING_REMOTE` | We believe in an order the exchange lacks | Query by client order ID; if absent, mark terminal, emit correction | P2 |
| `QTY_MISMATCH` | Same position, different size | Exchange wins; correct; **HALT if > 0.1% equity** | P1 above threshold |
| `PRICE_MISMATCH` | Average entry differs | Exchange wins; correct attribution | P3 |
| `BALANCE_DRIFT` | Balance differs beyond fee rounding | Investigate; usually an unbooked fee or funding payment | P2 |
| `STALE` | Reconciliation did not complete in its window | Retry; **3 consecutive → HALT** | P1 on the third |

**`MISSING_LOCAL` is never auto-adopted.** Adopting an unknown position means the system starts
managing exposure that no strategy requested and no risk check approved. The correct response to
finding a position you cannot explain is to stop, not to incorporate it.

Emit a `ReconciliationReport` every cycle, including `CLEAN` ones (SPEC §9.4) — the absence of
reports then becomes independently alertable, which is how you detect that reconciliation stopped
running rather than stopped finding problems.

---

## 5. Risk service availability

The risk service is on the critical path of every order, so its own failure modes matter as much
as the limits it enforces.

- **Run it redundantly** [B]: two instances, one active. Failover is flat-and-restart, never resume
  (SPEC §13.1). A standby that resumes from a stale limit state is worse than no standby.
- **It has no dependency on the strategy layer** (enforced by the import-graph check, SPEC §3.5).
- **It persists limit state** — daily loss so far, drawdown peak, rate budget — so a restart does
  not reset the daily loss counter to zero. A risk service that forgets today's losses on restart
  converts a restart into a limit bypass, which is a bypass available to anyone who can cause a
  crash.
- **Its own health is a kill-switch input.** Degraded risk service means halted trading.

---

## 6. What the risk service must never do

A short list, because each of these has ended a real trading operation:

1. **Never approve on timeout.** Absence of an answer is a reject (SPEC §8.3).
2. **Never increase a quantity.** It may reduce or refuse (Annex A §4.2).
3. **Never allow an in-code override.** Overrides are config changes under two-person control, which
   cannot be executed in the middle of an incident by one person.
4. **Never trust local state over exchange state** (SPEC §3.2 rule 4).
5. **Never reset its counters on restart.**
6. **Never be importable by strategy code.** Enforced in CI.
7. **Never be the thing that is disabled to get trading working again.** If the path back to trading
   runs through switching off risk, the incident is now worse than whatever caused it.
