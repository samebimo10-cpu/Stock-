# Strategy specification: time-series momentum

**Status:** research. Never run against real data.
**Strategy ID:** `trend`
**Code:** [`src/tradesys/layers/l3_strategy/trend.py`](../../src/tradesys/layers/l3_strategy/trend.py)

## 1. The claim

Instruments that have gone up keep going up, and those that have gone down keep
going down, over horizons of weeks to months. Long the strong, short the weak,
sized so each position contributes the same risk.

## 2. Why it might be real

Time-series momentum is the most durable documented anomaly across every asset
class anyone has looked at — equities, bonds, commodities, currencies — and
crypto is the friendliest case: retail-dominated, reflexive, and levered in a
way that mechanically forces continuation when positions are liquidated in the
direction of the move.

It is not a secret and it is not an edge over a prop desk. It is a **risk
premium**, and the reason it persists is that holding it through its drawdowns
is genuinely unpleasant. That is simultaneously the reason to expect it to keep
paying and a warning about what running it feels like.

## 3. Why it clears the cost gate

This is the part that decided to build it first, and it is arithmetic rather
than forecasting:

| | |
|---|---|
| Fills per round trip | 2 (one leg, in and out) |
| Legs that cross | 0 on entry; the stop crosses |
| Round-trip cost at tier 0 | 0.08% of notional |
| Expected gross per trade | 1.6% (35% × 12% − 65% × 4%) |
| **Cost share of gross** | **5.0%** against a 40% gate |

It would still clear at ten times the cost. Compare the funding carry strategy,
whose gross accrues in basis points per eight hours against the same fixed
round trip.

## 4. Rules

**Entry.** `ewmac` (volatility-normalised 8/32 EWMA crossover) beyond ±1.0,
**and** `breakout_position` agreeing in sign. The second condition exists
because a crossover can be positive while price sits in the bottom half of its
recent range — a retracement inside a trend that has already turned, which is
the most expensive entry available.

**Sizing.** Position notional is whatever makes the instrument's annualised
volatility equal 20%, capped at 18% of the strategy budget. The cap is not
belt-and-braces: volatility targeting divides by volatility, and a quiet
fortnight — the most common shape of the run-up to a shock — produces a
position several times anything in the backtest.

The cap is deliberately below the 25% `asset_concentration` limit. A strategy
that sizes exactly to a risk limit arrives at the risk service asking to be
reduced on every entry, and a reduction on every order makes the limit's
alerting useless.

**Exit.** `ewmac` decaying back inside ±0.3, or the stop.

**Stop.** 2.5 standard deviations over the *holding horizon* — the per-bar
range scaled by `sqrt(32)`. This is a disaster stop for gaps and crashes, not a
trading stop. See §7.

**Sizing is set once, at entry.** No continuous rebalancing to target
volatility: each adjustment pays a round trip and the adjustments are noise.

## 5. Risk profile

- **Hit rate around 35%.** Long flat stretches with steady small losses are the
  normal state, not a malfunction.
- **The money is in the tail.** A stop tight enough to feel comfortable cuts
  the winners that pay for everything.
- **Worst case is a violent reversal from an extended trend**, which is where
  the stop and the `asset_concentration` limit both earn their keep.

## 6. Measured

`tradesys strategies`, against a synthetic chop-rally-reversal scenario:

| | |
|---|---|
| Round trips | 9 |
| Gross / net | 621.45 / 603.28 on 100,000 |
| **Cost share** | **2.9%** against a predicted 5.0% |

**This is not evidence that the strategy makes money.** The scenario contains
a trend because the author put one there. What it does establish is the cost
structure, because the fills are real fills priced through the same cost model
the simulated venue uses — and that the code does what this document says.

## 7. What the build found

**A stop measured in per-bar ATR is not a stop for a position held for weeks.**
The first version used "4 × ATR", which on hourly data produced a 0.18% stop.
Noise cleared it within an afternoon, every position was stopped out, and the
strategy looked broken. The signal was fine; the stop was measured in the wrong
units. The fix is square-root-of-time scaling to the holding horizon, and the
general rule is that **a stop distance is only meaningful at the horizon the
position is held for**.

**The risk service was sizing every strategy as though it had no stop.**
`RiskContext.stop_distance_frac` was declared, checked, and unit-tested, and
nothing in the running system populated it — so the per-trade risk check used
its conservative default of "the whole notional is at risk" for every strategy,
including those with stops. It surfaced only when a strategy arrived whose
sizing was large enough for the 2% limit to bite. A control that is never
exercised is a control whose wiring nobody has checked.

## 8. Kill criteria

Fire on **behaviour diverging from the backtest**, never on a losing month — a
losing month is this strategy working as specified.

1. Hit rate outside 20–55% over 50 trades.
2. Average winner below 2× average loser over 50 trades.
3. Realised volatility of the strategy's own returns more than 2× the target.
4. `backtest_divergence_z` below −2.

## 9. Monitoring

`ewmac` distribution, entries per month, hit rate and win/loss ratio on a
rolling 50 trades, realised vs target volatility, and the veto counters —
`warming_up`, `no_trend`, `disagreement`, `no_vol` — which answer "why has it
not traded for three weeks" without anyone adding logging during the incident.

## 10. Before any capital

Everything in §6 is synthetic. This needs years of archived data, the full
§11.2 protocol including purged cross-validation and a deflated Sharpe, and the
§17.5 rollout. `tradesys validate` exits 1 until it has them.
