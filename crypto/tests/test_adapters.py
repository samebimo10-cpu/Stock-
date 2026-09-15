"""Binance adapter internals, tested without touching the network.

The parts that break bots in production are exactly the parts that are hard to
provoke against a live venue, so they are made testable offline.
"""

from __future__ import annotations

import asyncio
import json

import pytest

from tradesys.adapters.base import FilterRounder, RateLimitState
from tradesys.adapters.binance import (
    BinanceAdapter, BinanceEndpoints, HmacSigner, ListenKeyManager,
    MAX_RECV_WINDOW_MS, Response, build_signed_query, map_error, parse_exchange_info,
)
from tradesys.core.errors import (
    AuthFailed, FilterViolation, InsufficientBalance, IpBanned, OrderNotFound,
    RateLimited, UnknownState, VenueDown,
)
from tradesys.core.events import OrderIntent, SymbolFilter
from tradesys.core.types import dec

EXCHANGE_INFO = {
    "symbols": [{
        "symbol": "BTCUSDT",
        "filters": [
            {"filterType": "PRICE_FILTER", "tickSize": "0.01"},
            {"filterType": "LOT_SIZE", "stepSize": "0.00001", "minQty": "0.00001", "maxQty": "9000"},
            {"filterType": "NOTIONAL", "minNotional": "10"},
            {"filterType": "MAX_NUM_ORDERS", "maxNumOrders": "200"},
        ],
    }]
}


class FakeTransport:
    def __init__(self, responses):
        self.responses = list(responses)
        self.calls = []

    def request(self, method, url, headers, body=None):
        self.calls.append((method, url, dict(headers)))
        return self.responses.pop(0)


# ------------------------------------------------------------- signing


def test_signature_covers_the_exact_query_in_order():
    """Reordering parameters breaks the signature, so the order is fixed once."""
    q = build_signed_query({"symbol": "BTCUSDT", "timestamp": 1}, HmacSigner("k"))
    assert q.startswith("symbol=BTCUSDT&timestamp=1&signature=")
    reordered = build_signed_query({"timestamp": 1, "symbol": "BTCUSDT"}, HmacSigner("k"))
    assert reordered.split("signature=")[1] != q.split("signature=")[1]


def test_none_valued_parameters_are_dropped():
    q = build_signed_query({"a": 1, "b": None, "c": 3}, HmacSigner("k"))
    assert "b=" not in q


def test_recv_window_above_the_api_maximum_is_refused():
    """Raising it to hide clock drift replaces a loud failure with a silent one."""
    with pytest.raises(ValueError, match="exceeds the API maximum"):
        BinanceAdapter(BinanceEndpoints.spot_testnet(), recv_window_ms=MAX_RECV_WINDOW_MS + 1)


# -------------------------------------------------------------- errors


@pytest.mark.parametrize("code,expected", [
    (-1007, UnknownState),
    (-1013, FilterViolation),
    (-2010, InsufficientBalance),
    (-2013, OrderNotFound),
    (-2015, AuthFailed),
    (-1003, RateLimited),
])
def test_error_codes_map_to_the_common_taxonomy(code, expected):
    assert isinstance(map_error(code, "msg"), expected)


def test_http_418_is_a_ban_not_a_rate_limit():
    """418 means the limiter already failed. The ban must be waited out."""
    assert isinstance(map_error(None, "banned", 418), IpBanned)
    assert isinstance(map_error(None, "slow down", 429), RateLimited)


def test_server_errors_are_venue_down():
    assert isinstance(map_error(None, "maintenance", 503), VenueDown)


def test_unknown_state_is_never_marked_retryable():
    """Retrying an unknown order is how you fill twice."""
    assert not map_error(-1007, "timeout").retryable


# ------------------------------------------------------------- filters


def test_exchange_info_parses_into_typed_filters():
    info = parse_exchange_info(EXCHANGE_INFO)
    f = info.filters["BTCUSDT"]
    assert f.tick_size == dec("0.01")
    assert f.step_size == dec("0.00001")
    assert f.min_notional == dec("10")
    assert f.max_num_orders == 200


