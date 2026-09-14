# Annex B — Cost model and sizing arithmetic

Companion to [SPEC.md](../SPEC.md) §11.1 (cost model), §8.1 (sizing) and §7.1 (allocation). v1.0
named these concepts; this annex is the arithmetic.

Notation: prices and quantities are decimals, `bps` = basis points = 0.01%.

> Fee figures below are worked examples using published Binance tier-0 rates and are marked where
> they must be re-verified. Fee schedules change; the model reads the **actual** tier from the
> adapter (`fee_schedule()`, Annex A §5), never a constant in code.

---

## 1. Fees

```
fee(order) = notional × rate(venue, instrument, tier, is_maker) × (1 − bnb_discount)
```

- `tier` is the account's **current** 30-day-volume tier, and it must be re-read daily. A backtest
  that assumes a tier the account will not reach for six months overstates results in exactly the
  period that decides whether the project continues (SPEC §11.1).
- `bnb_discount` = 0.25 on Binance spot when fees are paid in BNB. Holding BNB is then itself a
  position with price risk, and that risk belongs in the book (SPEC §12.1) rather than being
  treated as free.

**Tier decay.** Model the tier as a function of trailing volume, not as a constant:

```
tier(t) = tier_for(volume_30d(t))
```

A strategy whose viability depends on reaching a tier must show the volume path that gets there, and
the path's cost at the lower tier along the way.

---

## 2. Slippage from real book depth

Never a flat percentage. Walk the recorded book:

```
def slippage_cost(book_side, quantity, reference_price):
    filled, cost = 0, 0
    for level_price, level_qty in book_side:          # best price first
        take = min(level_qty, quantity - filled)
        cost += take * level_price
        filled += take
        if filled >= quantity:
            break
    if filled < quantity:
        return UNFILLABLE                 # a real outcome; do not silently fill the remainder
    avg_price = cost / quantity
    return abs(avg_price - reference_price) * quantity
```

`UNFILLABLE` must propagate. A backtester that fills the remainder at the last level's price is
modelling infinite liquidity at the worst moment, which is precisely the moment the strategy needs
the truth.

Use the book **as of the decision timestamp**, not the fill timestamp (SPEC §5.3).

---

## 3. Market impact

Your own order moves the book. The square-root law is the standard starting point:

```
impact_bps = Y × σ_daily_bps × sqrt(Q / V_daily)
```

- `Q` — order quantity, `V_daily` — daily volume in the same units
- `σ_daily_bps` — daily realised volatility in bps
- `Y` — a venue/asset constant, calibrated from your own fills, typically 0.3–1.0

**Calibrate `Y` from your own TCA data** (SPEC §9.6) rather than adopting a literature value. Until
you have fills, use `Y = 1.0`, which is pessimistic. Being pessimistic before you have data is how
you avoid deploying on an assumption.

Permanent versus temporary impact matters for anything held less than a day: temporary impact
decays, permanent does not. For strategies with sub-daily holding periods, model both, because a
round trip pays temporary impact twice and permanent impact once.

---

## 4. Funding carry — the arithmetic that decides entry

For the Tier 1 strategy of SPEC §2.1: long spot, short perp, collect funding.

Binance settles perpetual funding every 8 hours, so three settlements per day:

```
annualised_funding_rate = f_8h × 3 × 365
```

`f_8h = 0.01%` (a common baseline) annualises to **10.95%**. That is the headline. The headline is
not the strategy.

### 4.1 Net carry

```
net_carry = funding_received
          − entry_cost(spot) − entry_cost(perp)
          − exit_cost(spot)  − exit_cost(perp)
          − borrow_cost
          − basis_convergence_pnl        (signed; can help or hurt)
```

### 4.2 Break-even holding period

The number that decides whether to enter at all:

```
n_periods_to_breakeven = round_trip_cost / f_8h
```

Worked example at tier 0 (**verify current rates**): spot taker 0.10%, USD-M futures taker 0.05%.

