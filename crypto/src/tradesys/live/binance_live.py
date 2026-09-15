"""Binance live streams: payloads in, domain events out.

This is the translation layer, and it is kept free of I/O so all of it is
testable against recorded payloads. The one exception is the depth resync,
which needs a REST snapshot; it takes the adapter it calls, so a test passes a
fake and asserts that the resync happened at all - which is the part that
breaks silently in production.

Three behaviours here exist because of specific, well-documented ways a
Binance connection stops being trustworthy without stopping (Annex E):

1. **A depth gap is not recoverable by carrying on.** The local book must be
   discarded and rebuilt from a REST snapshot, and the window marked so
   research never trains on a reconnection. ``BookSequencer`` decides; this
   module acts on the decision.
2. **Every connection dies at 24 hours**, whether or not anything is wrong. A
   system that treats that as an incident pages somebody once a day; a system
   that ignores it loses the feed. :class:`~tradesys.live.runner.LiveRunner`
   rotates before the venue does.
3. **A dead user data stream is silent.** Fills simply stop. Nothing in this
   module can detect that - only the independent REST reconciliation poll can,
   which is why that poll is not redundant belt-and-braces.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Mapping, Optional, Sequence, Tuple

from ..adapters.binance import BookSequencer
from ..core.events import (
    BookDelta,
    BookSnapshot,
    Fill,
    Funding,
    Mark,
    MarketEvent,
    QualityFlags,
    Trade,
)
from ..core.ids import new_correlation_id
from ..core.types import Decimal as Dec, Nanos, dec, ms_to_ns, now_ns
from ..layers.l1_data.book import LocalBook

__all__ = [
    "StreamSpec",
    "market_stream_url",
    "user_stream_url",
    "BinanceFeed",
    "decode_fill",
    "DEFAULT_STALE_AFTER_NS",
]

#: Flag an event stale well before the risk limit rejects on it
#: (``feed_staleness_s`` is 30s). The flag is a warning that travels with the
#: data; the limit is the refusal. Setting them equal means the first thing
#: anyone learns about a degrading feed is an order being rejected.
DEFAULT_STALE_AFTER_NS = 5_000_000_000


# --------------------------------------------------------------------------
# Stream naming
# --------------------------------------------------------------------------


@dataclass(frozen=True)
class StreamSpec:
    """Which streams to subscribe to for one symbol.

    ``depth_ms`` is 100 rather than the default 1000 because a strategy acting
    on a book that is up to a second old is acting on a book that no longer
    exists. It costs nothing extra in weight.
    """

    symbol: str
    depth: bool = True
    trades: bool = True
    mark: bool = False          # futures only; carries the funding rate too
    depth_ms: int = 100

    def names(self) -> List[str]:
        """Lower-case stream names, in the order Binance documents them.

        >>> StreamSpec("BTCUSDT", mark=True).names()
        ['btcusdt@depth@100ms', 'btcusdt@aggTrade', 'btcusdt@markPrice@1s']
        """
        low = self.symbol.lower()
        out: List[str] = []
        if self.depth:
            out.append(f"{low}@depth@{self.depth_ms}ms")
        if self.trades:
            out.append(f"{low}@aggTrade")
        if self.mark:
            out.append(f"{low}@markPrice@1s")
        return out


def market_stream_url(ws_base: str, specs: Sequence[StreamSpec]) -> str:
    """Combined-stream URL.

    Always combined, even for one stream: the combined envelope names the
    stream each payload came from, and a single-stream URL does not. The name
    is what lets a decoder route a payload it does not recognise to a log line
    instead of to a guess.

    >>> market_stream_url("wss://stream.binance.com:9443", [StreamSpec("BTCUSDT")])
    'wss://stream.binance.com:9443/stream?streams=btcusdt@depth@100ms/btcusdt@aggTrade'
    """
    names: List[str] = []
    for spec in specs:
        names.extend(spec.names())
    if not names:
        raise ValueError("no streams requested")
    return f"{ws_base}/stream?streams=" + "/".join(names)


def user_stream_url(ws_base: str, listen_key: str) -> str:
    """Single-stream URL for the account's own fills.

    >>> user_stream_url("wss://s.binance.com", "abc")
    'wss://s.binance.com/ws/abc'
    """
    if not listen_key:
        raise ValueError("no listenKey: a user stream URL without one connects and stays silent")
    return f"{ws_base}/ws/{listen_key}"


# --------------------------------------------------------------------------
# Market data
# --------------------------------------------------------------------------


def _levels(raw: Sequence[Sequence[str]]) -> Tuple[Tuple[Dec, Dec], ...]:
    return tuple((dec(p), dec(q)) for p, q in raw)


@dataclass
class FeedStats:
    messages: int = 0
    events: int = 0
    gaps: int = 0
    resyncs: int = 0
    unknown_streams: Dict[str, int] = field(default_factory=dict)
    dropped_stale_deltas: int = 0


class BinanceFeed:
    """Decodes one venue's market stream and maintains sequence state per symbol.

    Holds its own :class:`LocalBook` per symbol even though the feature engine
    downstream keeps one too. That is not duplication for its own sake: quality
    has to be decided at L1, on the book as the venue described it, and
    attached to the event before anyone downstream sees it. A crossed book
    discovered two layers later is a crossed book that has already produced a
    signal.
    """

    def __init__(
        self,
        venue: str,
        adapter: Any = None,
        *,
        clock: Callable[[], Nanos] = now_ns,
        stale_after_ns: int = DEFAULT_STALE_AFTER_NS,
        snapshot_depth: int = 100,
    ) -> None:
        self.venue = venue
        self.adapter = adapter
        self.clock = clock
        self.stale_after_ns = stale_after_ns
        self.snapshot_depth = snapshot_depth
        self.sequencers: Dict[str, BookSequencer] = {}
        self.books: Dict[str, LocalBook] = {}
        self.stats = FeedStats()
        #: Set when a reconnect happened. The next event per symbol carries the
        #: resync flag, so the discontinuity is visible in the archive rather
        #: than only in a log nobody reads back.
        self._pending_resync: Dict[str, bool] = {}
        #: Symbols that have had at least one successful snapshot on this
        #: connection. Distinguishes a cold start from a real discontinuity.
        self._synced: set = set()

    # -- state -----------------------------------------------------------

    def sequencer(self, symbol: str) -> BookSequencer:
        if symbol not in self.sequencers:
            self.sequencers[symbol] = BookSequencer()
        return self.sequencers[symbol]

    def book(self, symbol: str) -> LocalBook:
        if symbol not in self.books:
            self.books[symbol] = LocalBook(symbol)
        return self.books[symbol]

    def on_disconnect(self) -> None:
        """Throw the books away. Called on every reconnect, without exception.

        Keeping a book across a reconnect is the single most tempting shortcut
        in this file, because the book usually is still roughly right. "Roughly
        right" is how a stale level survives long enough to be quoted against.
        """
        for symbol, book in self.books.items():
            book.clear()
            self.sequencers[symbol] = BookSequencer()
            self._pending_resync[symbol] = True
        self._synced.clear()

    # -- decoding --------------------------------------------------------

    async def decode(self, message: Mapping[str, Any],
                     local_recv_ts: Optional[Nanos] = None) -> List[MarketEvent]:
        """One websocket message into zero or more market events.

        Zero is a normal outcome: subscription acknowledgements, stale deltas
        already covered by a snapshot, and the delta that reveals a gap all
        produce nothing. A gap additionally schedules a resync, which produces
        a snapshot event on the next pass.
        """
        self.stats.messages += 1
        recv = local_recv_ts if local_recv_ts is not None else self.clock()

        payload = message.get("data", message)
        if not isinstance(payload, Mapping):
            return []
        kind = payload.get("e")
        if kind is None:
            # Subscription acknowledgement ({"result": null, "id": 1}) or an
            # error. Neither is market data; neither is a reason to stop.
            stream = str(message.get("stream", "control"))
            self.stats.unknown_streams[stream] = self.stats.unknown_streams.get(stream, 0) + 1
            return []

        symbol = str(payload.get("s", ""))
        if kind == "depthUpdate":
            return await self._on_depth(payload, symbol, recv)
        if kind in ("aggTrade", "trade"):
            return self._on_trade(payload, symbol, recv)
        if kind == "markPriceUpdate":
            return self._on_mark(payload, symbol, recv)
        self.stats.unknown_streams[kind] = self.stats.unknown_streams.get(kind, 0) + 1
        return []

    async def _on_depth(self, payload: Mapping[str, Any], symbol: str,
                        recv: Nanos) -> List[MarketEvent]:
        seq = self.sequencer(symbol)
        first, final = int(payload["U"]), int(payload["u"])
        exchange_ts = ms_to_ns(int(payload.get("E", 0)))

        if seq.accept(first, final):
            delta = BookDelta(bids=_levels(payload.get("b", [])),
                              asks=_levels(payload.get("a", [])),
                              first_update_id=first, final_update_id=final)
            book = self.book(symbol)
            book.apply_delta(delta)
            return [self._event(symbol, "book_delta", delta, exchange_ts, recv,
                                sequence=final)]

        if not seq.resync_required:
            # Stale: already covered by the snapshot we started from. Expected
            # on every resync, and not a problem.
            self.stats.dropped_stale_deltas += 1
            return []

        # A cold start is not a gap. The first delta on a fresh connection
        # always arrives with nothing to apply it to, so counting it would make
        # ``sequence_gaps`` tick once per connection by construction - and a
        # counter that increments on every healthy reconnect cannot be alerted
        # on, which is the only thing it was for.
        cold_start = symbol not in self._synced
        if not cold_start:
            self.stats.gaps += 1
        events = await self.resync(symbol, recv, gap=not cold_start)

        # Re-offer the delta that triggered the resync. Dropping it outright
        # leaves a one-update hole immediately after the snapshot, which the
        # *next* delta then reports as a gap - and that resync leaves another
        # hole. The loop gets tighter the busier the market, which is to say it
        # arrives exactly when it does the most damage. Binance's own
        # documented procedure is this: buffer, snapshot, then apply the first
        # delta whose range spans the snapshot's last update id.
        if events and seq.accept(first, final):
            delta = BookDelta(bids=_levels(payload.get("b", [])),
                              asks=_levels(payload.get("a", [])),
                              first_update_id=first, final_update_id=final)
            self.book(symbol).apply_delta(delta)
            events.append(self._event(symbol, "book_delta", delta, exchange_ts,
                                      recv, sequence=final, resyncing=True))
        return events

    async def resync(self, symbol: str, recv: Nanos,
                     gap: bool = True) -> List[MarketEvent]:
        """Rebuild one book from a REST snapshot.

        Returns an empty list if there is no adapter to ask, rather than
        pretending the book is fine. The caller sees no events for that symbol,
        the feed goes stale, and the staleness limit stops trading on it - the
        failure degrades into a refusal to trade rather than into trading on a
        book with a hole in it.
        """
        book = self.book(symbol)
        book.clear()
        if self.adapter is None:
            return []
        snapshot: BookSnapshot = await self.adapter.book_snapshot(symbol, self.snapshot_depth)
        book.apply_snapshot(snapshot)
        self.sequencer(symbol).reset_from_snapshot(snapshot.last_update_id)
        self.stats.resyncs += 1
        self._synced.add(symbol)
        self._pending_resync.pop(symbol, None)
        return [self._event(symbol, "book_snapshot", snapshot,
                            self.clock(), recv, sequence=snapshot.last_update_id,
                            gap=gap, resyncing=True)]

    def _on_trade(self, payload: Mapping[str, Any], symbol: str,
                  recv: Nanos) -> List[MarketEvent]:
        # ``m`` is "buyer is the market maker". If the buyer was passive the
        # seller crossed, so the aggressor is the seller. Getting this backwards
        # inverts every order-flow feature while leaving the volume correct,
        # which is why it survives a casual review.
        aggressor = "sell" if payload.get("m") else "buy"
        trade = Trade(price=dec(str(payload["p"])), quantity=dec(str(payload["q"])),
                      aggressor_side=aggressor,
                      trade_id=int(payload.get("a", payload.get("t", 0))))
        exchange_ts = ms_to_ns(int(payload.get("T", payload.get("E", 0))))
        return [self._event(symbol, "trade", trade, exchange_ts, recv)]

    def _on_mark(self, payload: Mapping[str, Any], symbol: str,
                 recv: Nanos) -> List[MarketEvent]:
        """A mark price update carries the funding rate, so it yields two events.

        Splitting them is not pedantry: the mark feeds valuation and the rate
        feeds the carry strategy, and one event carrying both would force every
        consumer to know which half it cared about.
        """
        exchange_ts = ms_to_ns(int(payload.get("E", 0)))
        out = [self._event(symbol, "mark",
                           Mark(mark_price=dec(str(payload["p"])),
                                index_price=dec(str(payload["i"])) if payload.get("i") else None),
                           exchange_ts, recv)]
        if payload.get("r") is not None:
            out.append(self._event(
                symbol, "funding",
                Funding(rate=dec(str(payload["r"])), interval_hours=8,
                        next_settlement=ms_to_ns(int(payload.get("T", 0)))),
                exchange_ts, recv))
        return out

    def _event(self, symbol: str, kind: str, payload: Any, exchange_ts: Nanos,
               recv: Nanos, *, sequence: Optional[int] = None,
               gap: bool = False, resyncing: bool = False) -> MarketEvent:
        book = self.books.get(symbol)
        quality = QualityFlags(
            gap_detected=gap,
            resync_in_progress=resyncing or self._pending_resync.get(symbol, False),
            stale=bool(exchange_ts) and (recv - exchange_ts) > self.stale_after_ns,
            crossed_book=bool(book is not None and book.is_crossed),
        )
        self.stats.events += 1
        return MarketEvent(
            correlation_id=new_correlation_id(recv),
            emitted_at=recv,
            source=self.venue,
            venue=self.venue,
            symbol=symbol,
            kind=kind,
            exchange_ts=exchange_ts or recv,
            local_recv_ts=recv,
            sequence=sequence,
            payload=payload,
            quality=quality,
        )


# --------------------------------------------------------------------------
# User data
# --------------------------------------------------------------------------


def decode_fill(message: Mapping[str, Any], venue: str,
                local_recv_ts: Optional[Nanos] = None,
                strategy_of: Optional[Callable[[str], str]] = None) -> Optional[Fill]:
    """One user-data message into a :class:`Fill`, or ``None``.

    ``None`` for every message that is not an actual execution, which is most
    of them: a NEW acknowledgement, a cancel, an expiry. Only ``x == "TRADE"``
    moved quantity. Treating ``X == "FILLED"`` as the trigger instead double
    counts, because the terminal report repeats the cumulative quantity that
    the individual TRADE reports already delivered.

    The strategy attribution comes from the client order ID, which is why that
    ID is minted deterministically from the strategy (SPEC section 9.3). A fill
    that cannot be attributed still produces a Fill - the position is real
    whether or not we know whose it is - with an empty strategy, which shows up
    in reconciliation rather than being silently dropped.
    """
    payload = message.get("data", message)
    kind = payload.get("e")
    if kind == "ORDER_TRADE_UPDATE":              # futures wraps it one deeper
        payload = payload.get("o", {})
    elif kind != "executionReport":
        return None

    if payload.get("x") != "TRADE":
        return None
    quantity = dec(str(payload.get("l", "0")))
    if quantity == 0:
        return None

    client_order_id = str(payload.get("c", ""))
    recv = local_recv_ts if local_recv_ts is not None else now_ns()
    exchange_ts = ms_to_ns(int(payload.get("T", 0)))
    return Fill(
        correlation_id=new_correlation_id(recv),
        emitted_at=recv,
        source=venue,
        client_order_id=client_order_id,
        venue_order_id=str(payload.get("i", "")),
        venue=venue,
        symbol=str(payload.get("s", "")),
        side=str(payload.get("S", "BUY")).lower(),
        quantity=quantity,
        price=dec(str(payload.get("L", "0"))),
        fee=dec(str(payload.get("n", "0") or "0")),
        fee_currency=str(payload.get("N") or "USDT"),
        is_maker=bool(payload.get("m", False)),
        strategy_id=strategy_of(client_order_id) if strategy_of else "",
        exchange_ts=exchange_ts or recv,
        local_recv_ts=recv,
    )
