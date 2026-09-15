"""Books, attribution and capacity (SPEC section 12)."""

from __future__ import annotations

import pytest

from tradesys.accounting import Books, allocate_shared_costs, estimate_capacity
from tradesys.core.events import Fill
from tradesys.core.types import dec
from tradesys.layers.l5_risk.state import PortfolioState


def fill(side, price, qty="1", fee="30", strategy="carry", symbol="BTCUSDT"):
    return Fill(correlation_id="c", emitted_at=0, source="t", client_order_id="a",
                venue_order_id="v", venue="sim", symbol=symbol, side=side,
                quantity=dec(qty), price=dec(price), fee=dec(fee), strategy_id=strategy)


def books():
    b = Books(dec("100000"))
    b.mark("sim", "BTCUSDT", dec("60000"))
    return b


# ----------------------------------------------------------------- equity


def test_one_definition_of_equity():
    """Two definitions in one system means two drawdown numbers and an argument."""
    b = books()
    b.on_fill(fill("buy", "60000"))
    b.mark("sim", "BTCUSDT", dec("61000"))

    state = PortfolioState()
    b.apply_to(state)
    assert state.equity == b.equity
    assert state.unrealised == b.unrealised
    assert state.positions == b.positions


def test_unrealised_uses_the_mark_not_the_last_fill():
    b = books()
    b.on_fill(fill("buy", "60000"))
    assert b.unrealised == dec(0)
    b.mark("sim", "BTCUSDT", dec("61000"))
    assert b.unrealised == dec("1000")


# ------------------------------------------------------------- positions


def test_closing_realises_and_clears_unrealised():
    """A ledger that keeps reporting profit on a closed position inflates forever."""
    b = books()
    b.on_fill(fill("buy", "60000"))
    b.mark("sim", "BTCUSDT", dec("61000"))
    led = b.strategies["carry"]
    assert led.unrealised == dec("1000")

    b.on_fill(fill("sell", "61000"))
    led = b.strategies["carry"]
    assert led.realised == dec("1000")
    assert led.unrealised == dec(0)
    assert led.net_pnl == dec("940")            # 1000 realised, 60 of fees
    assert b.reconciles()


def test_partial_reduction_realises_only_the_closed_part():
    b = books()
    b.on_fill(fill("buy", "60000", qty="2", fee="0"))
    b.on_fill(fill("sell", "61000", qty="1", fee="0"))
    assert b.realised == dec("1000")
    assert b.positions[("sim", "BTCUSDT")].quantity == dec("1")
    assert b.positions[("sim", "BTCUSDT")].avg_entry_price == dec("60000")


def test_flipping_through_zero_realises_the_whole_old_position():
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    b.on_fill(fill("sell", "61000", qty="3", fee="0"))
    assert b.realised == dec("1000")
    pos = b.positions[("sim", "BTCUSDT")]
    assert pos.quantity == dec("-2")
    assert pos.avg_entry_price == dec("61000")   # the new short opens at the fill


def test_averaging_up():
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    b.on_fill(fill("buy", "62000", qty="1", fee="0"))
    assert b.positions[("sim", "BTCUSDT")].avg_entry_price == dec("61000")


# --------------------------------------------------------------- funding


def test_a_short_receives_funding_when_the_rate_is_positive():
    b = books()
    b.on_fill(fill("sell", "60000", qty="1", fee="0"))
    received = b.accrue_funding("sim", "BTCUSDT", dec("0.0001"), dec("1"), "carry")
    assert received == dec("6")                  # 60000 notional at 1bp
    assert b.accrued_funding == dec("6")


def test_a_long_pays_funding_when_the_rate_is_positive():
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    paid = b.accrue_funding("sim", "BTCUSDT", dec("0.0001"), dec("1"), "carry")
    assert paid == dec("-6")


def test_funding_accrues_continuously():
    """Lumpy booking puts step changes into the curve drawdown is measured on."""
    b = books()
    b.on_fill(fill("sell", "60000", qty="1", fee="0"))
    quarter = b.accrue_funding("sim", "BTCUSDT", dec("0.0001"), dec("0.25"), "carry")
    assert quarter == dec("1.5")


