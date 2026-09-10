"""Streamlit dashboard: ``streamlit run app.py`` or ``stockselector ui``."""
from __future__ import annotations

import pandas as pd
import plotly.express as px
import plotly.graph_objects as go
import streamlit as st

from stockselector.allocator import allocate
from stockselector.config import GoalProfile
from stockselector.data import load_market_data
from stockselector.scoring import score_universe
from stockselector.selector import select_stocks

st.set_page_config(page_title="NGX + NYSE Stock Selector", page_icon="📈", layout="wide")


@st.cache_data(show_spinner="Loading market data…", ttl=3600)
def _load(mode: str, fx: float | None, exchanges: tuple[str, ...]):
    md = load_market_data(exchanges=exchanges, mode=mode, fx_override=fx)
    return md


def _money(x: float, ccy: str) -> str:
    return ("₦" if ccy == "NGN" else "$") + f"{x:,.0f}"


# --------------------------------------------------------------------------- sidebar
with st.sidebar:
    st.title("Your goals")
    objective = st.selectbox("Objective", ["balanced", "growth", "income", "preservation"],
                             help="Growth = capital appreciation, Income = dividends, Preservation = low volatility.")
    risk = st.slider("Risk tolerance", 1, 5, 3, help="1 = very conservative, 5 = very aggressive")
    currency = st.radio("Base currency", ["NGN", "USD"], horizontal=True)
    budget = st.number_input(f"Budget ({currency})", min_value=1000.0,
                             value=5_000_000.0 if currency == "NGN" else 10_000.0, step=1000.0, format="%.0f")
    horizon = st.slider("Horizon (years)", 1, 30, 5)
    use_target = st.checkbox("I have a target amount")
    target = None
    if use_target:
        target = st.number_input(f"Target value at horizon ({currency})", min_value=float(budget),
                                 value=float(budget) * 2, step=1000.0, format="%.0f")
    income_target = None
    if objective == "income":
        income_target = st.slider("Target dividend yield", 0.0, 0.12, 0.05, 0.005, format="%.3f")
    st.subheader("Portfolio rules")
    picks = st.slider("Picks per exchange", 3, 15, 8)
    ngx_lo, ngx_hi = st.slider("NGX share of equities", 0.0, 1.0, (0.2, 0.7), 0.05)
    max_w = st.slider("Max weight per stock", 0.05, 0.5, 0.15, 0.01)
    max_sector = st.slider("Max weight per sector", 0.1, 1.0, 0.35, 0.05)
    allow_cash = st.checkbox("Allow cash / T-bill sleeve", True)
    with st.expander("Rates & data"):
        cash_ngn = st.number_input("NGN T-bill rate", 0.0, 1.0, 0.18, 0.005, format="%.3f")
        cash_usd = st.number_input("USD T-bill rate", 0.0, 1.0, 0.045, 0.005, format="%.3f")
        mode = st.selectbox("Data mode", ["auto", "live", "cache", "sample"],
                            help="auto: cache → live → sample. Live needs internet access.")
        fx_override = st.number_input("USD/NGN override (0 = use market)", 0.0, 100000.0, 0.0, 1.0)
    run = st.button("Build portfolio", type="primary", width="stretch")

profile = GoalProfile(
    objective=objective, risk_tolerance=risk, horizon_years=float(horizon), budget=float(budget),
    base_currency=currency, target_amount=target, target_income_yield=income_target,
    picks_per_exchange=picks, ngx_weight_range=(ngx_lo, ngx_hi), max_weight_per_stock=max_w,
    max_weight_per_sector=max_sector, allow_cash=allow_cash, cash_rate_ngn=cash_ngn, cash_rate_usd=cash_usd,
)
exchanges = ("NGX",) if ngx_lo >= 1 else ("NYSE",) if ngx_hi <= 0 else ("NGX", "NYSE")

st.title("📈 NGX + NYSE Stock Selector & Allocator")
st.caption("Public data only. This is an analytical tool, not investment advice.")

md = _load(mode, fx_override or None, exchanges)
if md.is_sample:
    st.warning("SAMPLE DATA — synthetic prices and fundamentals. Switch data mode to *live* with internet access for real quotes.")
for w in md.warnings:
    if not w.startswith("SAMPLE DATA"):
        st.info(w)

scores = score_universe(md, profile)
sel = select_stocks(md, profile, scores)

tab_alloc, tab_screen, tab_project, tab_data = st.tabs(["Allocation", "Screener", "Projection", "Data"])

with tab_screen:
    st.subheader("Ranked universe")
    cols = ["rank_in_exchange", "name", "sector", "composite", "value", "quality", "momentum", "low_vol",
            "dividend", "liquidity", "pe", "dividend_yield", "mom_12_1", "volatility", "eligible", "range_proxy"]
    for ex in exchanges:
        st.markdown(f"**{ex}**")
        sub = scores[scores["exchange"] == ex][cols].copy()
        sub["picked"] = sub.index.isin(sel.picks.get(ex, []))
        st.dataframe(sub.style.format({"composite": "{:.2f}", "value": "{:.2f}", "quality": "{:.2f}", "momentum": "{:.2f}",
                                       "low_vol": "{:.2f}", "dividend": "{:.2f}", "liquidity": "{:.2f}", "pe": "{:.1f}",
                                       "dividend_yield": "{:.1%}", "mom_12_1": "{:.1%}", "volatility": "{:.1%}"}),
                     width="stretch", height=400)
    for n in sel.notes:
        st.caption(n)

