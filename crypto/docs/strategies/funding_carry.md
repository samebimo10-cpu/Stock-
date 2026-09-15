# Strategy: funding_carry

**Owner:** unassigned
**Status:** research
**Implementation:** `src/tradesys/layers/l3_strategy/funding_carry.py`
**Template:** [SPEC.md §6.1](../../SPEC.md#61-the-strategy-specification--hard-requirement)

> **Process note.** The specification makes this document a hard requirement
> *before* the strategy is coded. It was written after. That is a real process
> failure, recorded here rather than tidied away: writing the rationale first
> is what stops a backtest explaining a strategy to you, and skipping it is the
> exact discipline the specification says teams drop when they can build
> quickly. The strategy does not advance past `research` until the validation
> in section 7 is genuinely run.

---

## 1. Economic rationale

**Who is the counterparty?**
Leveraged long holders of perpetual futures, and the market makers warehousing
their flow. When sentiment is bullish, more capital wants leveraged long
exposure than wants leveraged short, and the funding mechanism charges the
crowded side to hold it.

**Why do they trade against me?**
They want leveraged spot exposure without posting spot collateral or managing
an expiry roll. A perpetual gives them that, and funding is the recurring fee
they pay for the convenience. They are not trying to beat me; they are buying
a product, and I am selling it.

**Why does this persist?**
Funding is a *mechanism*, not a mispricing. It exists to tether the perpetual
price to spot, and it works by paying someone to take the unpopular side.
Someone must take it. As long as perpetuals exist and leverage demand is
asymmetric, the payment exists. That is a structurally different claim from
"this pattern has worked so far."

**What would end it?**
Three specific things, each independently monitorable:

1. **Leverage demand falls structurally.** Funding compresses toward zero and
   stays there. Monitor: the trailing distribution of the funding rate itself,
   not just its current value.
2. **Competing carry capital arrives.** Enough capital chases the same trade
   that funding is arbitraged down to the cost of capital. Monitor: the same
   distribution, plus open interest on the short side.
3. **Fee structure moves against us.** The round trip cost rises, or our volume
   falls and our tier degrades, pushing break-even past the holding period.
   Monitor: realised cost per round trip against the model (SPEC §9.6).

The third is the most likely and the least dramatic, which is why it is
enforced in code rather than left to review (section 3 below).

## 2. Mechanics

| | |
|---|---|
| Instruments | Perpetual future, hedged against spot on the same asset |
| Venues | One venue per leg initially, same venue where possible |
| Entry | Funding z-score above `entry_z`, funding positive, and break-even reachable inside `max_hold_intervals` |
| Exit | Funding z-score falls back below `exit_z` |
| Holding period | Hours to days. Target 3 to 7 days. |
| Expected trades | Low single digits per month per asset |
| Direction | Short the perpetual, long spot. Market-neutral in delta. |

The short perpetual leg is the one that earns the funding. The spot leg is the
hedge. The portfolio layer nets the two legs where they overlap with other
strategies (SPEC §7.3).

**Urgency is `passive`, always.** This strategy earns basis points per day.
Paying the spread to enter destroys a meaningful fraction of the edge, and
there is no signal decay that justifies crossing: funding that is elevated now
is generally still elevated in ten minutes.

## 3. Parameters

Five free parameters. The SPEC §6.1 hard limit is six, and staying under it is
a design constraint rather than a coincidence.

| Name | Range | Chosen | Sensitivity |
|---|---|---|---|
| `entry_z` | 1.0 – 3.0 | 1.5 | Low. The z-score is only computable once the funding distribution has variance, and the first computable value is usually far above any candidate threshold. |
| `exit_z` | 0.0 – 1.0 | 0.5 | Moderate. Set below `entry_z` so the position does not thrash at the boundary. |
| `round_trip_cost` | 0.001 – 0.006 | 0.003 | **High, and it is not really a parameter.** It must be read from the venue's actual fee tier, not tuned. Tuning it downward is how a strategy is made to look profitable. |
| `max_hold_intervals` | 9 – 30 | 21 | **High.** This is the strategy's binding constraint. See below. |
| `base_notional` | any | 1000 | Scales linearly. Not an edge parameter. |

**On `max_hold_intervals`.** Annex B §4.2 establishes that tier-0 fees at
baseline funding need exactly thirty funding intervals to break even. Setting
the limit to 30 therefore admits a trade with precisely zero expected profit,
which is the worst kind of default: it looks considered and it authorises
trading for nothing. 21 intervals is seven days and leaves real margin. A
threshold set equal to a break-even is not a threshold.

## 4. Risk profile

**Shape of the return distribution.** Small positive returns most days, from
funding accrual. Occasional large negative returns. This is a short-volatility
payoff wearing a market-neutral costume, and it should be sized as one.

**Where is the tail?**
When a funding regime flips. The perpetual gaps against the short leg while
spot is illiquid, and the two legs stop hedging each other for exactly as long
as it takes to matter. The loss arrives as a cluster, not as a drift.

**Estimated from the mechanism, not the sample.** A backtest over a calm
period contains no regime flips and will report a tail of zero. The worst
plausible day should be estimated by asking what a 15% adverse gap in the
perpetual with a 3% slippage on the spot unwind costs, not by taking the worst
day in the sample. Sizing uses the conditional-loss method
(`conditional_loss_size`, SPEC §8.1), not Kelly.

**Liquidation risk on the short leg.** Being delta-neutral is not protection
against liquidation. The legs sit in different margin accounts, and an upward
move can liquidate the short perpetual while the spot leg is fine and unable
to help. The liquidation-distance monitor (SPEC §8.2, 25% of mark) is not
optional for this strategy — it is the single control that stops a
market-neutral book taking a total loss on one leg.

**Correlation to other live strategies.** Expected low against stat-arb and
cross-venue. Expected **high** against any other carry or short-volatility
strategy, and the portfolio layer must treat those as one cluster
(SPEC §7.2, correlation above 0.6 halves the combined allocation).

**Behaviour by regime** (SPEC §11.2 item 5), to be filled from the validation
run:

| Regime | Expected | Measured |
|---|---|---|
| Bull trending | Best. Funding persistently positive. | — |
| Bear trending | Weak or inverted. Funding can go negative, and the paid side is then the other one. | — |
| Chop | Modest. Funding oscillates near baseline, and break-even often blocks entry. | — |
| High volatility | **The tail lives here.** | — |
| Crisis | Untested. Assume the worst case in section 4 above. | — |

## 5. Capacity

**Not yet estimated. The strategy is therefore not approved for live capital**
(SPEC §1.2 — a strategy without a capacity number cannot be sized against an
unknown ceiling).

Method when it is run (SPEC §12.4): re-run at increasing size with impact
modelled from real book depth, and find the capital at which net return halves.

**Expected binding constraint: the funding pool, not book depth.** You are one
of several parties collecting the same funding, and your own size moves the
rate you are collecting. That is unusual — for most strategies impact is the
constraint — and it means capacity must be cross-checked against open interest
on the short side rather than against spread and depth alone.

## 6. Costs

| | |
|---|---|
| Fee tier assumed | Tier 0. Deliberately pessimistic. |
| Maker/taker mix | Currently modelled as taker on both legs |
| Round trip | 0.30% of notional at tier 0 |
| Slippage | From real book depth, not a flat rate |
| Funding | Received on the short leg; **paid when the position inverts** |
| Borrow | Not applicable while the short leg is a perpetual |
| Cost as % of gross | **To be measured.** Gate is below 40% (SPEC §1.2). |

**The single highest-value improvement to this strategy is a maker entry
path.** Moving entry from taker to maker roughly halves the round trip and
therefore roughly halves the break-even holding period. That is worth more than
any plausible signal improvement, and it should be built before any effort goes
into refining `entry_z`.

## 7. Validation results

**None. Nothing in this section has been run.**

The strategy currently has a deterministic demonstration
(`tradesys demo`) against a synthetic scenario. That is a smoke test of the
pipeline, not evidence about the strategy, and it must not be reported as one.

Required before `paper` (SPEC §11.2, gates in [Annex F](../../annex/F-gates.md)):

- [ ] Walk-forward, positive in ≥ 70% of out-of-sample windows
- [ ] Purged K-fold with embargo, purge set to the holding period
- [ ] Deflated Sharpe > 0.95 using the registry trial count
- [ ] Probability of backtest overfitting < 0.50
- [ ] Monte Carlo 5th-percentile drawdown, plus block bootstrap comparison
- [ ] Parameter sensitivity: plateau spanning ≥ 30% of the range
- [ ] Regime table across all five regimes
- [ ] Still positive at 1.5× modelled costs
- [ ] No material change excluding amber data days
- [ ] Universe includes delisted tokens
- [ ] Capacity number with the binding constraint named
- [ ] **Holdout evaluated exactly once**

## 8. Kill criteria

**Pre-registered. To be signed before go-live** (SPEC §6.1 — the moment to
decide when to stop is the moment before there is money on the table and a
reason to move the line).

| Trigger | Action |
|---|---|
| Live Sharpe below 0.3 over 120 days at Phase 4 | Investigate, not an automatic verdict ([Annex C §5](../../annex/C-validation.md) — 120 days cannot establish a Sharpe) |
| Live-vs-backtest divergence z below −2.0 over 30 days | Auto-disable, already enforced in the limit register |
| Realised cost above 1.5× modelled for 30 days | Disable. The break-even check is running on a wrong number, so every entry decision was wrong. |
| Drawdown beyond 1.5× the Monte Carlo 5th percentile | **Stop and rebuild.** The tail was mis-estimated, which means the sizing was wrong. |
| Funding distribution median below break-even for 90 days | Retire. The edge named in section 1 has gone. |
| Any single funding-flip event costing more than 3% of equity | Stop. Re-estimate the tail from the mechanism before restarting. |

Signed: ______________________  Date: ____________

## 9. Monitoring

Strategy-specific, on top of the standard dashboards (SPEC §10.3):

- Funding z-score and annualised funding, per asset, against the entry line
- **Break-even holding period against `max_hold_intervals`** — the veto reason
  is exposed on the strategy's health endpoint, so a strategy that has stopped
  trading because it cannot cover costs is distinguishable from one that has
  simply seen no signal. Those look identical from outside and mean different
  things.
- Realised versus modelled round-trip cost, weekly
- Liquidation distance on the short leg, continuously, alerting well before the
  25% limit
- Days held per position, against the 21-interval assumption
- Correlation against every other live strategy, with carry-like strategies
  flagged as one cluster
