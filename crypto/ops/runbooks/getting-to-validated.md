# Runbook: from nothing to a validated strategy

**Not an incident.** This is the plan, and it is the only path from where this
system is now to a strategy that should be trusted with money.

It takes **six to nine months**, and most of that is waiting for data to
accumulate. That is not a failure of planning. It is the cost of the one thing
that cannot be shortened: a strategy is validated against data it has never
seen, and data it has never seen has to be collected before it can be used.

---

## Where this system actually is

| | |
|---|---|
| Engineering | Done. 762 tests, 15 self-check gates, 13 chaos scenarios. |
| Connectivity | Done. Connects to Binance, testnet and shadow by default. |
| Strategies | Five written. Three clear the cost gate **on arithmetic**. |
| Data | **None.** |
| Validation | **None.** `tradesys validate` exits 1. |

Every strategy is unvalidated for exactly one reason: there is no archived
market data to validate against. Everything below is about fixing that.

---

## Phase 0 — prove the capture runs (1 week)

Testnet, because the only question is whether the process survives a week.

```bash
tradesys doctor --network
tradesys capture --futures --out ~/archive-test --symbols BTCUSDT
```

Leave it running for seven days. Then:

```bash
tradesys archive --root ~/archive-test --verify
```

**Gate:** seven consecutive days, every checksum intact, no gap in the daily
partitions. If a day is missing, find out why *now* — a gap you tolerate in
week one is a gap you will find in month five, in the data you were relying on.

**Do not skip to Phase 1 to save a week.** The failures this catches — a
process killed by the OOM killer, a disk that filled, a laptop that slept, a
connection that never recovered from a reconnect — all take days to appear and
all destroy months of collection if they appear in Phase 1 instead.

Testnet data is **not** research data. Its book is thin and its flow is
synthetic. This phase tests the process, not the data.

---

## Phase 1 — collect (3–6 months, unattended)

Production, read-only, no keys with trading rights needed for market data.

```bash
tradesys capture --production --futures \
    --out /var/lib/tradesys/archive \
    --symbols BTCUSDT,ETHUSDT,SOLUSDT
```

Run it under a supervisor that restarts it — `systemd` with
`Restart=always`, or equivalent. The archive is write-once and partitioned by
hour, so a restart opens a new part file and loses nothing but the buffer.

**`--futures` is not optional** if you want the carry, dispersion or cascade
strategies. Spot has no funding and no liquidation stream, and a forced sale
looks exactly like a voluntary one in the trade feed — so if `forceOrder` is
not captured, the cascade strategy's only input cannot be reconstructed from
anything else, ever.

**Sizing.** `tradesys capture` prints an extrapolated daily figure after the
first hour. Expect roughly 1–3 GB/day per symbol at 100ms depth. Budget for
double, and set `min_free_bytes` above the point where the box would be in
trouble — a capture that fills the volume takes the whole machine down,
unattended, at three in the morning.

**Weekly, for three months:**

```bash
tradesys archive --root /var/lib/tradesys/archive --verify
```

Five minutes. It is the difference between discovering corruption in week two
and discovering it in month five.

**Gate:** 90 consecutive days minimum. SPEC §11.2 requires 30 days of green
data as a floor; 30 days is a floor, not a target, and a trend strategy holding
for weeks needs many multiples of its own holding period before the sample
contains anything.

### While you wait

This is dead time for the data and it is not dead time for you.

1. **Run `tradesys live --mode read_only` in parallel** on a second process.
   It validates the *decoding* path against real feeds — gap rates, staleness,
   clock drift — which the capture alone does not exercise.
2. **Write down the §15 scaling gates**, in full, and agree them with anyone
   whose money is involved. Do it now, while there is nothing at stake and no
   incentive to move them. This is the single highest-value hour in the whole
   plan.
3. **Read the strategy specifications and argue with them.** Each states a hit
   rate, an average winner and an average loser, written down before any
   result. Those are the numbers the data will confirm or destroy, and the
   arguing is cheaper before than after.

---

## Phase 2 — validate (2–4 weeks)

```bash
tradesys validate --from-archive /var/lib/tradesys/archive \
    --venue binance-futures
```

It refuses below 30 days of span, and it should.

**What it runs** (SPEC §11.2): purged K-fold with an embargo, a deflated Sharpe
that divides by every trial the registry recorded, PBO via CSCV, Monte Carlo
and block bootstrap, statistical power, and cost sensitivity at 1.5× and 2×.

**Three verdicts, and only one of them is "no".**

- **PASS** — proceed to Phase 3. Rare, and treat it with suspicion the first
  time.
- **INCONCLUSIVE** — not enough data or not enough trades. This is a
  *non-passing* verdict and it is not a fail: collect more and re-run. It is
  the most likely outcome at 90 days for a trend strategy that trades 14 times
  a year.
- **FAIL** — the strategy does not work. Retire it and say so in its
  specification.

**The holdout is readable once.** The store enforces it. There is no second
look after a tweak, because the second look is the one that produces a number
you cannot trust and cannot un-see.

**Expect to fail here, and expect it to be the right answer.** SPEC §12 says
most attempts fail in validation rather than in engineering. Nothing built in
the last few months changes that base rate; it only means a failure here is a
failure for a reason you can name.

---

## Phase 3 — the live ladder (6–12 weeks)

SPEC §17.5, and each step removes exactly one unknown.

```bash
tradesys live --mode read_only                    # weeks 1–2: the data path
tradesys live --mode shadow --production          # weeks 3–6: the whole system
tradesys live --mode paper --production           # weeks 7–8: the fill model
tradesys live --mode live --production --confirm-live   # micro-live, $5–10k
```

Before the last line: keys with **trading enabled, withdrawals disabled, IP
allowlisted**, and `ops/runbooks/live-connection.md` read end to end.

**At micro-live the question is not "did it make money."** At $5–10k noise
dominates completely and a profitable month means nothing. The question is
**"did it behave exactly as specified, with zero incidents"** — every order
where expected, every reconciliation clean, every kill switch untriggered or
triggered correctly.

Thirty days. Then §15's gates, which you wrote down in Phase 1 and do not get
to renegotiate now.

---

## What to do when a phase fails

| Failure | What it means | What to do |
|---|---|---|
| Capture stops repeatedly | Infrastructure, not strategy | Fix it in Phase 0. It will not fix itself in Phase 1. |
| Archive checksum fails | Corruption, probably disk | Stop, replace the hardware, restart collection. Do not patch around it. |
| Validation INCONCLUSIVE | Not enough data | Collect more. This is the normal outcome, not a setback. |
| Validation FAIL | The edge is not there | Retire the strategy. Record why in its specification. |
| Shadow mode diverges from backtest | The backtest was wrong | Back to Phase 2, with the divergence as the thing to explain. |
| Micro-live has an incident | The system, not the strategy | Post-mortem with a test (SPEC §10.5). Restart the 30 days. |

---

## The honest summary

Nine months from today, the most likely outcome is **one strategy that survives
validation, or none**. That is what the base rate says, and this system is
built to find out cheaply rather than to make it more likely.

What it does guarantee is that you will know which, and why, and that finding
out will not have cost you a position you could not explain.
