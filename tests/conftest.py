import pytest

from stockselector.config import GoalProfile
from stockselector.data import load_market_data


@pytest.fixture(scope="session")
def md():
    return load_market_data(mode="sample")


@pytest.fixture
def profile():
    return GoalProfile(objective="balanced", risk_tolerance=3, budget=5_000_000, base_currency="NGN",
                       horizon_years=5, target_amount=9_000_000)
