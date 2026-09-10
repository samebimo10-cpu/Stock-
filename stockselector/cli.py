"""Command-line interface: ``stockselector --help``."""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Optional

import typer

from . import __version__
from .config import GoalProfile
from .report import console, data_banner, export, print_allocation, print_screen, print_selection

app = typer.Typer(add_completion=False, no_args_is_help=True,
                  help="Goal-driven stock selector and allocator for NGX and NYSE (public data only).")

ModeOpt = typer.Option("auto", "--mode", help="Data mode: auto | live | cache | sample")
CacheOpt = typer.Option(None, "--cache-dir", help="Cache directory (default .cache/stockselector)")
FxOpt = typer.Option(None, "--fx", help="Override USD/NGN rate (naira per dollar)")
NgxHistOpt = typer.Option(None, "--ngx-history", help="CSV of NGX closes to import (date,symbol,close or wide)")
GoalsOpt = typer.Option(None, "--goals", help="YAML goal profile (CLI flags override its values)")


def _profile(goals: Optional[Path], **overrides) -> GoalProfile:
    base = GoalProfile.from_yaml(goals).to_dict() if goals else {}
    base.update({k: v for k, v in overrides.items() if v is not None})
    return GoalProfile.from_dict(base)


def _load(exchanges, mode, cache_dir, fx, ngx_history, quick: bool = False):
    from .data import load_market_data
    return load_market_data(exchanges=exchanges, mode=mode, cache_dir=cache_dir, fx_override=fx,
                            ngx_history_csv=ngx_history, ngx_stock_pages=not quick)


def _exchanges(exchange: str) -> tuple[str, ...]:
    e = exchange.lower()
    return {"both": ("NGX", "NYSE"), "ngx": ("NGX",), "nyse": ("NYSE",)}[e]


@app.callback()
def _main(verbose: bool = typer.Option(False, "--verbose", "-v")):
    logging.basicConfig(level=logging.INFO if verbose else logging.WARNING, format="%(levelname)s %(name)s: %(message)s")


@app.command()
def version():
    """Print the version."""
    console.print(f"stockselector {__version__}")


@app.command()
def screen(
    exchange: str = typer.Option("both", help="ngx | nyse | both"),
    objective: str = typer.Option("balanced", help="growth | income | balanced | preservation"),
    top: int = typer.Option(20, help="Rows to show per exchange"),
    mode: str = ModeOpt, cache_dir: Optional[Path] = CacheOpt, fx: Optional[float] = FxOpt,
    ngx_history: Optional[Path] = NgxHistOpt, goals: Optional[Path] = GoalsOpt,
    export_dir: Optional[Path] = typer.Option(None, "--export", help="Write CSVs here"),
):
    """Rank every stock in the universe by the goal-weighted factor score."""
    from .scoring import score_universe
    from .selector import select_stocks

    profile = _profile(goals, objective=objective)
    md = _load(_exchanges(exchange), mode, cache_dir, fx, ngx_history)
    data_banner(md)
    scores = score_universe(md, profile)
    for ex in _exchanges(exchange):
        print_screen(scores, ex, top)
    if export_dir:
        sel = select_stocks(md, profile, scores)
        for p in export(None, sel, profile, md, export_dir):
            console.print(f"wrote {p}")


@app.command()
def select(
    exchange: str = typer.Option("both", help="ngx | nyse | both"),
    objective: str = typer.Option("balanced", help="growth | income | balanced | preservation"),
    picks: int = typer.Option(8, help="Picks per exchange"),
    mode: str = ModeOpt, cache_dir: Optional[Path] = CacheOpt, fx: Optional[float] = FxOpt,
    ngx_history: Optional[Path] = NgxHistOpt, goals: Optional[Path] = GoalsOpt,
):
    """Select the best stocks on each exchange for the chosen objective."""
    from .selector import select_stocks

    ngx_range = {"both": None, "ngx": (1.0, 1.0), "nyse": (0.0, 0.0)}[exchange.lower()]
    profile = _profile(goals, objective=objective, picks_per_exchange=picks, ngx_weight_range=ngx_range)
    md = _load(_exchanges(exchange), mode, cache_dir, fx, ngx_history)
    data_banner(md)
    print_selection(select_stocks(md, profile), profile)


