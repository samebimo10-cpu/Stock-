# Annex C — Validation arithmetic

Companion to [SPEC.md](../SPEC.md) §11.2 and §15.1. v1.0 names these procedures correctly and gives
no formulas, which means each team implements a different thing under the same name.

---

## 1. Why this annex is the important one

SPEC §19 states that well-funded teams fail in validation more often than in engineering. The
mechanism is specific and worth stating plainly: a research process generates hundreds of candidate
strategies, keeps the ones with the best backtests, and reports the winner's Sharpe as though it
were the only one tried. The selection itself manufactures the result.

Every procedure here exists to price that selection.

---

## 2. Deflated Sharpe ratio

**Problem.** After `N` trials, the best observed Sharpe is high *by construction*, even when every
strategy is worthless. The expected maximum of `N` draws from a zero-mean distribution grows with
`N`, so "our best of 500 backtests has Sharpe 2.0" is a statement about 500, not about the strategy.

**Expected maximum Sharpe under the null** (Bailey & López de Prado), with `V` the variance of
Sharpe estimates across trials and `γ ≈ 0.5772157` the Euler–Mascheroni constant:

```
SR₀ = sqrt(V) × [ (1 − γ) · Z⁻¹(1 − 1/N)  +  γ · Z⁻¹(1 − 1/(N·e)) ]
```

**Deflated Sharpe**, adjusting the observed Sharpe for both selection and the non-normality of the
return distribution:

```
                 ( SR_obs − SR₀ ) · sqrt(T − 1)
DSR = Φ ( ─────────────────────────────────────────────── )
           sqrt( 1 − γ₃·SR_obs + ((γ₄ − 1)/4)·SR_obs² )
```

- `T` — number of return observations
- `γ₃` — skewness of returns, `γ₄` — kurtosis
- `Φ` — standard normal CDF
- `Z⁻¹` — standard normal inverse CDF

`DSR` is the probability that the true Sharpe exceeds zero, given how many trials it took to find
this one.

**HARD REQUIREMENT: DSR > 0.95 before a strategy proceeds to paper trading.**

The skew and kurtosis terms are not decoration. A strategy with negative skew and fat tails — which
describes carry, market making, and every strategy that earns steadily and loses suddenly — is
penalised, correctly, because its Sharpe is a worse estimate of its future than a symmetric
strategy's would be.

### 2.1 The trial count

`N` comes from the trial registry (SPEC §11.3), automatically. Not from memory.

Every backtest counts, including ones abandoned after five minutes, ones on a parameter you
"already knew" would fail, and ones run by a colleague on the same idea. Researchers' self-reported
trial counts are consistently low by an order of magnitude, not from dishonesty but because a
failed experiment does not feel like a trial. **This is why the registry is written by the harness
and the harness refuses to start without it.**

### 2.2 Probability of backtest overfitting

As a cross-check, run CSCV (combinatorially symmetric cross-validation): split the sample into `S`
even blocks (S = 16 is standard), form all `C(S, S/2)` train/test partitions, and for each one find
the configuration that is best in-sample, then record its out-of-sample rank.

```
PBO = P( the in-sample-best configuration ranks below median out-of-sample )
```

**PBO above 0.5 means the selection procedure is worse than choosing at random.** Report it
alongside DSR; they catch different failures, and a strategy passing DSR while failing PBO is one
whose whole parameter family is noise.

---

## 3. Purged K-fold with embargo

Standard cross-validation leaks in time series, because a sample's label depends on data that
overlaps the neighbouring folds. Two corrections, both required:

**Purge.** Remove from the training set every sample whose evaluation window overlaps the test
set's window. For a strategy holding positions for `h`, purge `h` on both sides of each test fold.

**Embargo.** After each test fold, exclude a further `e` of training data. Serial correlation means
the sample immediately after the test fold still carries information from it. Set `e ≈ 0.01 × T`,
or one holding period, whichever is larger.

```
 train      purge   TEST    purge  embargo       train
├────────┤├───────┤├──────┤├──────┤├───────┤├──────────────┤
```

Without purge and embargo, a strategy holding positions for four hours, evaluated on hourly data,
sees roughly four hours of its own test-set outcomes inside the training set — enough to produce a
convincing and entirely fictitious result.

---

## 4. Live-vs-backtest divergence test

Used at the SPEC §15 phase gates and by the auto-disable limit in SPEC §8.2.

The sampling variance of a Sharpe estimate over `T` observations (iid normal returns):

```
Var(SR) ≈ (1 + SR²/2) / T
```

Comparing live Sharpe to backtest Sharpe over the same period:

```
z = ( SR_live − SR_backtest ) / sqrt( Var(SR_live) + Var(SR_backtest) )
```

**The gate is one-sided.** Live outperforming backtest is not evidence of health — it usually means
a cost is unmodelled and is currently helping. Flag both directions; gate on the downside.

| `z` | Interpretation | Action |
|---|---|---|
| > −1.0 | Consistent | Continue |
| −1.0 to −2.0 | Watch | Investigate, no action |
| **< −2.0** | **Divergence** | **Auto-disable strategy** (SPEC §8.2) |
| > +2.0 | Suspicious outperformance | Investigate the cost model |

