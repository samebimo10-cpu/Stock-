# Stock Selector & Allocator — NGX + NYSE

A goal-driven stock screener and portfolio allocator covering the **Nigerian Exchange (NGX)** and the
**New York Stock Exchange (NYSE)**. It uses only publicly available data (no API keys), ranks every
stock in a configurable universe with a transparent multi-factor model, then builds a portfolio that
matches *your* goals: growth, income, balance or capital preservation, a risk level, a horizon, a
target amount, a currency, and how much you want at home versus abroad.

## Just want to use it?

Open the web app: **https://samebimo10-cpu.github.io/Stock-/**

Nothing to install. A job in this repository (`.github/workflows/update-data.yml`) fetches public NGX,
NYSE and USD/NGN data every weekday at 21:30 UTC (22:30 Lagos time), rebuilds the page and publishes
it. To refresh sooner, open the **Actions** tab on GitHub, pick *Update market data and publish the
web app* and press *Run workflow*.

> This is an analytical tool, not investment advice. Prices and fundamentals from free public sources
> can be stale or incomplete; check them before trading.

## What it does

1. **Screens** every stock on each exchange with six factors, each z-scored *within its own exchange*:
   `value` (earnings & book yield), `quality` (ROE, margin, leverage), `momentum` (12-1m and 6m),
   `low_vol` (volatility & drawdown), `dividend` (yield) and `liquidity` (traded value & size).
   The composite score weights the factors according to your objective (growth tilts to momentum and
   quality, income to dividends and stability, and so on).
2. **Selects** the top N stocks per exchange, with a liquidity floor and a sector cap so the picks are
   not all banks.
3. **Allocates** with a constrained optimiser (SciPy SLSQP) in your base currency (NGN or USD, with
   USD/NGN converted properly). The objective follows the goal:
   * growth → maximise Sharpe ratio inside a volatility ceiling set by your risk tolerance;
   * income → maximise dividend yield with a return/risk trade-off (optional yield target);
   * balanced → maximise return net of a risk charge plus a diversification bonus;
   * preservation → minimise volatility while beating the cash rate.

   Constraints: long-only, max weight per stock and per sector, NGX/NYSE split range, an optional cash
   (T-bill) sleeve capped by risk level, a minimum expected return when you set a target amount.
   Expected returns are shrunk toward sector/exchange priors and tilted by the factor score; the
   covariance matrix is shrunk toward constant correlation and falls back to structural estimates
   when a stock has little price history.
4. **Converts** weights into **whole-share orders** inside your budget and reports leftover cash.
5. **Projects** outcomes with a Monte Carlo simulation over your horizon (median, 10th and 90th
   percentiles, probability of hitting the target) and shows how the mix would have behaved over the
   available price window.

## Public data sources

| Exchange | Prices | Fundamentals | Source |
|---|---|---|---|
| NYSE | 2y daily (adjusted) | P/E, P/B, ROE, margin, D/E, yield, market cap, volume | Yahoo Finance via `yfinance` |
| NGX | daily snapshot, accumulated into a history | market cap, P/E, EPS, dividend yield, 52-week range | NGX Group statistics feed (`doclib.ngxgroup.com`) and the public price board at `afx.kwayisi.org/ngx` |
| FX | USD/NGN 2y daily | — | Yahoo Finance (`NGN=X`) |

NGX sources do not serve a long price history. The app therefore **stores every daily snapshot it
sees** (`stockselector refresh`, run it daily or on a scheduler) and can **import a CSV history**
(`--ngx-history file.csv`, long form `date,symbol,close` or wide form with one column per symbol).
Until about 60 trading days exist, momentum and volatility for NGX names are estimated from the
published 52-week high/low (range proxies), and the report says so.

Everything is cached under `.cache/stockselector` (override with `--cache-dir` or
`STOCKSELECTOR_CACHE`). If no source is reachable the app falls back to a clearly labelled
**synthetic sample dataset** so you can still explore the workflow offline.

