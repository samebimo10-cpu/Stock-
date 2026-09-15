# Quickstart

Ten minutes from a clone to a system connected to Binance testnet, generating
orders and sending none of them.

Read [`ops/runbooks/live-connection.md`](ops/runbooks/live-connection.md) before
you point it at production. It is two pages and it is the difference between a
wasted afternoon and a lost position.

---

## 1. Install

```bash
cd crypto
python3 -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
```

Python 3.10 or newer. The only runtime dependency is PyYAML — no HTTP client,
no WebSocket library, no numpy. That is deliberate: every failure path in this
system is testable offline, and the failure paths are the ones a live venue
will not reproduce on demand.

## 2. Prove it works before it touches anything

```bash
tradesys doctor        # preflight: python, limits, credentials
tradesys selfcheck     # 15 machine-checkable specification gates
tradesys chaos         # inject each failure, assert the guarantee holds
pytest -q              # 782 tests
```

`tradesys chaos` is the one worth watching. It kills the feed mid-order, drops
the risk service, fills an order twice, and asserts what the system does about
each. Run it quarterly and after any change to risk or execution — a chaos
suite that ran once, a year ago, tests a system that no longer exists.

## 3. See it trade, offline

```bash
tradesys strategies    # all five strategies, predicted cost share vs measured
tradesys viability     # the arithmetic that chose them
tradesys demo          # the funding carry strategy through the full pipeline
tradesys session       # the same, with the startup gate and reconciliation
```

`tradesys strategies` is the one to read first. It prints what each strategy
*claims* about its own economics next to what it actually measured, because a
prediction that disagrees with a measurement is the only part that teaches
anything — and it tells you plainly that none of it is evidence the strategies
make money.

`tradesys validate` exits 1. That is the correct outcome, not a broken build:
nothing here has passed validation, and the harness reports INCONCLUSIVE rather
than computing a Sharpe ratio from four trades.

## 4. Set your risk limits

```bash
tradesys limits                                   # what is in force, and from where
tradesys limits --export risk/limits.yaml         # an editable copy
export TRADESYS_LIMITS=$PWD/risk/limits.yaml
tradesys limits                                   # confirm it is now the one in force
```

Every limit has declared bounds and a value outside them refuses to load. That
is aimed at one specific mistake: a `0.2` where `0.02` was meant, made at 3am,
loading cleanly.

## 5. Get keys

On [testnet.binance.vision](https://testnet.binance.vision) (spot) or
[testnet.binancefuture.com](https://testnet.binancefuture.com) (futures).

```bash
export BINANCE_API_KEY=...
export BINANCE_API_SECRET=...
tradesys doctor --network      # reachability and clock drift
```

**When you eventually make production keys:**

- Trading enabled. **Withdrawals disabled. Always, no exception.** A leaked key
  with withdrawal rights is a total and instant loss. The signing service in
  this repository refuses to hold a key that claims withdrawal permission and
  refuses to sign a withdrawal endpoint regardless of what the key permits —
  but that is the last line, not the first.
- IP-allowlisted. An unrestricted key's Spot & Margin permission expires after
  90 days; an allowlisted one does not.
- In your environment or a secrets manager. Never in the repository, never in a
  committed `.env`, never on a command line. There is no flag to pass a secret
  to this system, on purpose: a secret on a command line is in your shell
  history and in every process listing on the box.

## 6. Connect

```bash
tradesys live --dry-run        # prints the wiring, connects to nothing
tradesys live --mode read_only # real feeds, no strategy enabled
tradesys live                  # shadow: orders recorded, never sent
```

The default is **Binance testnet in shadow mode**. The four modes are
[SPEC §17.5](SPEC.md#175-live-testing-sequence)'s rollout ladder, and each step
removes exactly one unknown:

| Mode | Feeds | Orders | Removes |
|---|---|---|---|
| `read_only` | real | none; strategies disabled | whether the data path works |
| `shadow` | real | recorded locally | whether the whole system works |
| `paper` | real | to the simulator, priced off the real book | whether the fill model is sane |
| `live` | real | **to the venue** | whether the venue agrees |

`--mode live --production` is refused without `--confirm-live`.

Skipping a step does not save the time it would have taken. It moves the
discovery into the step where money is at stake.

## 7. Watch

```bash
tradesys session               # state, indicators, pages
tradesys verify-audit <path>   # the hash-chained log, verified
```

Four numbers matter while it runs, and the runbook says what each means when it
moves: `sequence_gaps`, `feed_staleness_ms`, `reconciliation_cycles`, and
`drawdown`.

---

## 8. The actual next step

Everything above proves the machine works. None of it produces a strategy worth
trusting, because there is no data.

```bash
tradesys capture --production --futures --out /var/lib/tradesys/archive \
    --symbols BTCUSDT,ETHUSDT
```

Leave it running for three months under a supervisor. Then:

```bash
tradesys archive --root /var/lib/tradesys/archive --verify
tradesys validate --from-archive /var/lib/tradesys/archive
```

[`ops/runbooks/getting-to-validated.md`](ops/runbooks/getting-to-validated.md)
is the full plan with the gates, the timings and what to do when each one
fails. Read it before starting, not during.

## Before real money

Nothing here is ready for it, and the blockers are specific rather than vague:

1. **`tradesys validate` exits 1.** No strategy has passed the §11.2 protocol.
2. **The carry strategy spends ~69% of gross on costs** against a 40% gate.
   `tradesys viability` says what would have to change: 0.024% funding per 8h
   sustained for seven days at tier 0, against a 0.01% baseline.
3. **§17.5's first three steps take six to twelve weeks** and have not been run.
4. **The §15 scaling gates** should be agreed in writing *before* there is money
   at stake and an incentive to move them.

The engineering is done. The research is not, and no amount of the first
substitutes for the second.