alloc = None
if run or "alloc_done" in st.session_state:
    st.session_state["alloc_done"] = True
    try:
        alloc = allocate(md, profile, sel)
    except Exception as exc:  # surface, don't crash the page
        st.error(f"Allocation failed: {exc}")

with tab_alloc:
    if alloc is None:
        st.info("Set your goals in the sidebar and press **Build portfolio**.")
    else:
        ccy = profile.base_currency.value
        c1, c2, c3, c4, c5 = st.columns(5)
        c1.metric("Expected return", f"{alloc.expected_return:.1%}/yr")
        c2.metric("Volatility", f"{alloc.volatility:.1%}", help=f"Ceiling for your risk level: {profile.max_volatility:.0%}")
        c3.metric("Sharpe", f"{alloc.sharpe(profile.cash_rate):.2f}")
        c4.metric("Dividend yield", f"{alloc.income_yield:.1%}")
        if alloc.projection.prob_target is not None:
            c5.metric("P(reach target)", f"{alloc.projection.prob_target:.0%}")
        else:
            c5.metric("P(loss at horizon)", f"{alloc.projection.prob_loss:.0%}")
        for n in alloc.notes:
            st.caption("• " + n)
        left, right = st.columns([1, 1])
        with left:
            tbl = alloc.table()
            fig = px.pie(tbl, names="symbol", values="weight", title="Target weights", hole=0.45)
            fig.update_traces(textinfo="label+percent")
            st.plotly_chart(fig, width="stretch")
        with right:
            split = alloc.exchange_split().rename("weight").reset_index()
            split.columns = ["group", "weight"]
            sec = alloc.sector_split().rename("weight").reset_index()
            sec.columns = ["group", "weight"]
            fig = px.bar(sec, x="weight", y="group", orientation="h", title="Sector split")
            fig.update_layout(yaxis_title="", xaxis_tickformat=".0%")
            st.plotly_chart(fig, width="stretch")
            st.write("Exchange split: " + ", ".join(f"{k} {v:.0%}" for k, v in alloc.exchange_split().items()))
        st.subheader("Target weights")
        rc = alloc.risk_contribution()
        tbl = alloc.table()
        tbl["risk_contribution"] = tbl["symbol"].map(rc).fillna(0.0)
        st.dataframe(tbl.style.format({"weight": "{:.1%}", "exp_return": "{:.1%}", "volatility": "{:.1%}",
                                       "dividend_yield": "{:.1%}", "risk_contribution": "{:.0%}"}),
                     width="stretch", hide_index=True)
        st.subheader(f"Orders — whole shares within {_money(profile.budget, ccy)}")
        orders = alloc.lots.orders[["symbol", "name", "exchange", "currency", "price_local", "shares", "cost_base",
                                    "target_weight", "actual_weight"]]
        st.dataframe(orders.style.format({"price_local": "{:,.2f}", "cost_base": "{:,.0f}", "target_weight": "{:.1%}",
                                          "actual_weight": "{:.1%}"}), width="stretch", hide_index=True)
        st.write(f"Cash remaining: **{_money(alloc.lots.cash_base, ccy)}** "
                 f"(deliberate cash sleeve {_money(alloc.lots.cash_sleeve_base, ccy)})")
        st.download_button("Download orders (CSV)", orders.to_csv(index=False).encode(), "orders.csv", "text/csv")
        if not alloc.backtest.empty:
            bt = alloc.backtest
            fig = go.Figure(go.Scatter(x=bt.index, y=bt["value"], mode="lines", name="Mix value"))
            fig.update_layout(title="Buy-and-hold of this mix over the data window (not a forecast)",
                              yaxis_title=ccy)
            st.plotly_chart(fig, width="stretch")

with tab_project:
    if alloc is None:
        st.info("Build a portfolio first.")
    else:
        p = alloc.projection
        ccy = profile.base_currency.value
        fig = go.Figure()
        fig.add_trace(go.Scatter(x=p.years, y=p.p90, line=dict(width=0), showlegend=False))
        fig.add_trace(go.Scatter(x=p.years, y=p.p10, fill="tonexty", line=dict(width=0), name="10th–90th percentile",
                                 fillcolor="rgba(0,120,200,0.2)"))
        fig.add_trace(go.Scatter(x=p.years, y=p.p50, name="Median", line=dict(width=3)))
        if profile.target_amount:
            fig.add_hline(y=profile.target_amount, line_dash="dash", annotation_text="Target")
        fig.update_layout(title=f"Monte Carlo projection ({ccy})", xaxis_title="Years", yaxis_title=ccy)
        st.plotly_chart(fig, width="stretch")
        c1, c2, c3 = st.columns(3)
        c1.metric("Median outcome", _money(p.p50[-1], ccy))
        c2.metric("Bad case (10th pct)", _money(p.p10[-1], ccy))
        c3.metric("Good case (90th pct)", _money(p.p90[-1], ccy))
        if profile.required_return is not None:
            st.write(f"Your target needs **{profile.required_return:.1%}/yr**; this mix is expected to deliver "
                     f"**{alloc.expected_return:.1%}/yr**, so the chance of reaching it is about **{p.prob_target:.0%}**.")

with tab_data:
    st.write(f"Fetched: {md.fetched_at:%Y-%m-%d %H:%M UTC} · Sample data: {md.is_sample} · "
             f"USD/NGN: {md.latest_fx():,.2f}")
    st.dataframe(md.fundamentals, width="stretch", height=400)
    sym = st.selectbox("Price history", sorted(md.prices.columns))
    s = md.prices[sym].dropna()
    if s.empty:
        st.info("No stored price history for this symbol yet.")
    else:
        st.line_chart(s)
