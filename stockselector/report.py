"""Console rendering (rich) and file exports for selections and allocations."""
from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
from rich.console import Console
from rich.panel import Panel
from rich.table import Table

from .allocator import Allocation
from .config import GoalProfile
from .data.base import MarketData
from .selector import Selection

console = Console()


def _pct(x) -> str:
    return "-" if x is None or x != x else f"{x:+.1%}" if x < 0 else f"{x:.1%}"


def _money(x: float, ccy: str) -> str:
    sym = "₦" if ccy == "NGN" else "$"
    return f"{sym}{x:,.0f}"


def data_banner(md: MarketData) -> None:
    if md.is_sample:
        console.print(Panel("[bold yellow]SAMPLE DATA[/] — synthetic prices and fundamentals. Run "
                            "`stockselector refresh` (with internet access) for live public data.",
                            border_style="yellow"))
    for w in md.warnings:
        if not w.startswith("SAMPLE DATA"):
            console.print(f"[yellow]note:[/] {w}")


def print_selection(sel: Selection, profile: GoalProfile, top: int | None = None) -> None:
    for ex, syms in sel.picks.items():
        table = Table(title=f"{ex} — top picks for a {profile.objective.value} investor", show_lines=False)
        for col in ("#", "Symbol", "Name", "Sector", "Score", "Value", "Quality", "Momentum", "LowVol", "Div", "Liq", "P/E", "Div yield", "12m mom"):
            table.add_column(col, justify="right" if col not in ("Symbol", "Name", "Sector") else "left")
        rows = sel.scores.loc[syms] if top is None else sel.scores.loc[syms].head(top)
        for i, (sym, r) in enumerate(rows.iterrows(), 1):
            table.add_row(str(i), sym, str(r["name"])[:28], str(r["sector"])[:22], f"{r['composite']:.2f}",
                          f"{r['value']:.2f}", f"{r['quality']:.2f}", f"{r['momentum']:.2f}", f"{r['low_vol']:.2f}",
                          f"{r['dividend']:.2f}", f"{r['liquidity']:.2f}",
                          "-" if r["pe"] != r["pe"] else f"{r['pe']:.1f}", _pct(r["dividend_yield"]), _pct(r["mom_12_1"]))
        console.print(table)
    for n in sel.notes:
        console.print(f"[yellow]note:[/] {n}")


def print_screen(scores: pd.DataFrame, exchange: str, top: int = 20) -> None:
    sub = scores[scores["exchange"] == exchange].sort_values("composite", ascending=False).head(top)
    table = Table(title=f"{exchange} screen — top {len(sub)} by composite score")
    for col in ("Rank", "Symbol", "Name", "Sector", "Score", "Value", "Quality", "Momentum", "LowVol", "Div", "Liq", "Eligible"):
        table.add_column(col, justify="right" if col not in ("Symbol", "Name", "Sector") else "left")
    for sym, r in sub.iterrows():
        table.add_row(str(int(r["rank_in_exchange"])), sym, str(r["name"])[:28], str(r["sector"])[:22],
                      f"{r['composite']:.2f}", f"{r['value']:.2f}", f"{r['quality']:.2f}", f"{r['momentum']:.2f}",
                      f"{r['low_vol']:.2f}", f"{r['dividend']:.2f}", f"{r['liquidity']:.2f}",
                      "yes" if r["eligible"] else "no")
    console.print(table)


