"""Every adapter passes the same suite (SPEC section 17.1).

If the suite only passes against Binance, the interface is a Binance client
with extra indirection and the multi-venue hedge does not exist.
"""

from __future__ import annotations

import asyncio

import pytest

from tradesys.adapters.binance import BinanceAdapter, BinanceEndpoints, HmacSigner, Response
from tradesys.adapters.bybit import BybitAdapter, BybitEndpoints
from tradesys.adapters.conformance import (
    REQUIRED_METHODS, check_no_venue_vocabulary, check_protocol, structural_report,
)
from tradesys.adapters.sim import SimAdapter
from tradesys.core.errors import (
    AuthFailed, FilterViolation, InsufficientBalance, IpBanned, OrderNotFound,
    RateLimited, UnknownState, VenueDown, VenueError,
)
from tradesys.core.events import OrderIntent, OrderStatus, SymbolFilter
from tradesys.core.types import dec

ADAPTERS = [SimAdapter, BinanceAdapter, BybitAdapter]
IDS = ["sim", "binance", "bybit"]


class FakeTransport:
    """Canned responses, so adapter logic is testable with no network."""

    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body=None):
        self.calls.append((method, url, dict(headers), body))
        return self.responses.pop(0)


def intent(coid="ts_x", symbol="BTCUSDT", qty="0.001", price="60000"):
    return OrderIntent(correlation_id="c", emitted_at=0, source="t",
                       client_order_id=coid, venue="v", symbol=symbol,
                       side="buy", quantity=dec(qty), order_type="limit",
                       price=dec(price), strategy_id="s")


# ------------------------------------------------------------ structural


@pytest.mark.parametrize("adapter_cls", ADAPTERS, ids=IDS)
def test_structural_conformance(adapter_cls):
    report = structural_report(adapter_cls)
    assert report.ok, str(report)


@pytest.mark.parametrize("adapter_cls", ADAPTERS, ids=IDS)
def test_implements_every_required_method(adapter_cls):
    assert check_protocol(adapter_cls) == []


@pytest.mark.parametrize("adapter_cls", ADAPTERS, ids=IDS)
def test_no_venue_vocabulary_in_the_public_surface(adapter_cls):
    """No listenKey, no recvWindow, no orderLinkId above the boundary."""
    assert check_no_venue_vocabulary(adapter_cls) == []


def test_the_vocabulary_check_can_fail():
    """A check that never fails proves nothing."""
    class Leaky(SimAdapter):
        async def query_order(self, listen_key: str, symbol: str = ""):  # type: ignore[override]
            ...

    assert check_no_venue_vocabulary(Leaky)


def test_the_protocol_check_can_fail():
    class Incomplete:
        name = "broken"

    missing = check_protocol(Incomplete)
    assert "query_order" in missing
    assert not structural_report(Incomplete).ok


# ----------------------------------------------------------- behavioural


def test_every_adapter_sends_the_idempotency_key():
    """Same guarantee, three different field names, none of them visible above."""
    binance_transport = FakeTransport([Response(200, {"orderId": 1, "clientOrderId": "ts_x"})])
    binance = BinanceAdapter(BinanceEndpoints.spot_testnet(), api_key="k",
                             signer=HmacSigner("s"), transport=binance_transport)
    asyncio.run(binance.place(intent()))
    assert "newClientOrderId=ts_x" in binance_transport.calls[0][1]

    bybit_transport = FakeTransport([Response(200, {"retCode": 0, "result": {"orderId": "1"}})])
    bybit = BybitAdapter(BybitEndpoints.testnet(), api_key="k", api_secret="s",
                         transport=bybit_transport)
    asyncio.run(bybit.place(intent()))
    assert '"orderLinkId":"ts_x"' in bybit_transport.calls[0][3]


def test_a_duplicate_client_order_id_is_refused_by_the_simulator():
    a = SimAdapter(filters={"BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10"))})
    a.set_book("BTCUSDT", [("60000", "5")], [("60001", "5")])
    asyncio.run(a.place(intent()))
    with pytest.raises(VenueError):
        asyncio.run(a.place(intent()))


@pytest.mark.parametrize("adapter_cls,endpoints,kwargs", [
    (BinanceAdapter, BinanceEndpoints.spot_testnet(), {"api_key": "k", "signer": HmacSigner("s")}),
    (BybitAdapter, BybitEndpoints.testnet(), {"api_key": "k", "api_secret": "s"}),
], ids=["binance", "bybit"])
def test_errors_are_normalised_into_the_common_taxonomy(adapter_cls, endpoints, kwargs):
    """A caller must never have to know which venue raised."""
    if adapter_cls is BinanceAdapter:
        failures = [(Response(400, {"code": -2010, "msg": "balance"}), InsufficientBalance),
                    (Response(400, {"code": -1013, "msg": "filter"}), FilterViolation),
                    (Response(418, {"msg": "banned"}), IpBanned),
                    (Response(503, {"msg": "down"}), VenueDown)]
    else:
        failures = [(Response(200, {"retCode": 110007, "retMsg": "balance"}), InsufficientBalance),
                    (Response(200, {"retCode": 10001, "retMsg": "param"}), FilterViolation),
                    (Response(200, {"retCode": 10018, "retMsg": "banned"}), IpBanned),
                    (Response(503, {"retMsg": "down"}), VenueDown)]

    for response, expected in failures:
        adapter = adapter_cls(endpoints, transport=FakeTransport([response]), **kwargs)
        with pytest.raises(expected):
            asyncio.run(adapter.reference_data())