## Install

```bash
git clone <this repo> && cd Stock-
python -m venv .venv && source .venv/bin/activate      # Windows: .venv\Scripts\activate
pip install -e ".[ui,dev]"
```

## Use

```bash
# Fetch live public data into the cache (first run may take a few minutes for NGX pages)
stockselector refresh

# Rank the universe for an objective
stockselector screen --exchange both --objective growth --top 15

# Pick the best 8 per exchange for an income investor
stockselector select --objective income --picks 8

# Full goal-based allocation: ₦5m, balanced, medium risk, 5 years, aiming for ₦10m
stockselector allocate --objective balanced --risk 3 --budget 5000000 --currency NGN \
    --horizon 5 --target 10000000 --ngx-min 0.3 --ngx-max 0.6 --export output/

# USD investor, NYSE only, growth, aggressive
stockselector allocate --objective growth --risk 5 --budget 25000 --currency USD --ngx-max 0 --horizon 10

# Use a goals file (template: stockselector init-goals goals.yaml)
stockselector allocate --goals goals.example.yaml

# Explore offline with synthetic data
stockselector allocate --mode sample --objective income --risk 2 --budget 20000 --currency USD

# Dashboard
stockselector ui            # or: streamlit run app.py

# Browser version (no Python needed to *use* it): export a data pack, embed it, open web/index.html
stockselector export-web web/data-pack.json --build
```

## Browser version

`web/index.html` is a self-contained single page that runs the same selector and allocator in
JavaScript (factor scores, goal mapping, a projected-gradient optimiser, whole-share orders, Monte
Carlo projection). It ships with the synthetic sample pack embedded and clearly labelled. To use it
with real public data either rebuild it with `stockselector export-web --build`, or load a data
pack on its **Data** tab (the pack stays in that browser's local storage). The file can be hosted
anywhere static, including GitHub Pages.

Useful flags: `--fx 1550` to pin today's USD/NGN rate, `--ngx-lot 100` if your broker enforces
board lots, `--no-cash` to force full equity exposure, `--mode live|cache|sample`.

`--export DIR` writes `screen_scores.csv`, `picks.csv`, `allocation.csv`, `orders.csv`,
`projection.csv`, `backtest.csv` and `summary.json`.

## Customise

* **Universe**: edit `stockselector/universe/ngx.yaml` and `nyse.yaml` (symbol, name, sector).
* **Goals**: every knob lives in `GoalProfile` (`stockselector/config.py`); see `goals.example.yaml`.
* **Factor weights**: `factor_weight_overrides: {momentum: 0.4}` in the goals file tilts the score.
* **Risk ceilings / cash caps / priors**: `GoalProfile.max_volatility`, `allocator/goals.py`,
  `allocator/risk.py`.

## Project layout

```
stockselector/
  config.py            goal profile, factor weights per objective
  universe/            NGX and NYSE universes (YAML)
  data/                providers: nyse (yfinance), ngx (NGX feed + kwayisi), fx, sample, cache, loader
  scoring.py           factor computation and composite score
  selector.py          per-exchange picks with sector limits
  allocator/           risk model, optimiser, goal mapping, lots, Monte Carlo projection
  report.py            console tables and exports
  cli.py               Typer CLI
app.py                 Streamlit dashboard
web/template.html      browser version (single page, vanilla JS); scripts/build_web.py embeds a data pack
web/index.html         built browser version with the sample pack embedded
tests/                 pytest suite (runs on sample data, no network)
```

## Tests

```bash
python -m pytest -q
```

## Limitations

* Free NGX sources publish few fundamentals (no P/B, ROE or margins); those factors are neutral for
  NGX names until you add data. NYSE coverage from Yahoo is much richer.
* Expected returns are estimates with wide error bars. The optimiser is deliberately conservative
  (shrinkage, caps, cash sleeve) but cannot remove that uncertainty.
* Transaction costs, taxes, and NGX settlement/FX conversion frictions are not modelled.
