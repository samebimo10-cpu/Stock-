"""Binance adapter.

Everything Binance-specific lives here and nothing above this module knows it
exists (SPEC Annex A section 5 rule 1). The reference for the details is
``crypto/annex/E-binance.md``.

Network I/O goes through an injected :class:`Transport`, so every rule in here
- signing order, filter parsing, error mapping, sequence handling, listenKey
lifecycle - is unit-testable without touching the network. The parts that
break bots in production are exactly the parts that are hard to provoke
against a live venue, so they have to be testable offline.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
import urllib.parse
import urllib.request
from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, List, Mapping, Optional, Protocol, Tuple

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
from ..core.types import Decimal as Dec, dec, Nanos, ms_to_ns
from .base import CancelAck, OrderAck, RateLimitState

__all__ = [
    "BinanceAdapter",
    "BinanceEndpoints",
    "Transport",
    "UrllibTransport",
    "Signer",
    "HmacSigner",
    "Ed25519Signer",
    "map_error",
    "parse_exchange_info",
    "build_signed_query",
    "BookSequencer",
    "ListenKeyManager",
    "MAX_RECV_WINDOW_MS",
]

#: Hard API limit. Never raise recvWindow toward this to paper over clock
#: drift: that replaces a loud, diagnosable failure (-1021) with a silent
#: window in which stale requests execute.
MAX_RECV_WINDOW_MS = 60_000
DEFAULT_RECV_WINDOW_MS = 5_000


@dataclass(frozen=True)
class BinanceEndpoints:
    rest: str
    ws: str
    name: str

    @staticmethod
    def spot_production() -> "BinanceEndpoints":
        return BinanceEndpoints("https://api.binance.com", "wss://stream.binance.com:9443", "binance-spot")

    @staticmethod
    def spot_testnet() -> "BinanceEndpoints":
        return BinanceEndpoints("https://testnet.binance.vision", "wss://testnet.binance.vision", "binance-spot-testnet")

    @staticmethod
    def futures_production() -> "BinanceEndpoints":
        return BinanceEndpoints("https://fapi.binance.com", "wss://fstream.binance.com", "binance-futures")

    @staticmethod
    def futures_testnet() -> "BinanceEndpoints":
        return BinanceEndpoints("https://testnet.binancefuture.com", "wss://stream.binancefuture.com", "binance-futures-testnet")


# --------------------------------------------------------------------------
# Signing
# --------------------------------------------------------------------------


class Signer(Protocol):
    def sign(self, payload: str) -> str: ...


class HmacSigner:
    """HMAC-SHA256. Supported, but Ed25519 is recommended (SPEC section 13.2)."""

    def __init__(self, secret: str) -> None:
        self._secret = secret.encode()

    def sign(self, payload: str) -> str:
        return hmac.new(self._secret, payload.encode(), hashlib.sha256).hexdigest()


class Ed25519Signer:
    """Ed25519, which Binance recommends for performance and security.

    ``cryptography`` is imported lazily so the rest of the system - and the
    whole test suite - runs without it. In production the private key lives in
    the signing service and never in the trading process; this class is the
    in-process form used for testnet.
    """

    def __init__(self, private_key_pem: bytes, password: Optional[bytes] = None) -> None:
        from cryptography.hazmat.primitives.serialization import load_pem_private_key

        self._key = load_pem_private_key(private_key_pem, password=password)

    def sign(self, payload: str) -> str:
        import base64

        return base64.b64encode(self._key.sign(payload.encode())).decode()


def build_signed_query(params: Mapping[str, Any], signer: Signer) -> str:
    """Build the query string and append its signature.

    The signature covers **the exact query string in the exact order sent**
    (Annex E section 2). That makes a harmless-looking refactor of a query
    builder a production outage, so the ordering is fixed here, once: insertion
    order of ``params``, signature last.

    >>> build_signed_query({"symbol": "BTCUSDT", "timestamp": 1}, HmacSigner("k"))[:23]
    'symbol=BTCUSDT&timestam'
    """
    ordered = [(k, v) for k, v in params.items() if v is not None]
    query = urllib.parse.urlencode(ordered, quote_via=urllib.parse.quote)
    return f"{query}&signature={urllib.parse.quote(signer.sign(query))}"


# --------------------------------------------------------------------------
# Errors
# --------------------------------------------------------------------------

#: Annex E section 4. The mapping is a table rather than a chain of ifs so the
#: correct response to each code is reviewable in one place.
_ERROR_MAP: Dict[int, type] = {
    -1003: RateLimited,
    -1007: UnknownState,     # status UNKNOWN. Query, never resend.
    -1013: FilterViolation,
    -1015: RateLimited,
    -1021: VenueError,       # timestamp outside recvWindow; caller halts on drift
    -1022: AuthFailed,
    -2010: InsufficientBalance,
    -2011: CancelRejected,
    -2013: OrderNotFound,
    -2014: AuthFailed,
    -2015: AuthFailed,
}


def map_error(code: Optional[int], message: str, http_status: Optional[int] = None) -> VenueError:
    """Normalise a Binance error into the common taxonomy."""
    if http_status == 418:
        return IpBanned(f"IP banned for ignoring 429: {message}", venue_code=418)
    if http_status == 429:
        return RateLimited(f"rate limited: {message}", venue_code=429)
    if http_status is not None and http_status >= 500:
        return VenueDown(f"venue {http_status}: {message}", venue_code=http_status)
    cls = _ERROR_MAP.get(code or 0, VenueError)
    return cls(f"binance {code}: {message}", venue_code=code)


# --------------------------------------------------------------------------
# Reference data
# --------------------------------------------------------------------------


def parse_exchange_info(payload: Mapping[str, Any], venue: str = "binance") -> ExchangeInfo:
    """Turn ``GET /api/v3/exchangeInfo`` into typed filters.

    Filters change without notice and a cached filter is a stale assumption,
    so callers re-fetch daily and on any ``-1013`` (Annex E section 3).
    """
    out: Dict[str, SymbolFilter] = {}
    for sym in payload.get("symbols", []):
        name = sym["symbol"]
        tick = step = min_notional = None
        min_qty = dec(0)
        max_qty = None
        max_orders = None
        up = down = None
        for f in sym.get("filters", []):
            t = f.get("filterType")
            if t == "PRICE_FILTER":
                tick = dec(f["tickSize"])
            elif t == "LOT_SIZE":
                step = dec(f["stepSize"])
                min_qty = dec(f.get("minQty", "0"))
                max_qty = dec(f["maxQty"]) if f.get("maxQty") else None
            elif t in ("MIN_NOTIONAL", "NOTIONAL"):
                min_notional = dec(f.get("minNotional") or f.get("notional") or "0")
            elif t == "MAX_NUM_ORDERS":
                max_orders = int(f["maxNumOrders"])
            elif t == "PERCENT_PRICE_BY_SIDE":
                up = dec(f["bidMultiplierUp"]) if f.get("bidMultiplierUp") else None
                down = dec(f["bidMultiplierDown"]) if f.get("bidMultiplierDown") else None
        if tick is None or step is None:
            continue
        out[name] = SymbolFilter(
            symbol=name,
            tick_size=tick,
            step_size=step,
            min_notional=min_notional if min_notional is not None else dec(0),
            min_qty=min_qty,
            max_qty=max_qty,
            max_num_orders=max_orders,
            percent_price_up=up,
            percent_price_down=down,
        )
    return ExchangeInfo(venue=venue, filters=out, fetched_at=time.time_ns())


# --------------------------------------------------------------------------
# Depth stream sequencing
# --------------------------------------------------------------------------


class BookSequencer:
    """Local book maintenance with sequence validation (Annex E section 6.1).

    On any gap: discard, resync from a REST snapshot, and mark the window so
    research excludes it. The marking is the part that gets skipped and the
    part that matters - research silently trained on a gap window learns to
    trade a reconnection.
    """

    def __init__(self) -> None:
        self.last_applied_id: Optional[int] = None
        self.gap_count = 0
        self.resync_required = False

    def reset_from_snapshot(self, last_update_id: int) -> None:
        self.last_applied_id = last_update_id
        self.resync_required = False

    def accept(self, first_update_id: int, final_update_id: int) -> bool:
        """True if the delta should be applied.

        Returns False and sets :attr:`resync_required` on a gap; returns False
        without a gap for a stale delta already covered by the snapshot.
        """
        if self.last_applied_id is None:
            self.resync_required = True
            return False
        if final_update_id <= self.last_applied_id:
            return False                       # stale, already applied
        if first_update_id > self.last_applied_id + 1:
            self.gap_count += 1
            self.resync_required = True
            self.last_applied_id = None
            return False
        self.last_applied_id = final_update_id
        return True


# --------------------------------------------------------------------------
# User data stream
# --------------------------------------------------------------------------


class ListenKeyManager:
    """listenKey lifecycle (Annex E section 6.2).

    The key is valid for 60 minutes and a PUT extends it by another 60. We
    keepalive at 30 so a single failed request is survivable rather than fatal.

    This is failure mode 7 in SPEC section 8.5: when the user data stream dies
    quietly, fills stop arriving, the system believes it is flat, and it opens
    more against a position it already holds. Nothing here detects that on its
    own - the independent REST reconciliation poll does, which is why it is not
    a redundant belt-and-braces measure.
    """

    VALIDITY_S = 3600
    KEEPALIVE_S = 1800

    def __init__(self, now_s: float = 0.0) -> None:
        self.key: Optional[str] = None
        self.issued_at: float = now_s
        self.last_keepalive: float = now_s

    def issue(self, key: str, now_s: float) -> None:
        self.key = key
        self.issued_at = now_s
        self.last_keepalive = now_s

    def needs_keepalive(self, now_s: float) -> bool:
        return self.key is not None and (now_s - self.last_keepalive) >= self.KEEPALIVE_S

    def keepalive_done(self, now_s: float) -> None:
        self.last_keepalive = now_s

    def is_expired(self, now_s: float) -> bool:
        return self.key is None or (now_s - self.last_keepalive) >= self.VALIDITY_S

    def on_reconnect(self) -> None:
        """Drop the key. A fresh one is fetched on reconnect, never reused.

        Reusing a key across a reconnect is a common source of a stream that
        connects successfully and then delivers nothing.
        """
        self.key = None


# --------------------------------------------------------------------------
# Transport
# --------------------------------------------------------------------------


@dataclass
class Response:
    status: int
    body: Any
    headers: Mapping[str, str] = field(default_factory=dict)


class Transport(Protocol):
    def request(self, method: str, url: str, headers: Mapping[str, str],
                body: Optional[str] = None) -> Response: ...


class UrllibTransport:
    """Stdlib transport, so the package has no HTTP dependency."""

    def __init__(self, timeout: float = 10.0) -> None:
        self.timeout = timeout

    def request(self, method, url, headers, body=None) -> Response:
        req = urllib.request.Request(url, method=method, data=body.encode() if body else None)
        for k, v in headers.items():
            req.add_header(k, v)
        try:
            with urllib.request.urlopen(req, timeout=self.timeout) as r:
                return Response(r.status, json.loads(r.read() or b"null"), dict(r.headers))
        except urllib.error.HTTPError as e:            # noqa: F821 - urllib.error via urllib.request
            raw = e.read()
            try:
                payload = json.loads(raw or b"null")
            except Exception:
                payload = {"msg": raw.decode(errors="replace")}
            return Response(e.code, payload, dict(e.headers or {}))
        except Exception as e:
            # A failed request means one of two very different things, and the
            # HTTP method is what distinguishes them.
            #
            # For a method that changes state, the request may have arrived and
            # been acted on before the connection died: the outcome is genuinely
            # unknown, and UnknownState is what stops the caller from sending it
            # again (SPEC section 9.2).
            #
            # For a read there is nothing to be unknown about. Raising
            # UnknownState here would put "order status unknown" in the log for
            # a failed clock check, which is a sentence that sends an operator
            # hunting for an order that never existed - during an incident,
            # which is the only time anyone reads it.
            if method.upper() in ("POST", "PUT", "DELETE"):
                raise UnknownState(
                    f"{method} failed in flight, order status unknown: {e}") from e
            raise VenueDown(f"{method} {url.split('?')[0]} failed: {e}") from e


# --------------------------------------------------------------------------
# Adapter
# --------------------------------------------------------------------------


_STATUS_MAP = {
    "NEW": OrderStatus.ACKED,
    "PARTIALLY_FILLED": OrderStatus.PARTIAL,
    "FILLED": OrderStatus.FILLED,
    "CANCELED": OrderStatus.CANCELLED,
    "PENDING_CANCEL": OrderStatus.ACKED,
    "REJECTED": OrderStatus.REJECTED,
    "EXPIRED": OrderStatus.CANCELLED,
}


class BinanceAdapter:
    """Spot adapter. Futures differs in paths, not in shape."""

    #: Set per instance, because one class serves production and testnet and
    #: they must be distinguishable in the audit trail. Declared here so the
    #: conformance check can see that the contract is met.
    name: str = ""

    def __init__(
        self,
        endpoints: BinanceEndpoints,
        api_key: str = "",
        signer: Optional[Signer] = None,
        transport: Optional[Transport] = None,
        recv_window_ms: int = DEFAULT_RECV_WINDOW_MS,
    ) -> None:
        if recv_window_ms > MAX_RECV_WINDOW_MS:
            raise ValueError(
                f"recvWindow {recv_window_ms} exceeds the API maximum {MAX_RECV_WINDOW_MS}"
            )
        self.name = endpoints.name
        self.endpoints = endpoints
        self.api_key = api_key
        self.signer = signer
        self.transport = transport or UrllibTransport()
        self.recv_window_ms = recv_window_ms
        self._weight_used = 0
        self._weight_limit = 6000
        self.listen_key = ListenKeyManager()

    # -- plumbing --------------------------------------------------------

    def _call(self, method: str, path: str, params: Optional[Dict[str, Any]] = None,
              signed: bool = False) -> Any:
        params = dict(params or {})
        headers = {"X-MBX-APIKEY": self.api_key} if self.api_key else {}
        if signed:
            if self.signer is None:
                raise AuthFailed("signed request with no signer configured")
            params["timestamp"] = int(time.time() * 1000)
            params["recvWindow"] = self.recv_window_ms
            query = build_signed_query(params, self.signer)
        else:
            query = urllib.parse.urlencode([(k, v) for k, v in params.items() if v is not None])
        url = f"{self.endpoints.rest}{path}" + (f"?{query}" if query else "")
        resp = self.transport.request(method, url, headers)
        weight = resp.headers.get("X-MBX-USED-WEIGHT-1M") or resp.headers.get("x-mbx-used-weight-1m")
        if weight:
            try:
                self._weight_used = int(weight)
            except ValueError:
                pass
        if resp.status != 200:
            body = resp.body if isinstance(resp.body, dict) else {}
            raise map_error(body.get("code"), str(body.get("msg", resp.body)), resp.status)
        return resp.body

    # -- reference -------------------------------------------------------

    async def reference_data(self) -> ExchangeInfo:
        return parse_exchange_info(self._call("GET", "/api/v3/exchangeInfo"), self.name)

    async def fee_schedule(self) -> FeeSchedule:
        """Read the ACTUAL tier. Never a constant in code (Annex B section 1)."""
        data = self._call("GET", "/api/v3/account", signed=True)
        return FeeSchedule(
            venue=self.name,
            maker_rate=dec(str(data.get("commissionRates", {}).get("maker", "0.001"))),
            taker_rate=dec(str(data.get("commissionRates", {}).get("taker", "0.001"))),
            tier=str(data.get("vipLevel", "0")),
        )

    # -- market data -----------------------------------------------------

    async def book_snapshot(self, symbol: str, depth: int = 100) -> BookSnapshot:
        d = self._call("GET", "/api/v3/depth", {"symbol": symbol, "limit": depth})
        return BookSnapshot(
            bids=tuple((dec(p), dec(q)) for p, q in d["bids"]),
            asks=tuple((dec(p), dec(q)) for p, q in d["asks"]),
            last_update_id=int(d["lastUpdateId"]),
        )

    # -- trading ---------------------------------------------------------

    async def place(self, intent: OrderIntent) -> OrderAck:
        params: Dict[str, Any] = {
            "symbol": intent.symbol,
            "side": intent.side.upper(),
            "type": {"limit": "LIMIT", "market": "MARKET",
                     "limit_maker": "LIMIT_MAKER", "stop_limit": "STOP_LOSS_LIMIT"}[intent.order_type],
            "quantity": format(intent.quantity, "f"),
            # Always set. This is the idempotency key (SPEC section 9.3).
            "newClientOrderId": intent.client_order_id,
        }
        if intent.order_type in ("limit", "stop_limit"):
            params["timeInForce"] = intent.time_in_force
        if intent.price is not None:
            params["price"] = format(intent.price, "f")
        data = self._call("POST", "/api/v3/order", params, signed=True)
        return OrderAck(intent.client_order_id, str(data.get("orderId", "")), time.time_ns())

    async def cancel(self, client_order_id: str, symbol: str = "") -> CancelAck:
        self._call("DELETE", "/api/v3/order",
                   {"symbol": symbol, "origClientOrderId": client_order_id}, signed=True)
        return CancelAck(client_order_id, time.time_ns())

    async def query_order(self, client_order_id: str, symbol: str = "") -> OrderState:
        d = self._call("GET", "/api/v3/order",
                       {"symbol": symbol, "origClientOrderId": client_order_id}, signed=True)
        return self._to_order_state(d)

    def _to_order_state(self, d: Mapping[str, Any]) -> OrderState:
        return OrderState(
            correlation_id="",
            emitted_at=time.time_ns(),
            source=self.name,
            client_order_id=str(d.get("clientOrderId", "")),
            venue_order_id=str(d.get("orderId", "")),
            venue=self.name,
            symbol=str(d.get("symbol", "")),
            side=str(d.get("side", "BUY")).lower(),
            status=_STATUS_MAP.get(str(d.get("status")), OrderStatus.QUERY),
            quantity=dec(str(d.get("origQty", "0"))),
            filled_quantity=dec(str(d.get("executedQty", "0"))),
            price=dec(str(d["price"])) if d.get("price") else None,
            entered_state_at=ms_to_ns(int(d.get("updateTime", 0) or 0)),
        )

    # -- truth -----------------------------------------------------------

    async def positions(self) -> List[Position]:
        """Spot has balances, not positions. Futures overrides this."""
        return []

    async def balances(self) -> List[Balance]:
        d = self._call("GET", "/api/v3/account", signed=True)
        return [
            Balance(self.name, b["asset"], dec(b["free"]), dec(b["locked"]))
            for b in d.get("balances", [])
            if dec(b["free"]) != 0 or dec(b["locked"]) != 0
        ]

    async def open_orders(self) -> List[OrderState]:
        return [self._to_order_state(o) for o in self._call("GET", "/api/v3/openOrders", signed=True)]

    # -- health ----------------------------------------------------------

    async def server_time(self) -> Nanos:
        return ms_to_ns(int(self._call("GET", "/api/v3/time")["serverTime"]))

    def rate_limit_state(self) -> RateLimitState:
        return RateLimitState(self._weight_used, self._weight_limit)

    # -- private stream token --------------------------------------------
    #
    # Not part of :class:`~tradesys.adapters.base.VenueAdapter`: every venue
    # has some way to authenticate a private stream and no two agree on its
    # shape, so hoisting it into the shared protocol would define an interface
    # around one venue's answer. The names are venue-neutral because the live
    # layer calls them through a protocol of its own.

    async def open_user_stream(self) -> str:
        """Obtain a private-stream token, valid 60 minutes."""
        data = self._call("POST", "/api/v3/userDataStream")
        key = str(data["listenKey"])
        self.listen_key.issue(key, time.time())
        return key

    async def keep_user_stream_alive(self, token: str) -> None:
        """Extend the token by another 60 minutes. Called every 30 (Annex E 6.2)."""
        self._call("PUT", "/api/v3/userDataStream", {"listenKey": token})
        self.listen_key.keepalive_done(time.time())

    async def close_user_stream(self, token: str) -> None:
        self._call("DELETE", "/api/v3/userDataStream", {"listenKey": token})
        self.listen_key.key = None
