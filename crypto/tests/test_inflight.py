"""Regressions for three bugs a round-trip scenario exposed.

None of them were visible with a single entry and no exit, which is the
argument for building a scenario that actually round-trips before believing
any number that comes out of a backtest.
"""

from __future__ import annotations

import asyncio

import pytest

from tradesys.adapters.sim import SimAdapter
from tradesys.core.events import OrderIntent, OrderStatus, RiskDecision, SymbolFilter
from tradesys.core.types import dec
from tradesys.demo import PERP_VENUE, build_cycling_events, build_pipeline
from tradesys.layers.l6_execution.executor import Executor
from tradesys.research.backtest import Backtester
from tradesys.research.registry import TrialRegistry

FILTERS = {"BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10"))}
NOW = 1_700_000_000_000_000_000


def intent(coid, side="buy", qty="1", price="60000"):
    return OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                       client_order_id=coid, venue="sim", symbol="BTCUSDT",
                       side=side, quantity=dec(qty), order_type="limit",
                       price=dec(price), post_only=True, strategy_id="s")


def approve(i):
    return RiskDecision(correlation_id="c", emitted_at=NOW, source="l5_risk",
                        intent_id=i.client_order_id, approved=True,
                        adjusted_quantity=i.quantity)


def sim():
    a = SimAdapter(filters=FILTERS)
    a.set_book("BTCUSDT", [("60000", "50")], [("60001", "50")])
    return a


# ------------------------------------------------- orders in flight count


def test_in_flight_counts_working_orders():
    """Sizing from the held position alone re-sends the same order every event."""
    adapter = sim()
    ex = Executor(adapter, FILTERS, clock=lambda: adapter.now)
    assert ex.in_flight("sim", "BTCUSDT") == dec(0)

    i = intent("ts_a", qty="2")
    asyncio.run(ex.submit(i, approve(i)))
    assert ex.in_flight("sim", "BTCUSDT") == dec("2")


def test_in_flight_is_signed():
    adapter = sim()
    ex = Executor(adapter, FILTERS, clock=lambda: adapter.now)
    buy, sell = intent("ts_b", "buy", "3"), intent("ts_s", "sell", "1", "60001")
    asyncio.run(ex.submit(buy, approve(buy)))
    asyncio.run(ex.submit(sell, approve(sell)))
    assert ex.in_flight("sim", "BTCUSDT") == dec("2")


def test_an_order_of_unknown_state_still_counts_as_in_flight():
    """It may well be live. Assuming it is not is how you hold two of it."""
    adapter = sim()
    adapter.faults.drop_response_after_accept = True
    ex = Executor(adapter, FILTERS, clock=lambda: adapter.now)
    i = intent("ts_q", qty="2")
    result = asyncio.run(ex.submit(i, approve(i)))
    assert result.machine.status == OrderStatus.QUERY
    assert ex.in_flight("sim", "BTCUSDT") == dec("2")


def test_terminal_orders_stop_counting():
    adapter = sim()
    ex = Executor(adapter, FILTERS, clock=lambda: adapter.now)
    i = intent("ts_c", qty="2")
    asyncio.run(ex.submit(i, approve(i)))
    asyncio.run(ex.cancel("ts_c"))
    assert ex.in_flight("sim", "BTCUSDT") == dec(0)


def test_other_symbols_do_not_count():
    adapter = SimAdapter(filters={
        "BTCUSDT": FILTERS["BTCUSDT"],
        "ETHUSDT": SymbolFilter("ETHUSDT", dec("0.01"), dec("0.0001"), dec("10")),
    })
    adapter.set_book("BTCUSDT", [("60000", "50")], [("60001", "50")])
    adapter.set_book("ETHUSDT", [("3000", "50")], [("3001", "50")])
    ex = Executor(adapter, FILTERS, clock=lambda: adapter.now)
    i = intent("ts_d", qty="2")
    asyncio.run(ex.submit(i, approve(i)))
    assert ex.in_flight("sim", "ETHUSDT") == dec(0)


