"""Turn target weights into whole-share purchase orders inside the budget."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd

from .goals import CASH

#: Minimum order size per exchange. Both default to single shares; raise NGX to
#: 100 if your broker enforces a board lot (``--ngx-lot 100`` on the CLI).
DEFAULT_LOT_SIZE = {"NGX": 1, "NYSE": 1}


@dataclass
class LotPlan:
    orders: pd.DataFrame        # symbol, exchange, currency, price_local, fx, shares, cost_local, cost_base, target_weight, actual_weight
    cash_base: float            # cash left (base currency), incl. the cash sleeve
    cash_sleeve_base: float     # part of cash that is the deliberate cash allocation
    budget_base: float
    base_currency: str
    unaffordable: list[str]     # names whose single lot costs more than their target

    @property
    def invested_base(self) -> float:
        return float(self.orders["cost_base"].sum())


def to_lots(weights: pd.Series, fundamentals: pd.DataFrame, fx_usdngn: float, budget: float,
            base_currency: str, lot_size: dict[str, int] | None = None) -> LotPlan:
    lot_size = {**DEFAULT_LOT_SIZE, **(lot_size or {})}
    base_currency = base_currency.upper()
    w = weights[weights > 0]
    cash_w = float(w.get(CASH, 0.0))
    w = w.drop(CASH, errors="ignore")
    rows = []
    for sym, tw in w.items():
        row = fundamentals.loc[sym]
        ex, ccy, px = str(row["exchange"]), str(row["currency"]).upper(), float(row["price"])
        if not (px > 0):
            continue
        # base-currency price of one share
        if ccy == base_currency:
            px_base = px
        elif ccy == "USD" and base_currency == "NGN":
            px_base = px * fx_usdngn
        else:
            px_base = px / fx_usdngn
        lot = max(1, int(lot_size.get(ex, 1)))
        target_base = tw * budget
        shares = int(np.floor(target_base / (px_base * lot))) * lot
        rows.append({"symbol": sym, "name": row["name"], "exchange": ex, "sector": row["sector"],
                     "currency": ccy, "price_local": px, "price_base": px_base, "lot": lot,
                     "shares": shares, "target_weight": float(tw)})
    orders = pd.DataFrame(rows)
    if orders.empty:
        return LotPlan(orders, budget, cash_w * budget, budget, base_currency, [])
    orders["cost_base"] = orders["shares"] * orders["price_base"]
    # Greedy top-up: spend the leftover (beyond the deliberate cash sleeve) on the
    # most under-weight name, but only when buying one more lot brings the
    # position *closer* to its target (never overshoot by more than the shortfall).
    leftover = budget - cash_w * budget - orders["cost_base"].sum()
    for _ in range(10_000):
        orders["actual_weight"] = orders["cost_base"] / budget
        gap = orders["target_weight"] - orders["actual_weight"]
        lot_w = orders["price_base"] * orders["lot"] / budget
        improves = (gap > 0) & ((gap - lot_w).abs() < gap.abs()) & (lot_w * budget <= leftover)
        if not improves.any():
            break
        i = gap[improves].idxmax()
        orders.at[i, "shares"] += orders.at[i, "lot"]
        orders.at[i, "cost_base"] = orders.at[i, "shares"] * orders.at[i, "price_base"]
        leftover -= float(lot_w[i] * budget)
    unaffordable = list(orders.loc[orders["shares"] == 0, "symbol"])
    orders["cost_local"] = orders["shares"] * orders["price_local"]
    orders["actual_weight"] = orders["cost_base"] / budget
    orders = orders.sort_values("cost_base", ascending=False).reset_index(drop=True)
    cash_left = budget - orders["cost_base"].sum()
    return LotPlan(orders=orders, cash_base=float(cash_left), cash_sleeve_base=float(cash_w * budget),
                   budget_base=float(budget), base_currency=base_currency, unaffordable=unaffordable)