@app.command()
def allocate(
    objective: str = typer.Option(None, help="growth | income | balanced | preservation"),
    risk: int = typer.Option(None, min=1, max=5, help="Risk tolerance 1 (low) .. 5 (high)"),
    budget: float = typer.Option(None, help="Amount to invest, in the base currency"),
    currency: str = typer.Option(None, help="Base currency: NGN | USD"),
    horizon: float = typer.Option(None, help="Horizon in years"),
    target: Optional[float] = typer.Option(None, help="Target portfolio value at the horizon"),
    income_yield: Optional[float] = typer.Option(None, help="Target dividend yield, e.g. 0.05"),
    picks: int = typer.Option(None, help="Picks per exchange"),
    ngx_min: float = typer.Option(None, help="Minimum NGX share of equities (0-1)"),
    ngx_max: float = typer.Option(None, help="Maximum NGX share of equities (0-1)"),
    max_weight: float = typer.Option(None, help="Maximum weight per stock (0-1)"),
    no_cash: bool = typer.Option(False, "--no-cash", help="Disallow the cash / T-bill sleeve"),
    ngx_lot: int = typer.Option(1, help="Minimum NGX order size in shares"),
    mode: str = ModeOpt, cache_dir: Optional[Path] = CacheOpt, fx: Optional[float] = FxOpt,
    ngx_history: Optional[Path] = NgxHistOpt, goals: Optional[Path] = GoalsOpt,
    export_dir: Optional[Path] = typer.Option(None, "--export", help="Write CSV/JSON outputs here"),
):
    """Select stocks and build a goal-based allocation with whole-share orders."""
    from .allocator import allocate as _allocate
    from .selector import select_stocks

    overrides = dict(objective=objective, risk_tolerance=risk, budget=budget, base_currency=currency,
                     horizon_years=horizon, target_amount=target, target_income_yield=income_yield,
                     picks_per_exchange=picks, max_weight_per_stock=max_weight)
    if no_cash:
        overrides["allow_cash"] = False
    profile = _profile(goals, **overrides)
    if ngx_min is not None or ngx_max is not None:
        lo, hi = profile.ngx_weight_range
        profile = GoalProfile.from_dict({**profile.to_dict(), "ngx_weight_range": (
            lo if ngx_min is None else ngx_min, hi if ngx_max is None else ngx_max)})
    exchanges = ("NGX",) if profile.ngx_weight_range[0] >= 1 else ("NYSE",) if profile.ngx_weight_range[1] <= 0 else ("NGX", "NYSE")
    md = _load(exchanges, mode, cache_dir, fx, ngx_history)
    data_banner(md)
    sel = select_stocks(md, profile)
    print_selection(sel, profile)
    alloc = _allocate(md, profile, sel, lot_size={"NGX": ngx_lot})
    print_allocation(alloc, profile)
    if export_dir:
        for p in export(alloc, sel, profile, md, export_dir):
            console.print(f"wrote {p}")


@app.command()
def refresh(
    exchange: str = typer.Option("both", help="ngx | nyse | both"),
    cache_dir: Optional[Path] = CacheOpt,
    ngx_history: Optional[Path] = NgxHistOpt,
    quick: bool = typer.Option(False, help="Skip per-stock NGX valuation pages (faster, fewer fundamentals)"),
):
    """Fetch fresh public data into the cache (run daily to build NGX history)."""
    md = _load(_exchanges(exchange), "live", cache_dir, None, ngx_history, quick=quick)
    data_banner(md)
    for ex in _exchanges(exchange):
        syms = md.symbols(ex)
        days = [md.history_days(s) for s in syms]
        f = md.fundamentals.loc[syms]
        cov = ", ".join(f"{c} {int(f[c].notna().sum())}" for c in ("price", "market_cap", "pe", "dividend_yield", "high_52w", "ytd_change", "avg_daily_value"))
        console.print(f"{ex}: {len(syms)} symbols, price history median {int(sorted(days)[len(days)//2]) if days else 0} days; coverage: {cov}")
    counts = md.board.groupby("exchange")["symbol"].count().to_dict() if not md.board.empty else {}
    console.print("Price board: " + ", ".join(f"{k} {v}" for k, v in counts.items()))
    console.print(f"USD/NGN: {md.latest_fx():,.2f}")


@app.command("export-web")
def export_web(
    path: Path = typer.Argument(Path("web/data-pack.json"), help="Where to write the JSON data pack"),
    exchange: str = typer.Option("both", help="ngx | nyse | both"),
    mode: str = ModeOpt, cache_dir: Optional[Path] = CacheOpt, fx: Optional[float] = FxOpt,
    ngx_history: Optional[Path] = NgxHistOpt,
    build: bool = typer.Option(False, "--build", help="Also rebuild web/index.html with this pack embedded"),
):
    """Write a data pack for the browser app (load it on the page's Data tab, or embed with --build)."""
    from .webdata import write_web_pack

    md = _load(_exchanges(exchange), mode, cache_dir, fx, ngx_history)
    data_banner(md)
    out = write_web_pack(md, path)
    console.print(f"wrote {out} ({out.stat().st_size / 1024:.0f} KB)")
    if build:
        import subprocess
        import sys

        script = Path(__file__).resolve().parent.parent / "scripts" / "build_web.py"
        subprocess.run([sys.executable, str(script), "--pack", str(out)], check=True)


@app.command("probe-ngx")
def probe_ngx(url: list[str] = typer.Option(None, "--url", help="Extra URLs to try"),
              deep: bool = typer.Option(False, "--deep", help="Print table layouts of the HTML sources")):
    """Diagnose the public NGX endpoints (prints raw field names and statuses)."""
    from .data.ngx_probe import deep_probe, probe

    if deep:
        deep_probe()
    else:
        probe(url or [])


@app.command("init-goals")
def init_goals(path: Path = typer.Argument(Path("goals.yaml"))):
    """Write a goal-profile template you can edit and pass with --goals."""
    GoalProfile().to_yaml(path)
    console.print(f"wrote {path}")


@app.command()
def ui(port: int = typer.Option(8501)):
    """Launch the Streamlit dashboard."""
    import subprocess
    import sys

    app_path = Path(__file__).resolve().parent.parent / "app.py"
    subprocess.run([sys.executable, "-m", "streamlit", "run", str(app_path), "--server.port", str(port)], check=False)


if __name__ == "__main__":
    app()