def test_the_pipeline_does_not_stack_orders_toward_one_target():
    """The bug: a target repeated across events produced one order per event.

    They then all filled, leaving a position several times the intended size
    and pointing the wrong way after an exit.
    """
    events = build_cycling_events()
    pipeline, adapters, _ = build_pipeline()
    result = asyncio.run(
        Backtester(pipeline, adapters, TrialRegistry(), "fc").run(events)
    )
    assert result.fills >= 4, "the scenario must round-trip or it tests nothing"
    assert not pipeline.books.positions, (
        f"left holding {pipeline.books.positions} after every exit signal"
    )


def test_a_carry_strategy_collects_funding_rather_than_paying_it():
    """A short perpetual receives funding when the rate is positive.

    Paying it is the signature of a position that ended up long, which is what
    stacked orders produce.
    """
    pipeline, adapters, _ = build_pipeline()
    result = asyncio.run(
        Backtester(pipeline, adapters, TrialRegistry(), "fc").run(build_cycling_events())
    )
    assert result.books.strategies["funding_carry"].funding > 0


# --------------------------------------------------- the simulated clock


def test_the_venue_clock_advances_with_the_data():
    """Without it every fill carries the same timestamp.

    Nothing that depends on elapsed time - latency, order ageing, funding
    intervals - can work, and the defect is invisible until something does.
    """
    adapter = sim()
    start = adapter.now
    events = build_cycling_events()
    for event in events[:20]:
        adapter.apply_market_event(event)
    assert adapter.now > start


def test_fills_do_not_all_share_one_timestamp():
    pipeline, adapters, _ = build_pipeline()
    asyncio.run(Backtester(pipeline, adapters, TrialRegistry(), "fc").run(build_cycling_events()))
    stamps = {f.exchange_ts for f in adapters[PERP_VENUE].fills}
    assert len(stamps) > 1


# ---------------------------------------------------------- latency


def test_an_order_cannot_fill_before_it_arrives():
    adapter = SimAdapter(filters=FILTERS, order_latency_ns=50_000_000)
    adapter.set_book("BTCUSDT", [("60000", "50")], [("60001", "50")])
    i = OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                    client_order_id="ts_l", venue="sim", symbol="BTCUSDT",
                    side="buy", quantity=dec("1"), order_type="market", strategy_id="s")
    asyncio.run(adapter.place(i))
    assert adapter.step() == [], "filled while still in flight"

    adapter.advance(60_000_000)
    fills = adapter.step()
    assert len(fills) == 1


def test_a_crossing_order_executes_against_the_book_on_arrival():
    """The cost of latency: the price you decided on is not the price you get."""
    adapter = SimAdapter(filters=FILTERS, order_latency_ns=50_000_000)
    adapter.set_book("BTCUSDT", [("60000", "50")], [("60001", "50")])
    i = OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                    client_order_id="ts_m", venue="sim", symbol="BTCUSDT",
                    side="buy", quantity=dec("1"), order_type="market", strategy_id="s")
    asyncio.run(adapter.place(i))

    adapter.set_book("BTCUSDT", [("60010", "50")], [("60011", "50")])   # it moved
    adapter.advance(60_000_000)
    fills = adapter.step()
    assert fills[0].price >= dec("60011"), "filled at the pre-decision price"


def test_fill_latency_delays_when_we_learn_not_when_it_happened():
    adapter = SimAdapter(filters=FILTERS, fill_latency_ns=15_000_000)
    adapter.set_book("BTCUSDT", [("60000", "50")], [("60001", "50")])
    i = OrderIntent(correlation_id="c", emitted_at=NOW, source="t",
                    client_order_id="ts_f", venue="sim", symbol="BTCUSDT",
                    side="buy", quantity=dec("1"), order_type="market", strategy_id="s")
    asyncio.run(adapter.place(i))
    fill = adapter.fills[0]
    assert fill.local_recv_ts - fill.exchange_ts == 15_000_000


def test_zero_latency_is_the_default_and_is_not_realistic():
    """A backtest left at zero is not modelling reality; it must be set."""
    assert SimAdapter().order_latency_ns == 0
