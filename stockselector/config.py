"""Goal profile and constraint definitions.

Everything the selector and allocator need to know about the investor lives in
:class:`GoalProfile`. It can be built from CLI flags, the Streamlit sidebar, or
a YAML file.
"""
from __future__ import annotations

from dataclasses import asdict, dataclass, field
from enum import Enum
from pathlib import Path
from typing import Any

import yaml


class Objective(str, Enum):
    GROWTH = "growth"
    INCOME = "income"
    BALANCED = "balanced"
    PRESERVATION = "preservation"


class BaseCurrency(str, Enum):
    NGN = "NGN"
    USD = "USD"


# Factor names used throughout the scoring engine. Higher score is always better.
FACTORS = ("value", "quality", "momentum", "low_vol", "dividend", "liquidity")

# Factor weights per objective. Rows sum to 1.
DEFAULT_FACTOR_WEIGHTS: dict[Objective, dict[str, float]] = {
    Objective.GROWTH: {
        "value": 0.15, "quality": 0.25, "momentum": 0.35,
        "low_vol": 0.05, "dividend": 0.05, "liquidity": 0.15,
    },
    Objective.INCOME: {
        "value": 0.15, "quality": 0.25, "momentum": 0.05,
        "low_vol": 0.15, "dividend": 0.35, "liquidity": 0.05,
    },
    Objective.BALANCED: {
        "value": 0.20, "quality": 0.25, "momentum": 0.20,
        "low_vol": 0.15, "dividend": 0.10, "liquidity": 0.10,
    },
    Objective.PRESERVATION: {
        "value": 0.15, "quality": 0.30, "momentum": 0.05,
        "low_vol": 0.35, "dividend": 0.10, "liquidity": 0.05,
    },
}


@dataclass
class GoalProfile:
    """What the investor wants, expressed in plain terms."""

    objective: Objective = Objective.BALANCED
    #: 1 (very conservative) .. 5 (very aggressive)
    risk_tolerance: int = 3
    horizon_years: float = 5.0
    #: Amount to invest now, in ``base_currency``.
    budget: float = 1_000_000.0
    base_currency: BaseCurrency = BaseCurrency.NGN
    #: Target portfolio value at the end of the horizon (optional goal).
    target_amount: float | None = None
    #: Desired annual income as a fraction of the invested amount (income goal).
    target_income_yield: float | None = None

    # --- portfolio construction ---
    #: Number of stocks to hold from each exchange.
    picks_per_exchange: int = 8
    #: Allowed share of the portfolio in NGX names: (min, max). Set both to 0 for NYSE-only,
    #: both to 1 for NGX-only.
    ngx_weight_range: tuple[float, float] = (0.2, 0.7)
    max_weight_per_stock: float = 0.15
    max_weight_per_sector: float = 0.35
    min_weight_per_stock: float = 0.0
    #: Whether a cash / T-bill sleeve is allowed. Its expected return is ``cash_rate``.
    allow_cash: bool = True
    #: Annual risk-free rate for each currency (used for Sharpe and the cash sleeve).
    cash_rate_ngn: float = 0.18
    cash_rate_usd: float = 0.045
    #: Minimum average daily traded value (in local currency) to be eligible.
    min_avg_daily_value_ngn: float = 5_000_000.0
    min_avg_daily_value_usd: float = 20_000_000.0
    #: Factor weight overrides (partial dicts are merged over the objective default).
    factor_weight_overrides: dict[str, float] = field(default_factory=dict)

    def __post_init__(self) -> None:
        self.objective = Objective(self.objective)
        self.base_currency = BaseCurrency(self.base_currency)
        self.risk_tolerance = int(min(5, max(1, self.risk_tolerance)))
        lo, hi = self.ngx_weight_range
        if not (0 <= lo <= hi <= 1):
            raise ValueError("ngx_weight_range must satisfy 0 <= min <= max <= 1")
        if self.budget <= 0:
            raise ValueError("budget must be positive")
        if self.horizon_years <= 0:
            raise ValueError("horizon_years must be positive")
        if not (0 < self.max_weight_per_stock <= 1):
            raise ValueError("max_weight_per_stock must be in (0, 1]")

    # ------------------------------------------------------------------ helpers
    @property
    def factor_weights(self) -> dict[str, float]:
        weights = dict(DEFAULT_FACTOR_WEIGHTS[self.objective])
        weights.update({k: float(v) for k, v in self.factor_weight_overrides.items() if k in FACTORS})
        total = sum(weights.values())
        return {k: v / total for k, v in weights.items()}

    @property
    def cash_rate(self) -> float:
        return self.cash_rate_ngn if self.base_currency == BaseCurrency.NGN else self.cash_rate_usd

    @property
    def max_volatility(self) -> float:
        """Annualised volatility ceiling implied by risk tolerance (in base currency)."""
        # NGN portfolios carry FX and inflation noise, so ceilings are wider.
        table_usd = {1: 0.10, 2: 0.14, 3: 0.18, 4: 0.24, 5: 0.35}
        table_ngn = {1: 0.16, 2: 0.22, 3: 0.28, 4: 0.36, 5: 0.50}
        table = table_ngn if self.base_currency == BaseCurrency.NGN else table_usd
        return table[self.risk_tolerance]

    @property
    def required_return(self) -> float | None:
        """Annual return needed to hit ``target_amount`` within the horizon."""
        if not self.target_amount or self.target_amount <= self.budget:
            return None
        return (self.target_amount / self.budget) ** (1.0 / self.horizon_years) - 1.0

    def to_dict(self) -> dict[str, Any]:
        d = asdict(self)
        d["objective"] = self.objective.value
        d["base_currency"] = self.base_currency.value
        d["ngx_weight_range"] = list(self.ngx_weight_range)
        return d

    @classmethod
    def from_dict(cls, d: dict[str, Any]) -> "GoalProfile":
        d = dict(d)
        if "ngx_weight_range" in d:
            d["ngx_weight_range"] = tuple(d["ngx_weight_range"])
        return cls(**d)

    @classmethod
    def from_yaml(cls, path: str | Path) -> "GoalProfile":
        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_dict(yaml.safe_load(fh) or {})

    def to_yaml(self, path: str | Path) -> None:
        with open(path, "w", encoding="utf-8") as fh:
            yaml.safe_dump(self.to_dict(), fh, sort_keys=False)
