"""Shared fixtures."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "src"))

from tradesys.adapters.sim import FaultInjector, SimAdapter          # noqa: E402
from tradesys.core.events import FeeSchedule, SymbolFilter           # noqa: E402
from tradesys.core.types import dec                                  # noqa: E402
from tradesys.layers.l5_risk.limits import LimitRegister             # noqa: E402
from tradesys.layers.l5_risk.state import PortfolioState             # noqa: E402
from tradesys.layers.l5_risk.service import RiskService              # noqa: E402
from tradesys.layers.l6_execution.executor import Executor           # noqa: E402

LIMITS_PATH = ROOT / "risk" / "limits.yaml"


@pytest.fixture
def filters():
    return {
        "BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10")),
        "ETHUSDT": SymbolFilter("ETHUSDT", dec("0.01"), dec("0.0001"), dec("10")),
    }


@pytest.fixture
def limits():
    return LimitRegister.from_yaml(LIMITS_PATH)


@pytest.fixture
def state():
    st = PortfolioState(cash=dec("100000"))
    st.median_order_notional = dec("1000")
    st.mark()
    return st


@pytest.fixture
def adapter(filters):
    a = SimAdapter(filters=filters,
                   fees=FeeSchedule("sim", dec("0.0002"), dec("0.0005")),
                   faults=FaultInjector())
    a.set_book("BTCUSDT", [("60000", "5")], [("60001", "5")])
    a.set_balance("USDT", "100000")
    return a


@pytest.fixture
def risk(limits, state):
    return RiskService(limits, state)


@pytest.fixture
def executor(adapter, filters):
    return Executor(adapter, filters, clock=lambda: adapter.now)