```
round_trip_cost = 0.10% + 0.10%   (spot in, spot out)
                + 0.05% + 0.05%   (perp in,  perp out)
                = 0.30%
```

| `f_8h` | Annualised | Periods to break even | Days |
|---|---|---|---|
| 0.01% (baseline) | 11% | 30 | **10.0** |
| 0.03% (elevated) | 33% | 10 | **3.3** |
| 0.10% (extreme) | 110% | 3 | **1.0** |
| −0.01% (negative) | — | never — the trade pays you to be on the other side | — |

**Three conclusions that should shape the strategy before any code is written:**

1. At baseline funding, tier 0 fees require a **ten-day hold** just to break even. Any strategy that
   enters and exits on a two-day funding excursion loses money at tier 0 while appearing to collect
   funding the whole time.
2. Entry threshold is not a funding level, it is a funding level **relative to your fee tier**. The
   same strategy is viable at one tier and negative at another, which is why SPEC §6.1 requires the
   assumed tier in the strategy spec.
3. Using maker orders on entry changes this materially. Adding a maker-entry path is worth more to
   this strategy than almost any signal improvement.

### 4.3 Liquidation distance on the short perp leg

The short perp leg can be liquidated by an upward move even though the position is market-neutral in
economic terms, because the legs sit in different margin accounts.

```
liq_distance_pct = (liquidation_price − mark_price) / mark_price
```

Monitored continuously; auto-deleverage below 25% (SPEC §8.2). **Being delta-neutral is not
protection against liquidation**, and this is the most common way a "market-neutral" carry book
takes a large loss.

---

## 5. Market-making break-even — run this before writing the strategy

Per round-trip fill, for a maker quoting both sides:

```
edge_per_round_trip = spread_captured − adverse_selection − 2 × maker_fee
```

where `maker_fee` is negative if the tier pays a rebate.

**Adverse selection** is the cost of being filled preferentially just before the price moves against
you. Estimate it from data as the mean signed price move over the horizon `h` following your fills:

```
adverse_selection_bps = mean( side_sign × (mid(t_fill + h) − fill_price) / fill_price ) × 10_000
```

with `h` set to the strategy's typical inventory holding time. **This number is always positive for
a naive maker.** If your estimate is zero or negative, the estimator is wrong, not the market.

### 5.1 Worked example: why tier matters more than the model

BTC perp, typical spread ~1 bp, so a maker capturing half the spread earns ~0.5 bp per side.
At USD-M futures tier 0 (**verify current rates**), maker fee ≈ 2 bps:

```
edge = 0.5 bp (capture) − 1.5 bp (adverse selection, illustrative) − 2 × 2 bp (fees)
     = −5.0 bp per round trip
```

**Negative before any inventory risk, any latency disadvantage, and any competition.** No amount of
quoting sophistication repairs a fee structure that costs four times the spread you are capturing.

This is the quantitative form of SPEC §2.2: market making requires a fee tier where the maker side
approaches zero or pays a rebate, and reaching such a tier requires volume that requires capital.
It is why **[A] Track A does not build this** — not because it is difficult, but because it is
arithmetically negative at the tier Track A can reach.

### 5.2 Queue position

For a maker strategy, queue position is the strategy. Fill probability for a resting order:

```
P(fill) ≈ P(volume traded at this level > quantity ahead of me before the price moves away)
```

The backtester must track, per resting order: quantity ahead at placement, cancellations ahead
(which promote you), and volume traded at the level. **A maker backtest that fills whenever the
price touches your level overstates fill rates by a factor of 2–5x**, and does so in the favourable
direction, because you fill on every touch that goes your way and none of the queue positions that
did not reach you.

---

## 6. Risk-parity allocation (SPEC §7.1)

Given strategy weights `w`, volatilities, and covariance matrix `Σ`:

```
σ_p  = sqrt(wᵀ Σ w)                     portfolio volatility
MRC  = (Σ w) / σ_p                      marginal risk contribution, per strategy
RC_i = w_i × MRC_i                      risk contribution; these sum to σ_p
```

