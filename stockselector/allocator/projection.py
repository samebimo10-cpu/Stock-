"""Monte Carlo projection of portfolio value over the goal horizon."""
from __future__ import annotations

from dataclasses import dataclass

import numpy as np
import pandas as pd


@dataclass
class Projection:
    years: np.ndarray            # 0 .. horizon
    p10: np.ndarray
    p50: np.ndarray
    p90: np.ndarray
    mean: np.ndarray
    prob_target: float | None    # probability of ending above target_amount
    prob_loss: float             # probability of ending below the starting amount
    expected_return: float
    volatility: float
    target_amount: float | None

    def table(self) -> pd.DataFrame:
        return pd.DataFrame({"year": self.years, "p10": self.p10, "median": self.p50,
                             "p90": self.p90, "mean": self.mean})


def project(start_value: float, expected_return: float, volatility: float, horizon_years: float,
            target_amount: float | None = None, n_paths: int = 10_000, seed: int = 7,
            steps_per_year: int = 12) -> Projection:
    rng = np.random.default_rng(seed)
    n_steps = max(1, int(round(horizon_years * steps_per_year)))
    dt = 1.0 / steps_per_year
    # Lognormal model: arithmetic mean -> log drift
    drift = (np.log1p(expected_return) - 0.5 * volatility**2) * dt
    shocks = rng.standard_normal((n_paths, n_steps)) * volatility * np.sqrt(dt)
    log_paths = np.cumsum(drift + shocks, axis=1)
    paths = start_value * np.exp(np.hstack([np.zeros((n_paths, 1)), log_paths]))
    years = np.arange(n_steps + 1) * dt
    final = paths[:, -1]
    return Projection(
        years=years,
        p10=np.percentile(paths, 10, axis=0), p50=np.percentile(paths, 50, axis=0),
        p90=np.percentile(paths, 90, axis=0), mean=paths.mean(axis=0),
        prob_target=float((final >= target_amount).mean()) if target_amount else None,
        prob_loss=float((final < start_value).mean()),
        expected_return=expected_return, volatility=volatility, target_amount=target_amount,
    )