def test_settlement_moves_accrual_into_cash():
    b = books()
    b.on_fill(fill("sell", "60000", qty="1", fee="0"))
    b.accrue_funding("sim", "BTCUSDT", dec("0.0001"), dec("1"), "carry")
    cash_before = b.cash
    settled = b.settle_funding("sim", "BTCUSDT")
    assert settled == dec("6")
    assert b.cash == cash_before + dec("6")
    assert b.accrued_funding == dec(0)
    assert b.reconciles()


def test_funding_on_a_flat_book_is_zero():
    assert books().accrue_funding("sim", "BTCUSDT", dec("0.0001"), dec("1"), "carry") == dec(0)


def test_only_shorts_accrue_borrow():
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    assert b.accrue_borrow("sim", "BTCUSDT", dec("0.0002"), dec("1"), "carry") == dec(0)
    b.on_fill(fill("sell", "60000", qty="2", fee="0"))
    assert b.accrue_borrow("sim", "BTCUSDT", dec("0.0002"), dec("1"), "carry") > 0


# ----------------------------------------------------------- attribution


def test_two_strategies_are_attributed_separately():
    b = books()
    b.on_fill(fill("buy", "60000", strategy="carry", fee="10"))
    b.on_fill(fill("buy", "60000", strategy="statarb", fee="20"))
    b.mark("sim", "BTCUSDT", dec("61000"))

    assert b.strategies["carry"].fees == dec("10")
    assert b.strategies["statarb"].fees == dec("20")
    assert b.positions[("sim", "BTCUSDT")].quantity == dec("2")     # netted at book level
    assert b.strategies["carry"].unrealised == dec("1000")
    assert b.strategies["statarb"].unrealised == dec("1000")


def test_an_internal_crossing_is_booked_to_both_sides():
    """Otherwise the netted-away strategy looks as though it never traded."""
    b = books()
    b.book_internal_cross("sim", "BTCUSDT", "carry", "statarb", dec("1"), dec("60000"))
    assert b.strategies["carry"].positions[("sim", "BTCUSDT")][0] == dec("1")
    assert b.strategies["statarb"].positions[("sim", "BTCUSDT")][0] == dec("-1")


def test_the_cost_gate_is_forty_percent():
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    b.mark("sim", "BTCUSDT", dec("60100"))       # 100 of gross
    led = b.strategies["carry"]
    led.fees = dec("30")
    assert led.cost_ratio == dec("0.3")
    assert led.passes_cost_gate
    led.fees = dec("50")
    assert not led.passes_cost_gate


def test_cost_ratio_is_none_when_gross_is_not_positive():
    """A ratio against a negative denominator is not a number to act on."""
    b = books()
    b.on_fill(fill("buy", "60000", qty="1", fee="0"))
    b.mark("sim", "BTCUSDT", dec("59000"))
    assert b.strategies["carry"].cost_ratio is None
    assert not b.strategies["carry"].passes_cost_gate


def test_maker_ratio():
    b = books()
    b.on_fill(fill("buy", "60000", fee="1"))
    maker = fill("buy", "60000", fee="1")
    object.__setattr__(maker, "is_maker", True)
    b.on_fill(maker)
    assert b.maker_ratio() == dec("0.5")


# ---------------------------------------------------------- shared costs


def test_shared_costs_split_by_risk_contribution():
    """Profitable gross and unprofitable after the data bill is unprofitable."""
    split = allocate_shared_costs(dec("1000"), {"carry": 0.6, "statarb": 0.4})
    assert split == {"carry": dec("600"), "statarb": dec("400")}


def test_shared_costs_split_evenly_with_no_risk_data():
    split = allocate_shared_costs(dec("1000"), {"a": 0.0, "b": 0.0})
    assert split == {"a": dec("500"), "b": dec("500")}


# --------------------------------------------------------------- capacity


def test_capacity_is_where_net_return_halves():
    est = estimate_capacity(
        [(dec("10000"), dec("0.20")), (dec("50000"), dec("0.15")), (dec("200000"), dec("0.08"))],
        "book depth",
    )
    assert est.capacity == dec("200000")
    assert est.deploy_at_most == dec("50000.00")     # 25% of the estimate
    assert est.binding_constraint == "book depth"
    assert est.is_known


def test_a_strategy_with_no_edge_has_no_capacity():
    est = estimate_capacity([(dec("10000"), dec("-0.05"))])
    assert not est.is_known
    assert est.binding_constraint == "no edge at any size"


def test_an_unestimated_capacity_is_not_known():
    """SPEC section 1.2: without a number the strategy cannot be sized."""
    assert not estimate_capacity([]).is_known