Equal risk contribution solves for `w` such that `RC_i = σ_p / N` for all `i`. The convex
formulation:

```
minimise   Σ_i ( RC_i − σ_p/N )²
subject to Σ w_i = 1,  0.05 ≤ w_i ≤ 0.40,  gross exposure ≤ limit
```

with a turnover penalty `λ × Σ|w_i − w_i_prev|` so the allocator does not churn the book chasing
estimation noise. Set `λ` so that a re-allocation must be worth more than its own transaction cost.

`Σ` is the shrunk, stress-biased estimate of SPEC §7.2: Ledoit–Wolf shrinkage toward constant
correlation, taking the element-wise maximum of the 60-day and 20-day estimates, with a floor of
0.5 correlation on any pair with fewer than 60 joint observations.

---

## 7. Position sizing (SPEC §8.1)

### 7.1 Fractional Kelly — directional and stat-arb

For a strategy with per-period expected return `μ` and variance `σ²`:

```
f_kelly    = μ / σ²
f_used     = 0.25 × (μ_lower_95 / σ²)
```

**`μ_lower_95` is the lower bound of the 95% confidence interval on the edge, not the point
estimate.** This is the correction that keeps Kelly usable: an edge of 2 bps with a standard error
of 1.5 bps has a lower bound near zero and therefore sizes near zero, which is the right answer
for an edge you have not actually established.

Why a quarter: if the true edge is half your estimate, quarter-Kelly still grows the account, while
half-Kelly sits at the ruin boundary. You are not choosing between optimal and cautious — you are
choosing between growth and ruin under an estimate you know is wrong.

### 7.2 Volatility targeting — all classes

```
size = base_size × (target_vol / max(realised_vol, vol_floor))
```

**`vol_floor` is mandatory.** Without it, as realised volatility approaches zero the multiplier goes
to infinity and the system takes its largest position immediately before the quiet period ends. Set
the floor at roughly the 10th percentile of the trailing annual volatility distribution.

Cap the multiplier at 3× regardless of the formula.

### 7.3 Conditional-loss sizing — fat-tailed strategies

For liquidation positioning and anything with a fat left tail:

```
size = (0.01 × equity) / CVaR_99_per_unit
```

where `CVaR_99_per_unit` is the mean loss per unit conditional on being in the worst 1% of
outcomes, estimated **from the mechanism, not from the sample**. A sample of 200 trades contains
roughly two tail events, which is not enough to estimate a tail. Ask instead what happens if the
cascade runs 3× further than any in your data, and size for that.

### 7.4 Correlation-adjusted limits

Two positions each at the 2% cap with correlation ρ have combined risk:

```
σ_combined = sqrt(σ₁² + σ₂² + 2ρσ₁σ₂)
```

At ρ = 0.9, two 2% positions carry the risk of a single 3.9% position — nearly double the intended
exposure while both individual limits report green. Positions are therefore grouped into correlation
clusters (ρ > 0.7), and **the 2% cap applies to the cluster**, not to its members.

---

## 8. Putting the cost model together

The backtester's per-trade cost:

```
total_cost = fee(entry) + fee(exit)
           + slippage(entry) + slippage(exit)        # from real book depth, §2
           + impact(entry)  + impact(exit)           # §3
           + adverse_selection (maker fills only)    # §5
           + funding_paid − funding_received         # at actual settlement times, §4
           + borrow_cost                             # including unavailability
           + rejected_order_opportunity_cost         # the trade you did not get
```

**The review test (SPEC §11.1):** if adding this model does not reduce backtest returns by at least
30%, something in the list is missing or mis-parameterised. Find it before concluding the strategy
is unusually cheap to run.

**The calibration loop (SPEC §9.6):** every week, compare modelled cost against realised cost from
TCA, per strategy. Divergence above 20% halts research until the model is corrected, because every
backtest run against a wrong cost model is a wasted trial that still counts against the deflated
Sharpe in Annex C.