def print_allocation(alloc: Allocation, profile: GoalProfile) -> None:
    ccy = profile.base_currency.value
    rf = profile.cash_rate
    summary = Table.grid(padding=(0, 2))
    summary.add_column(style="bold")
    summary.add_column()
    summary.add_row("Objective", f"{profile.objective.value}  (risk tolerance {profile.risk_tolerance}/5, {profile.horizon_years:g}y horizon)")
    summary.add_row("Budget", _money(profile.budget, ccy))
    summary.add_row("Expected return", f"{alloc.expected_return:.1%} / yr  (in {ccy})")
    summary.add_row("Volatility", f"{alloc.volatility:.1%} / yr  (ceiling {profile.max_volatility:.0%})")
    summary.add_row("Sharpe", f"{alloc.sharpe(rf):.2f}  (cash rate {rf:.1%})")
    summary.add_row("Dividend yield", f"{alloc.income_yield:.1%}")
    split = ", ".join(f"{k} {v:.0%}" for k, v in alloc.exchange_split().items())
    summary.add_row("Split", split)
    if profile.target_amount:
        summary.add_row("Goal", f"{_money(profile.target_amount, ccy)} in {profile.horizon_years:g}y  →  "
                                f"P(reach) ≈ {alloc.projection.prob_target:.0%}  (needs {_pct(profile.required_return)}/yr)")
    p = alloc.projection
    summary.add_row("Projection", f"median {_money(p.p50[-1], ccy)}, 10th pct {_money(p.p10[-1], ccy)}, "
                                  f"90th pct {_money(p.p90[-1], ccy)}, P(loss) {p.prob_loss:.0%}")
    console.print(Panel(summary, title="Allocation summary", border_style="green"))

    table = Table(title="Target weights")
    for col in ("Symbol", "Exchange", "Sector", "Weight", "Exp. return", "Volatility", "Div yield", "Risk contrib."):
        table.add_column(col, justify="right" if col not in ("Symbol", "Exchange", "Sector") else "left")
    rc = alloc.risk_contribution()
    for _, r in alloc.table().iterrows():
        table.add_row(r["symbol"], r["exchange"], str(r["sector"])[:22], f"{r['weight']:.1%}",
                      _pct(r["exp_return"]) if r["symbol"] != "CASH" else _pct(rf),
                      f"{r['volatility']:.1%}", _pct(r["dividend_yield"]),
                      f"{rc.get(r['symbol'], 0.0):.0%}" if r["symbol"] != "CASH" else "-")
    console.print(table)

    lots = alloc.lots
    table = Table(title=f"Orders (whole shares, budget {_money(lots.budget_base, ccy)})")
    for col in ("Symbol", "Exchange", "Price (local)", "Shares", f"Cost ({ccy})", "Target", "Actual"):
        table.add_column(col, justify="right" if col not in ("Symbol", "Exchange") else "left")
    for _, r in lots.orders.iterrows():
        table.add_row(r["symbol"], r["exchange"], f"{r['price_local']:,.2f} {r['currency']}", f"{int(r['shares']):,}",
                      f"{r['cost_base']:,.0f}", f"{r['target_weight']:.1%}", f"{r['actual_weight']:.1%}")
    table.add_row("CASH", "-", "-", "-", f"{lots.cash_base:,.0f}",
                  f"{lots.cash_sleeve_base / lots.budget_base:.1%}", f"{lots.cash_base / lots.budget_base:.1%}")
    console.print(table)
    for n in alloc.notes:
        console.print(f"[cyan]•[/] {n}")
    if not alloc.backtest.empty:
        bt = alloc.backtest
        total = bt["value"].iloc[-1] / bt["value"].iloc[0] - 1
        console.print(f"[dim]Buy-and-hold of this mix over the data window ({bt.index[0].date()} → {bt.index[-1].date()}): "
                      f"{total:+.1%} total, worst drawdown {bt['drawdown'].min():.1%}. Past performance is not a forecast.[/]")


def export(alloc: Allocation | None, sel: Selection, profile: GoalProfile, md: MarketData, out_dir: str | Path) -> list[Path]:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    written = []
    sel.scores.to_csv(out / "screen_scores.csv")
    written.append(out / "screen_scores.csv")
    sel.table().to_csv(out / "picks.csv")
    written.append(out / "picks.csv")
    if alloc is not None:
        alloc.table().to_csv(out / "allocation.csv", index=False)
        alloc.lots.orders.to_csv(out / "orders.csv", index=False)
        alloc.projection.table().to_csv(out / "projection.csv", index=False)
        written += [out / "allocation.csv", out / "orders.csv", out / "projection.csv"]
        if not alloc.backtest.empty:
            alloc.backtest.to_csv(out / "backtest.csv")
            written.append(out / "backtest.csv")
        summary = {
            "profile": profile.to_dict(),
            "data": {"is_sample": md.is_sample, "fetched_at": md.fetched_at.isoformat(), "warnings": md.warnings},
            "expected_return": alloc.expected_return,
            "volatility": alloc.volatility,
            "sharpe": alloc.sharpe(profile.cash_rate),
            "income_yield": alloc.income_yield,
            "exchange_split": alloc.exchange_split().to_dict(),
            "sector_split": alloc.sector_split().to_dict(),
            "weights": alloc.weights.to_dict(),
            "prob_target": alloc.projection.prob_target,
            "prob_loss": alloc.projection.prob_loss,
            "notes": alloc.notes + sel.notes,
        }
        with open(out / "summary.json", "w", encoding="utf-8") as fh:
            json.dump(summary, fh, indent=2, default=str)
        written.append(out / "summary.json")
    return written
