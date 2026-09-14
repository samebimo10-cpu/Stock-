# Annex F — Phase gate checklists

Companion to [SPEC.md](../SPEC.md) §15. Each gate is an automated check that exits non-zero when
unmet. **A requirement nobody can fail automatically is a requirement that gets waived at 2am on
the day it matters**, which is the reason this annex exists at all.

Intended shape:

```
$ gates check --phase 0
PHASE 0 — INFRASTRUCTURE
  [PASS] data.quality_gates_green_30d        30/30 days green
  [PASS] data.raw_archive_immutable          checksums verified, 0 rewrites
  [FAIL] test.same_code_path                 divergence in 2 of 1,440 decisions
  [PASS] risk.deadman_verified               last live test 4 days ago
  ...
  RESULT: FAIL (1 of 14)
exit 1
```

The gate runner reads live telemetry and the trial registry. It is not a form somebody fills in, and
nobody may mark an item green by hand.

---

## Phase 0 — Infrastructure → Research

| Check | Criterion |
|---|---|
| `data.quality_gates_green_30d` | 30 consecutive green days, every stream, every venue (SPEC §4.4) |
| `data.multi_venue` | ≥ 2 venue adapters implemented, both exercised in CI (SPEC §17.1) |
| `data.raw_archive_immutable` | Checksums verified; zero rewrites of `raw/` |
| `data.normalisation_deterministic` | Re-running version N on fixed raw bytes is byte-identical (SPEC §4.3) |
| `data.clock_drift` | p99 drift < 10 ms over 30 days |
| `data.sequence_gaps` | Gap detection provably firing — injected gap detected in chaos test |
| `risk.service_standalone` | Risk deployable and testable with no strategy present |
| `risk.import_graph` | `l3_strategy` does not import `adapters`; `l5_risk` does not import `l3_strategy` |
| `risk.limits_bounded` | Every limit field has a declared range and a rejection test (SPEC §8.5 #3) |
| `risk.deadman_verified` | Dead-man flatten tested in production within the last 7 days |
| `exec.idempotency` | Duplicate client order ID provably rejected on testnet |
| `exec.query_state` | `QUERY` never emits a new order — property test passes |
| `exec.startup_gate` | Restart with open positions blocks strategies until reconciled |
| `test.same_code_path` | Nightly replay: zero decision divergence (SPEC §14.2) |
| `test.chaos_suite` | All 11 scenarios in SPEC §14.3 pass |
| `audit.hash_chain` | Chain verifies over the full retention window |
| `audit.halt_on_buffer_full` | Trading halts when the audit buffer fills (SPEC §3.3) |
| `research.trial_registry` | Harness refuses to run a backtest with no registry connection |

**Gate: all PASS. No partial entry to Phase 1.** Research done on a pipeline that has not passed
these produces results that must be discarded when it does.

---

## Phase 1 — Research → Paper

Per strategy, all required:

| Check | Criterion |
|---|---|
| `strategy.spec_written` | SPEC §6.1 template complete, all 9 sections, reviewed |
| `strategy.rationale_names_counterparty` | Human sign-off; "the market" is rejected |
| `strategy.param_count` | ≤ 6 free parameters |
| `strategy.cost_model_applied` | All Annex B §8 components present; returns cut ≥ 30% vs no-cost run |
| `strategy.walk_forward` | Positive in ≥ 70% of out-of-sample windows |
| `strategy.purged_cv` | Purge = holding period; embargo ≥ 1% of sample |
| `strategy.deflated_sharpe` | **DSR > 0.95** using the registry trial count (Annex C §2) |
| `strategy.pbo` | **PBO < 0.50** (Annex C §2.2) |
| `strategy.monte_carlo` | 5th-pct drawdown recorded; block bootstrap run and compared |
| `strategy.param_sensitivity` | Plateau at ≥ 80% of peak spans ≥ 30% of the parameter range |
| `strategy.regime_table` | All 5 regimes evaluated; regimes with < 30 trades reported as inconclusive |
| `strategy.cost_sensitivity` | Still positive at 1.5× modelled costs |
| `strategy.quality_sensitivity` | No material change excluding amber data days |
| `strategy.survivorship` | Universe includes delisted tokens |
| `strategy.lookahead_audit` | Every feature passes the SPEC §5.4 shift test |
| `strategy.capacity` | Capacity number recorded with the binding constraint named |
| `strategy.kill_criteria_signed` | SPEC §6.1 section 8 pre-registered and signed |
| `strategy.holdout` | **Evaluated exactly once.** Access log shows one read. |
| `portfolio.count` | ≥ 3 strategies passing [B] / ≥ 1 [A] |

**The holdout check is the one that matters most and is easiest to corrupt.** Two reads for the same
strategy is a process failure; the strategy does not proceed, and the process failure gets its own
review.

---

## Phase 2 — Paper → Micro-live

| Check | Criterion |
|---|---|
| `paper.duration` | ≥ 60 days [B] / ≥ 30 days [A] |
| `paper.divergence` | Live-vs-backtest Sharpe degradation < 15% |
| `paper.divergence_z` | z > −2.0 (Annex C §4) |
| `paper.unexplained_divergences` | Zero. Each divergence has a written root cause. |
| `paper.fill_model` | Modelled fill rate within 20% of what the book would have given |
| `paper.no_limit_breaches` | Zero limit breaches, including ones that caused no loss |
| `ops.runbooks` | All 8 runbooks in SPEC §13.3 written and walked through once |
| `ops.alerts` | P1 alert path tested end to end, including out of hours |
| `ops.dashboards` | All 5 dashboards live (SPEC §10.3) |
| `sec.keys` | Withdrawals disabled; IP allowlist set; Ed25519; keys in the signing service |
| `sec.log_redaction` | Secret-in-log test passes |
| `sec.two_person_rule` | Risk config load rejects a single-signer config [B] / 24h delay enforced [A] |

---

## Phase 3 — Micro-live → Small live

Capital $5k–10k [B] / $2k–5k [A]. Duration 30 days.

| Check | Criterion |
|---|---|
| `live.critical_incidents` | **Zero SEV1** |
| `live.sev2_incidents` | ≤ 2, each with a post-mortem containing a new automated test |
| `live.behaviour_as_specified` | Every order traceable to a signal and a risk decision by correlation ID |
| `live.tca_vs_model` | Realised costs within 20% of modelled (SPEC §9.6) |
| `live.reconciliation` | 100% success; zero `MISSING_LOCAL` |
| `live.no_duplicate_orders` | Zero duplicate client order IDs reaching a venue |
| `live.killswitch_tested` | Manual kill tested in production ≥ 4 times (weekly) |
| `live.expectancy` | Recorded, **not gated** — 30 days at this size measures nothing (SPEC §15.1) |

**`live.expectancy` is deliberately ungated.** At $5k for 30 days, noise dominates entirely. Gating
on it would mean scaling on a coin flip, and this gate's purpose is to establish correctness.

---

## Phase 4 — Small live → Scale

Capital $50k–100k. Duration 90 days.

| Check | Criterion |
|---|---|
| `live.divergence_z` | **z > −2.0** — live not statistically inconsistent with backtest (Annex C §4) |
| `live.cost_accuracy` | Realised within 20% of modelled over 90 days |
| `live.drawdown` | Never exceeded the 8% soft trigger |
| `live.mc_consistency` | Observed drawdown < 1.5× the Monte Carlo 5th percentile |
| `live.limit_discipline` | Zero breaches; every near-miss reviewed |
| `live.correlation` | Realised strategy correlations within 0.2 of estimates |
| `live.capacity_recheck` | Capacity re-estimated with live impact data |
| `live.incidents` | Zero SEV1; no repeated SEV2 root cause |
| `live.sharpe` | **Recorded, not gated** — 90 days cannot establish Sharpe 1.5 (Annex C §5) |

Note what is gated and what is not. The gate is consistency with the backtest and discipline in
operations, because those are measurable at 90 days. Sharpe is not, and a gate that pretends
otherwise converts a coin flip into a decision.

---

## Phase 5 — Scale

Continuous, re-evaluated at every capital increase:

| Check | Criterion |
|---|---|
| `scale.marginal_sharpe` | Sharpe at the new size ≥ 80% of Sharpe at the previous size |
| `scale.capacity_headroom` | Deployed ≤ 25% of estimated capacity (SPEC §12.4) |
| `scale.cost_ratio` | Fees + slippage + funding < 40% of gross PnL (SPEC §1.2) |
| `scale.correlation` | No live pair above 0.6 without an allocation cut |
| `scale.venue_concentration` | No venue above 40% of capital |
| `scale.chaos_recent` | Chaos suite re-run within the last quarter |
| `scale.keys_rotated` | Keys rotated within the last quarter |

---

## Kill criteria — checked continuously, not at gates

| Check | Trigger |
|---|---|
| `kill.drawdown_vs_mc` | Drawdown > 1.5× Monte Carlo 5th percentile → **stop and rebuild** |
| `kill.cost_divergence` | Realised > 1.5× modelled for 30 days → stop |
| `kill.unexplained_divergence` | Live-vs-backtest divergence unexplained for 2 weeks → stop |
| `kill.single_incident` | Any incident losing > 5% of equity → stop |
| `kill.repeat_root_cause` | Two SEV1s from the same root cause → stop; the post-mortem process is broken |
| `kill.sharpe_floor` | Live Sharpe < 0.5 after 90 days at Phase 4 → **investigate**, not an automatic verdict (Annex C §5) |

The last row is the one place where a kill criterion is softened rather than tightened relative to
v1.0, and for the same reason the Phase 4 Sharpe gate was removed: at 90 days the measurement cannot
carry the weight of the decision. The drawdown criterion above it is the hard one, because a
drawdown beyond the Monte Carlo expectation says the risk model is wrong, and that conclusion does
not require a long sample.