This is the test behind SPEC §15.1's honest Phase 4 gate: not "is live Sharpe above 1.5", which 90
days cannot answer, but "is live Sharpe inconsistent with the backtest", which it can.

---

## 5. Statistical power — how long until you know anything

The t-statistic of an observed Sharpe over `T` years is approximately `SR × √T`. Setting that to
1.96 gives the time to significance:

```
T_years = (1.96 / SR)²
```

| True Sharpe | Years | Months |
|---|---|---|
| 0.5 | 15.4 | 184 |
| 1.0 | 3.84 | 46 |
| 1.5 | 1.71 | 21 |
| 2.0 | 0.96 | 12 |
| 2.5 | 0.61 | 7 |
| 3.0 | 0.43 | 5 |

**Read this table before every conclusion drawn from live results.** At the §1.2 minimum Sharpe of
1.5, a verdict takes 21 months. At 90 days, `t ≈ 0.75`, and the observed Sharpe could plausibly
land anywhere between roughly −1 and +4 with the strategy unchanged.

Two consequences the spec acts on:

1. **A good quarter is not evidence and a bad quarter is not evidence.** Both are consistent with
   the same strategy. Scaling on the first and killing on the second is responding to noise twice.
2. **Phase gates must measure what is measurable at their duration** (SPEC §15.1): correctness,
   incident count, cost-model accuracy, and consistency with the backtest. Not profitability.

### 5.1 Expectancy confidence interval

For the per-trade expectancy gate in SPEC §1.2, bootstrap rather than assume normality: resample
trades with replacement 10,000 times, compute expectancy each time, take the 2.5th and 97.5th
percentiles.

**Scaling requires the lower bound above zero**, not the point estimate. A point estimate above zero
with a lower bound below it describes a strategy that has not yet demonstrated an edge.

---

## 6. Monte Carlo on trade sequence

Observed maximum drawdown is a single realisation of a random ordering. The same trades in a
different order produce a different, equally real drawdown.

```
for i in 1..10_000:
    shuffled = resample(trades, replace=False)     # reorder, same trades
    equity   = cumulative(shuffled)
    record max_drawdown(equity), final_return(equity)
report 5th percentile drawdown, 5th percentile return
```

**Size against the 5th-percentile drawdown, not the observed one** (SPEC §11.2 item 6). The
observed path was lucky in ways you cannot count on.

Also run a **block bootstrap** (blocks of 5–20 trades) alongside the plain shuffle. Plain shuffling
destroys serial correlation, and serial correlation is exactly what produces the bad runs that
matter. If the block bootstrap's 5th-percentile drawdown is much worse than the plain shuffle's,
the strategy's losses cluster — which changes how it must be sized, and is invisible in the
observed equity curve.

The kill criterion in SPEC §15.2 refers to this number: a live drawdown exceeding 1.5× the
5th-percentile expectation means the risk model is wrong, and therefore every position size in the
system is wrong.

---

## 7. Regime testing

Partition history into regimes and evaluate separately. Define regimes **mechanically**, not by
eye, so the partition is reproducible:

| Regime | Definition |
|---|---|
| Bull trending | 30d return > +10% and trailing vol below its median |
| Bear trending | 30d return < −10% and trailing vol below its median |
| Chop | abs(30d return) < 10% |
| High volatility | trailing 30d realised vol in the top quintile of its 2-year distribution |
| Crisis | drawdown from 90d high > 30% |

Report Sharpe, drawdown and trade count per regime. **A regime with fewer than 30 trades yields no
conclusion** — say so rather than reporting a Sharpe computed from eight trades.

A strategy that works in one regime needs a regime filter, and the filter needs its own validation
including its behaviour at regime boundaries, which is where filters fail: the transition is
detected late, and the detection lag is when the strategy is most exposed.

---

## 8. Validation report — required before any go/no-go

One document per strategy, generated by the harness, not written by hand:

```
Strategy, code hash, data range, feature versions
Trial count (from the registry)         N =
Observed Sharpe (net of §11.1 costs)    SR_obs =
Deflated Sharpe                         DSR =            [gate: > 0.95]
Probability of backtest overfitting     PBO =            [gate: < 0.50]
Walk-forward: per-window Sharpe table, and the consistency across windows
Purged CV: per-fold results, purge and embargo parameters used
Monte Carlo: 5th-pct drawdown, 5th-pct return, block-bootstrap comparison
Parameter sensitivity: surface plot; plateau width at 80% of peak performance
Regime table: Sharpe / drawdown / trade count per regime
Cost sensitivity: results at 1.0×, 1.5×, 2.0× modelled costs
Data-quality sensitivity: results excluding amber days
Capacity estimate with the binding constraint named
HOLDOUT RESULT                          [recorded ONCE, with the access-log entry]
```

The holdout line is written once and never rewritten. A second holdout evaluation for the same
strategy is a process failure, visible in the access log (SPEC §11.3), and the strategy that
prompted it does not proceed.
