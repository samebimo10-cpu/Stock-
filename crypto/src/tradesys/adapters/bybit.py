"""Bybit V5 adapter.

The second real venue. SPEC section 17.1: an adapter interface with one working
implementation is a Binance client with extra indirection, and the regulatory
hedge of SPEC section 18.3 - switch venues rather than shut down - is only real
if a second venue actually works.

Bybit differs from Binance in every surface detail and in none of the shape,
which is the point. Everything below is contained here:

============================  ==========================  =========================
concept                       Binance                      Bybit V5
============================  ==========================  =========================
idempotency key               ``newClientOrderId``         ``orderLinkId``
success/failure signal        HTTP status                  ``retCode`` in a 200 body
auth                          query string signature       header signature
filters                       ``exchangeInfo``             ``instruments-info``
unknown order query           ``GET /api/v3/order``        ``GET /v5/order/realtime``
rate limit signal             ``X-MBX-USED-WEIGHT-1M``     ``X-Bapi-Limit-Status``
============================  ==========================  =========================

The second row is the one that matters most. Bybit returns HTTP 200 with a
failure code in the body, so an adapter that checks only the HTTP status treats
every rejection as a success. That is the class of bug a single-venue
abstraction never has to think about.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
from dataclasses import dataclass
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional

from ..core.errors import (
    AuthFailed,
    CancelRejected,
    FilterViolation,
    InsufficientBalance,
    IpBanned,
    OrderNotFound,
    RateLimited,
    UnknownState,
    VenueDown,
    VenueError,
)
from ..core.events import (
    Balance,
    BookSnapshot,
    ExchangeInfo,
    FeeSchedule,
    OrderIntent,
    OrderState,
    OrderStatus,
    Position,
    SymbolFilter,
)
from ..core.types import Decimal as Dec, Nanos, dec, ms_to_ns
from .base import CancelAck, OrderAck, RateLimitState
from .binance import Response, Transport, UrllibTransport

__all__ = ["BybitAdapter", "BybitEndpoints", "map_error", "parse_instruments",
           "sign_headers", "MAX_RECV_WINDOW_MS"]

MAX_RECV_WINDOW_MS = 60_000
DEFAULT_RECV_WINDOW_MS = 5_000


@dataclass(frozen=True)
class BybitEndpoints:
    rest: str
    ws: str
    name: str

    @staticmethod
    def production() -> "BybitEndpoints":
        return BybitEndpoints("https://api.bybit.com", "wss://stream.bybit.com/v5", "bybit")

    @staticmethod
    def testnet() -> "BybitEndpoints":
        return BybitEndpoints("https://api-testnet.bybit.com",
                              "wss://stream-testnet.bybit.com/v5", "bybit-testnet")


# --------------------------------------------------------------------------
# Signing
# --------------------------------------------------------------------------


def sign_headers(api_key: str, secret: str, timestamp_ms: int, recv_window_ms: int,
                 payload: str) -> Dict[str, str]:
    """Bybit signs ``timestamp + api_key + recv_window + payload`` into a header.

    Binance signs the query string and appends the signature to it; Bybit signs
    a concatenation and puts it in a header. Same guarantee, entirely different
    plumbing, and neither shape appears above the adapter boundary.

    >>> h = sign_headers("k", "s", 1700000000000, 5000, "symbol=BTCUSDT")
    >>> sorted(h)
    ['X-BAPI-API-KEY', 'X-BAPI-RECV-WINDOW', 'X-BAPI-SIGN', 'X-BAPI-TIMESTAMP']
    """
    material = f"{timestamp_ms}{api_key}{recv_window_ms}{payload}"
    signature = hmac.new(secret.encode(), material.encode(), hashlib.sha256).hexdigest()
    return {
        "X-BAPI-API-KEY": api_key,
        "X-BAPI-TIMESTAMP": str(timestamp_ms),
        "X-BAPI-RECV-WINDOW": str(recv_window_ms),
        "X-BAPI-SIGN": signature,
    }


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------

#: Bybit V5 return codes, normalised into the common taxonomy.
_ERROR_MAP: Dict[int, type] = {
    10001: FilterViolation,      # parameter error
    10002: VenueError,           # request timestamp outside recv_window
    10003: AuthFailed,           # invalid api key
    10004: AuthFailed,           # bad signature
    10005: AuthFailed,           # permission denied
    10006: RateLimited,          # too many visits
    10016: VenueDown,            # service unavailable
    10018: IpBanned,             # ip rate limit exceeded
    110001: OrderNotFound,
    110004: InsufficientBalance,
    110007: InsufficientBalance,
    110012: InsufficientBalance,
    110017: FilterViolation,     # reduce-only rule violated
    110025: CancelRejected,      # position status not modified
    110045: FilterViolation,     # qty exceeds limits
    170131: InsufficientBalance,
    170140: FilterViolation,     # order value below minimum
}


def map_error(ret_code: Optional[int], message: str,
              http_status: Optional[int] = None) -> VenueError:
    """Normalise a Bybit failure. Nothing venue-specific escapes this function."""
    if http_status == 403:
        return IpBanned(f"bybit blocked the request: {message}", venue_code=403)
    if http_status == 429:
        return RateLimited(f"bybit rate limited: {message}", venue_code=429)
    if http_status is not None and http_status >= 500:
        return VenueDown(f"bybit {http_status}: {message}", venue_code=http_status)
    cls = _ERROR_MAP.get(ret_code or 0, VenueError)
    return cls(f"bybit {ret_code}: {message}", venue_code=ret_code)


# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------


def parse_instruments(payload: Mapping[str, Any], venue: str = "bybit") -> ExchangeInfo:
    """Turn ``GET /v5/market/instruments-info`` into typed filters.

    Bybit nests its filters under ``lotSizeFilter`` and ``priceFilter`` rather
    than listing them by type. Different arrangement, identical meaning, and
    the caller sees the same :class:`SymbolFilter` either way.
    """
    out: Dict[str, SymbolFilter] = {}
    for item in payload.get("result", {}).get("list", []):
        symbol = item.get("symbol")
        lot = item.get("lotSizeFilter", {})
        price = item.get("priceFilter", {})
        if not symbol or "qtyStep" not in lot or "tickSize" not in price:
            continue
        out[symbol] = SymbolFilter(
            symbol=symbol,
            tick_size=dec(str(price["tickSize"])),
            step_size=dec(str(lot["qtyStep"])),
            min_notional=dec(str(lot.get("minOrderAmt", lot.get("minNotionalValue", "0")))),
            min_qty=dec(str(lot.get("minOrderQty", "0"))),
            max_qty=dec(str(lot["maxOrderQty"])) if lot.get("maxOrderQty") else None,
        )
    return ExchangeInfo(venue=venue, filters=out, fetched_at=time.time_ns())


_STATUS_MAP = {
    "New": OrderStatus.ACKED,
    "PartiallyFilled": OrderStatus.PARTIAL,
    "Filled": OrderStatus.FILLED,
    "Cancelled": OrderStatus.CANCELLED,
    "Rejected": OrderStatus.REJECTED,
    "Deactivated": OrderStatus.CANCELLED,
    "Untriggered": OrderStatus.ACKED,
}


# --------------------------------------------------------------------------
# Adapter
# --------------------------------------------------------------------------


class BybitAdapter:
    """Implements the same :class:`~tradesys.adapters.base.VenueAdapter` protocol."""

    #: Set per instance, because one class serves production and testnet and
    #: they must be distinguishable in the audit trail. Declared here so the
    #: conformance check can see that the contract is met.
    name: str = ""

    def __init__(
        self,
        endpoints: BybitEndpoints,
        api_key: str = "",
        api_secret: str = "",
        transport: Optional[Transport] = None,
        recv_window_ms: int = DEFAULT_RECV_WINDOW_MS,
        category: str = "linear",
    ) -> None:
        if recv_window_ms > MAX_RECV_WINDOW_MS:
            raise ValueError(
                f"recvWindow {recv_window_ms} exceeds the API maximum {MAX_RECV_WINDOW_MS}"
            )
        self.name = endpoints.name
        self.endpoints = endpoints
        self.api_key = api_key
        self.api_secret = api_secret
        self.transport = transport or UrllibTransport()
        self.recv_window_ms = recv_window_ms
        self.category = category
        self._limit_status = 0
        self._limit = 120

    # -- plumbing --------------------------------------------------------

    def _call(self, method: str, path: str, params: Optional[Dict[str, Any]] = None,
              signed: bool = False) -> Any:
        params = dict(params or {})
        headers: Dict[str, str] = {}
        body = None
        url = f"{self.endpoints.rest}{path}"

        if method == "GET":
            query = urllib.parse.urlencode([(k, v) for k, v in params.items() if v is not None])
            payload = query
            if query:
                url = f"{url}?{query}"
        else:
            body = json.dumps(params, separators=(",", ":"))
            payload = body
            headers["Content-Type"] = "application/json"

        if signed:
            if not self.api_key or not self.api_secret:
                raise AuthFailed("signed request with no credentials configured")
            headers.update(sign_headers(self.api_key, self.api_secret,
                                        int(time.time() * 1000), self.recv_window_ms, payload))

        resp = self.transport.request(method, url, headers, body)

        status = resp.headers.get("X-Bapi-Limit-Status") or resp.headers.get("x-bapi-limit-status")
        limit = resp.headers.get("X-Bapi-Limit") or resp.headers.get("x-bapi-limit")
        if status is not None:
            try:
                # Bybit reports remaining, not used. Convert so the common
                # RateLimitState always means the same thing.
                self._limit = int(limit) if limit else self._limit
                self._limit_status = self._limit - int(status)
            except (TypeError, ValueError):
                pass

        if resp.status != 200:
            body_map = resp.body if isinstance(resp.body, dict) else {}
            raise map_error(body_map.get("retCode"), str(body_map.get("retMsg", resp.body)),
                            resp.status)

        payload_map = resp.body if isinstance(resp.body, dict) else {}
        ret_code = payload_map.get("retCode")
        # The trap: Bybit signals failure inside a 200 response. An adapter that
        # checks only the HTTP status treats every rejection as a success.
        if ret_code not in (0, None):
            raise map_error(int(ret_code), str(payload_map.get("retMsg", "")), resp.status)
        return payload_map

    # -- reference -------------------------------------------------------

    async def reference_data(self) -> ExchangeInfo:
        return parse_instruments(
            self._call("GET", "/v5/market/instruments-info", {"category": self.category}),
            self.name,
        )

    async def fee_schedule(self) -> FeeSchedule:
        data = self._call("GET", "/v5/account/fee-rate", {"category": self.category}, signed=True)
        rows = data.get("result", {}).get("list", [])
        row = rows[0] if rows else {}
        return FeeSchedule(
            venue=self.name,
            maker_rate=dec(str(row.get("makerFeeRate", "0.001"))),
            taker_rate=dec(str(row.get("takerFeeRate", "0.001"))),
        )

    # -- market data -----------------------------------------------------

    async def book_snapshot(self, symbol: str, depth: int = 50) -> BookSnapshot:
        d = self._call("GET", "/v5/market/orderbook",
                       {"category": self.category, "symbol": symbol, "limit": depth})
        result = d.get("result", {})
        return BookSnapshot(
            bids=tuple((dec(str(p)), dec(str(q))) for p, q in result.get("b", [])),
            asks=tuple((dec(str(p)), dec(str(q))) for p, q in result.get("a", [])),
            last_update_id=int(result.get("u", 0)),
        )

    # -- trading ---------------------------------------------------------

    async def place(self, intent: OrderIntent) -> OrderAck:
        params: Dict[str, Any] = {
            "category": self.category,
            "symbol": intent.symbol,
            "side": "Buy" if intent.side == "buy" else "Sell",
            "orderType": {"limit": "Limit", "market": "Market",
                          "limit_maker": "Limit", "stop_limit": "Limit"}[intent.order_type],
            "qty": format(intent.quantity, "f"),
            # The idempotency key, under its Bybit name.
            "orderLinkId": intent.client_order_id,
        }
        if intent.price is not None:
            params["price"] = format(intent.price, "f")
        if intent.order_type == "limit_maker" or intent.post_only:
            params["timeInForce"] = "PostOnly"
        elif intent.order_type == "limit":
            params["timeInForce"] = {"GTC": "GTC", "IOC": "IOC", "FOK": "FOK"}[intent.time_in_force]
        if intent.reduce_only:
            params["reduceOnly"] = True

        data = self._call("POST", "/v5/order/create", params, signed=True)
        return OrderAck(intent.client_order_id,
                        str(data.get("result", {}).get("orderId", "")), time.time_ns())

    async def cancel(self, client_order_id: str, symbol: str = "") -> CancelAck:
        self._call("POST", "/v5/order/cancel",
                   {"category": self.category, "symbol": symbol,
                    "orderLinkId": client_order_id}, signed=True)
        return CancelAck(client_order_id, time.time_ns())

    async def query_order(self, client_order_id: str, symbol: str = "") -> OrderState:
        """Mandatory. Without it the QUERY state cannot resolve."""
        data = self._call("GET", "/v5/order/realtime",
                          {"category": self.category, "symbol": symbol,
                           "orderLinkId": client_order_id}, signed=True)
        rows = data.get("result", {}).get("list", [])
        if not rows:
            raise OrderNotFound(f"no such order {client_order_id}", venue_code=110001)
        return self._to_order_state(rows[0])

    def _to_order_state(self, d: Mapping[str, Any]) -> OrderState:
        return OrderState(
            correlation_id="",
            emitted_at=time.time_ns(),
            source=self.name,
            client_order_id=str(d.get("orderLinkId", "")),
            venue_order_id=str(d.get("orderId", "")),
            venue=self.name,
            symbol=str(d.get("symbol", "")),
            side=str(d.get("side", "Buy")).lower(),
            status=_STATUS_MAP.get(str(d.get("orderStatus")), OrderStatus.QUERY),
            quantity=dec(str(d.get("qty", "0"))),
            filled_quantity=dec(str(d.get("cumExecQty", "0"))),
            price=dec(str(d["price"])) if d.get("price") else None,
            entered_state_at=ms_to_ns(int(d.get("updatedTime", 0) or 0)),
        )

    # -- truth -----------------------------------------------------------

    async def positions(self) -> List[Position]:
        data = self._call("GET", "/v5/position/list",
                          {"category": self.category, "settleCoin": "USDT"}, signed=True)
        out = []
        for row in data.get("result", {}).get("list", []):
            size = dec(str(row.get("size", "0")))
            if size == 0:
                continue
            signed_size = size if str(row.get("side")) == "Buy" else -size
            out.append(Position(
                venue=self.name, symbol=str(row.get("symbol", "")),
                quantity=signed_size,
                avg_entry_price=dec(str(row.get("avgPrice", "0"))),
                mark_price=dec(str(row["markPrice"])) if row.get("markPrice") else None,
                liquidation_price=dec(str(row["liqPrice"])) if row.get("liqPrice") else None,
            ))
        return out

    async def balances(self) -> List[Balance]:
        data = self._call("GET", "/v5/account/wallet-balance",
                          {"accountType": "UNIFIED"}, signed=True)
        out = []
        for account in data.get("result", {}).get("list", []):
            for coin in account.get("coin", []):
                free = dec(str(coin.get("availableToWithdraw") or coin.get("walletBalance") or "0"))
                locked = dec(str(coin.get("locked", "0") or "0"))
                if free == 0 and locked == 0:
                    continue
                out.append(Balance(self.name, str(coin.get("coin", "")), free, locked))
        return out

    async def open_orders(self) -> List[OrderState]:
        data = self._call("GET", "/v5/order/realtime",
                          {"category": self.category, "openOnly": 0}, signed=True)
        return [self._to_order_state(r) for r in data.get("result", {}).get("list", [])]

    # -- health ----------------------------------------------------------

    async def server_time(self) -> Nanos:
        d = self._call("GET", "/v5/market/time")
        return int(d.get("result", {}).get("timeNano", 0) or 0) or ms_to_ns(
            int(d.get("time", 0) or 0)
        )

    def rate_limit_state(self) -> RateLimitState:
        return RateLimitState(self._limit_status, self._limit)