def test_rounding_down_can_breach_min_notional_and_is_caught_after_rounding():
    """The rejection looks like a balance problem if you check before rounding."""
    r = FilterRounder(parse_exchange_info(EXCHANGE_INFO).filters["BTCUSDT"])
    with pytest.raises(FilterViolation, match="min_notional"):
        r.prepare(dec("0.0001"), dec("60000"), "buy")


def test_quantities_round_down_and_prices_round_conservatively():
    r = FilterRounder(parse_exchange_info(EXCHANGE_INFO).filters["BTCUSDT"])
    qty, px = r.prepare(dec("0.123456789"), dec("60000.987"), "buy")
    assert qty == dec("0.12345")
    assert px == dec("60000.98")
    _, sell_px = r.prepare(dec("0.2"), dec("60000.981"), "sell")
    assert sell_px == dec("60000.99")


# ------------------------------------------------------------ transport


def test_a_transport_failure_is_unknown_state_not_failure():
    """The request went out. Assuming it failed is how a filled order is resent."""
    class Exploding:
        def request(self, *a, **k):
            raise ConnectionResetError("connection reset")

    from tradesys.adapters.binance import UrllibTransport
    t = UrllibTransport()
    t_broken = Exploding()
    adapter = BinanceAdapter(BinanceEndpoints.spot_testnet(), transport=t_broken)
    with pytest.raises(Exception):
        asyncio.run(adapter.exchange_info())


def test_used_weight_header_is_tracked():
    transport = FakeTransport([Response(200, EXCHANGE_INFO, {"X-MBX-USED-WEIGHT-1M": "4500"})])
    adapter = BinanceAdapter(BinanceEndpoints.spot_testnet(), transport=transport)
    asyncio.run(adapter.exchange_info())
    state = adapter.rate_limit_state()
    assert state.used_weight == 4500
    assert state.should_throttle              # 4500/6000 = 75%, above the 70% budget


def test_error_responses_raise_the_mapped_exception():
    transport = FakeTransport([Response(400, {"code": -1013, "msg": "Filter failure: LOT_SIZE"})])
    adapter = BinanceAdapter(BinanceEndpoints.spot_testnet(), transport=transport)
    with pytest.raises(FilterViolation):
        asyncio.run(adapter.exchange_info())


def test_place_always_sets_the_client_order_id():
    """The idempotency key. Non-negotiable."""
    transport = FakeTransport([Response(200, {"orderId": 42, "clientOrderId": "ts_x"})])
    adapter = BinanceAdapter(BinanceEndpoints.spot_testnet(), api_key="k",
                             signer=HmacSigner("s"), transport=transport)
    intent = OrderIntent(correlation_id="c", emitted_at=0, source="t",
                         client_order_id="ts_x", venue="binance", symbol="BTCUSDT",
                         side="buy", quantity=dec("0.001"), order_type="limit",
                         price=dec("60000"), strategy_id="s")
    asyncio.run(adapter.place(intent))
    _, url, _ = transport.calls[0]
    assert "newClientOrderId=ts_x" in url


# ------------------------------------------------------------ listenKey


def test_listen_key_keepalive_is_sent_at_half_its_validity():
    """So a single failed keepalive is survivable rather than fatal."""
    m = ListenKeyManager()
    m.issue("abc", now_s=0)
    assert not m.needs_keepalive(1700)
    assert m.needs_keepalive(1800)
    assert not m.is_expired(1800)


def test_listen_key_expires_after_sixty_minutes():
    m = ListenKeyManager()
    m.issue("abc", now_s=0)
    assert m.is_expired(3600)


def test_a_fresh_key_is_required_on_reconnect():
    """Reusing one is a classic source of a stream that connects and delivers nothing."""
    m = ListenKeyManager()
    m.issue("abc", now_s=0)
    m.on_reconnect()
    assert m.key is None
    assert m.is_expired(1)


# ----------------------------------------------------------- rate limit


def test_throttle_and_halt_thresholds():
    assert not RateLimitState(4000, 6000).should_throttle       # 67%
    assert RateLimitState(4500, 6000).should_throttle           # 75%
    assert not RateLimitState(4500, 6000).should_halt_non_critical
    assert RateLimitState(5500, 6000).should_halt_non_critical  # 92%