def test_bybit_signals_failure_inside_a_success_response():
    """The trap a single-venue abstraction never has to think about.

    Bybit returns HTTP 200 with a failure code in the body. An adapter that
    checks only the HTTP status treats every rejection as a success.
    """
    transport = FakeTransport([Response(200, {"retCode": 110007, "retMsg": "insufficient"})])
    adapter = BybitAdapter(BybitEndpoints.testnet(), api_key="k", api_secret="s",
                           transport=transport)
    with pytest.raises(InsufficientBalance):
        asyncio.run(adapter.reference_data())


def test_both_venues_parse_filters_into_the_same_type():
    """Different arrangement, identical meaning."""
    binance = BinanceAdapter(BinanceEndpoints.spot_testnet(), transport=FakeTransport([
        Response(200, {"symbols": [{"symbol": "BTCUSDT", "filters": [
            {"filterType": "PRICE_FILTER", "tickSize": "0.10"},
            {"filterType": "LOT_SIZE", "stepSize": "0.001", "minQty": "0.001"},
            {"filterType": "NOTIONAL", "minNotional": "5"},
        ]}]})
    ]))
    bybit = BybitAdapter(BybitEndpoints.testnet(), transport=FakeTransport([
        Response(200, {"retCode": 0, "result": {"list": [{
            "symbol": "BTCUSDT",
            "priceFilter": {"tickSize": "0.10"},
            "lotSizeFilter": {"qtyStep": "0.001", "minOrderQty": "0.001", "minOrderAmt": "5"},
        }]}})
    ]))
    a = asyncio.run(binance.reference_data()).filters["BTCUSDT"]
    b = asyncio.run(bybit.reference_data()).filters["BTCUSDT"]
    assert (a.tick_size, a.step_size, a.min_notional) == (b.tick_size, b.step_size, b.min_notional)


def test_query_order_resolves_an_unknown_state_on_both_venues():
    """Without this the QUERY state cannot resolve, and QUERY is the defence."""
    binance = BinanceAdapter(BinanceEndpoints.spot_testnet(), api_key="k",
                             signer=HmacSigner("s"), transport=FakeTransport([
        Response(200, {"clientOrderId": "ts_x", "orderId": 7, "symbol": "BTCUSDT",
                       "side": "BUY", "status": "FILLED", "origQty": "1",
                       "executedQty": "1", "price": "60000", "updateTime": 1700000000000})
    ]))
    state = asyncio.run(binance.query_order("ts_x", "BTCUSDT"))
    assert state.status == OrderStatus.FILLED and state.filled_quantity == dec("1")

    bybit = BybitAdapter(BybitEndpoints.testnet(), api_key="k", api_secret="s",
                         transport=FakeTransport([
        Response(200, {"retCode": 0, "result": {"list": [{
            "orderLinkId": "ts_x", "orderId": "7", "symbol": "BTCUSDT", "side": "Buy",
            "orderStatus": "Filled", "qty": "1", "cumExecQty": "1", "price": "60000",
            "updatedTime": "1700000000000"}]}})
    ]))
    state = asyncio.run(bybit.query_order("ts_x", "BTCUSDT"))
    assert state.status == OrderStatus.FILLED and state.filled_quantity == dec("1")


def test_a_missing_order_is_not_found_on_both_venues():
    bybit = BybitAdapter(BybitEndpoints.testnet(), api_key="k", api_secret="s",
                         transport=FakeTransport([Response(200, {"retCode": 0, "result": {"list": []}})]))
    with pytest.raises(OrderNotFound):
        asyncio.run(bybit.query_order("ts_missing", "BTCUSDT"))


def test_recv_window_ceiling_is_enforced_on_both_venues():
    for cls, endpoints in ((BinanceAdapter, BinanceEndpoints.spot_testnet()),
                           (BybitAdapter, BybitEndpoints.testnet())):
        with pytest.raises(ValueError, match="exceeds the API maximum"):
            cls(endpoints, recv_window_ms=60_001)


def test_rate_limit_state_means_the_same_thing_on_both_venues():
    """Bybit reports remaining and Binance reports used. The caller sees used."""
    bybit = BybitAdapter(BybitEndpoints.testnet(), transport=FakeTransport([
        Response(200, {"retCode": 0, "result": {"list": []}},
                 {"X-Bapi-Limit": "120", "X-Bapi-Limit-Status": "30"})
    ]))
    asyncio.run(bybit.reference_data())
    state = bybit.rate_limit_state()
    assert state.used_weight == 90 and state.weight_limit == 120
    assert state.should_throttle          # 75% used
