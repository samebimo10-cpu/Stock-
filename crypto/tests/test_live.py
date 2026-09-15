"""The live layer: framing, decoding, resync, reconnect and mode safety.

None of this can be tested against Binance in CI, and the failures that matter
- a gap, a drop at 24 hours, a dead private stream - are exactly the ones a
live venue will not produce on demand. So everything here runs against fakes,
and the fakes are scripted to do the things the venue does badly.
"""

from __future__ import annotations

import asyncio
import json
import struct

import pytest

from tradesys.core.events import BookSnapshot
from tradesys.core.types import dec
from tradesys.live.binance_live import (
    BinanceFeed, StreamSpec, decode_fill, market_stream_url, user_stream_url,
)
from tradesys.live.runner import LiveConfig, LiveRunner, Mode
from tradesys.live.shadow import ShadowVenue
from tradesys.live.streams import DROP, BackoffPolicy, ReplaySource, SilentSource
from tradesys.live.websocket import (
    Frame, WebSocketClient, WebSocketClosed, WebSocketError,
)
from tradesys.live.wiring import (
    LiveCredentials, MissingCredentials, build_binance_live, credentials_from_env,
)

START = 1_700_000_000_000_000_000
MS = 1_000_000


def run(coro):
    return asyncio.run(coro)


# --------------------------------------------------------------------------
# Framing
# --------------------------------------------------------------------------


class FakeReader:
    """Hands out the scripted bytes in small pieces.

    Deliberately not one chunk per call: a real socket splits a frame wherever
    it likes, and a client that happens to work only when each read returns a
    whole frame works right up until the first busy minute.
    """

    def __init__(self, data: bytes, chunk: int = 3) -> None:
        self._data = data
        self._at = 0
        self._chunk = chunk

    async def read(self, n: int) -> bytes:
        take = min(n, self._chunk, len(self._data) - self._at)
        chunk = self._data[self._at:self._at + take]
        self._at += take
        return chunk

    async def readline(self) -> bytes:
        end = self._data.index(b"\r\n", self._at) + 2
        line, self._at = self._data[self._at:end], end
        return line


class FakeWriter:
    def __init__(self) -> None:
        self.sent = b""
        self.closed = False

    def write(self, data: bytes) -> None:
        self.sent += data

    async def drain(self) -> None:
        pass

    def close(self) -> None:
        self.closed = True

    async def wait_closed(self) -> None:
        pass


def server_frame(opcode: int, payload: bytes, final: bool = True) -> bytes:
    """A frame as a server sends it: unmasked, final unless told otherwise."""
    head = bytes([(0x80 if final else 0x00) | opcode])
    n = len(payload)
    if n < 126:
        head += bytes([n])
    elif n < 65536:
        head += bytes([126]) + struct.pack("!H", n)
    else:
        head += bytes([127]) + struct.pack("!Q", n)
    return head + payload


def client_with(data: bytes) -> WebSocketClient:
    client = WebSocketClient("wss://example.test/ws")
    client._reader = FakeReader(data)          # noqa: SLF001 - constructing a fixture
    client._writer = FakeWriter()              # noqa: SLF001
    return client


def test_reads_a_short_text_frame():
    client = client_with(server_frame(0x1, b'{"a":1}'))
    frame = run(client.recv())
    assert frame.is_text and frame.json() == {"a": 1}


@pytest.mark.parametrize("size", [125, 126, 70000])
def test_reads_every_length_encoding(size):
    """7-bit, 16-bit and 64-bit lengths. A depth payload crosses 126 routinely."""
    payload = b"x" * size
    client = client_with(server_frame(0x2, payload))
    assert run(client.recv()).payload == payload


def test_answers_a_ping_with_a_pong_and_keeps_reading():
    """A venue that gets no pong closes the connection within the minute."""
    data = server_frame(0x9, b"hb") + server_frame(0x1, b'{"ok":true}')
    client = client_with(data)
    frame = run(client.recv())
    assert frame.json() == {"ok": True}
    sent = client._writer.sent                 # noqa: SLF001
    assert sent[0] & 0x0F == 0xA, "a PING must be answered with a PONG"
    assert sent[1] & 0x80, "client frames must be masked"


def test_a_close_frame_raises_rather_than_ending_quietly():
    """Returning None here would let a caller loop forever on a dead socket."""
    client = client_with(server_frame(0x8, b"\x03\xe8"))
    with pytest.raises(WebSocketClosed):
        run(client.recv())


def test_a_fragmented_message_is_reassembled():
    """A venue rarely fragments, but nothing stops an intermediary.

    Returning half a depth update would be worse than failing.
    """
    data = (server_frame(0x1, b'{"a":', final=False)
            + server_frame(0x0, b'1}', final=True))
    client = client_with(data)
    assert run(client.recv()).json() == {"a": 1}


def test_a_ping_between_fragments_is_answered_without_corrupting_the_message():
    """Control frames may be interleaved, which is why the ping answer is inside."""
    data = (server_frame(0x1, b'{"a":', final=False)
            + server_frame(0x9, b"hb")
            + server_frame(0x0, b'1}', final=True))
    client = client_with(data)
    assert run(client.recv()).json() == {"a": 1}
    assert client.pings_answered == 1


def test_a_continuation_with_nothing_to_continue_is_an_error():
    client = client_with(server_frame(0x0, b"orphan"))
    with pytest.raises(WebSocketError):
        run(client.recv())


def test_close_actually_sends_a_close_frame():
    """Marking ourselves closed first means we silently never say goodbye.

    The venue then counts the connection as dropped rather than closed, which
    is the difference between a clean rotation and one that looks like a fault.
    """
    client = client_with(b"")
    run(client.close())
    sent = client._writer.sent                 # noqa: SLF001
    assert sent and sent[0] & 0x0F == 0x8
    assert client.closed


def test_outgoing_frames_are_masked_and_round_trip():
    client = client_with(b"")
    run(client.send_json({"method": "SUBSCRIBE"}))
    sent = client._writer.sent                 # noqa: SLF001
    assert sent[1] & 0x80
    mask, body = sent[2:6], sent[6:]
    decoded = bytes(b ^ mask[i % 4] for i, b in enumerate(body))
    assert json.loads(decoded) == {"method": "SUBSCRIBE"}


# --------------------------------------------------------------------------
# Stream naming
# --------------------------------------------------------------------------


def test_depth_stream_is_faster_than_the_default():
    """The 1000ms default means acting on a book that is a second old."""
    assert "@depth@100ms" in StreamSpec("BTCUSDT").names()[0]


def test_market_url_is_always_the_combined_form():
    url = market_stream_url("wss://x", [StreamSpec("BTCUSDT"), StreamSpec("ETHUSDT")])
    assert url.startswith("wss://x/stream?streams=")
    assert url.count("/") >= 4


def test_a_user_stream_url_without_a_token_is_refused():
    """It would connect successfully and then deliver nothing at all."""
    with pytest.raises(ValueError):
        user_stream_url("wss://x", "")


# --------------------------------------------------------------------------
# Market data decoding
# --------------------------------------------------------------------------


class FakeVenue:
    """Just enough adapter to serve a resync snapshot."""

    name = "binance-spot-testnet"

    def __init__(self, last_update_id: int = 100) -> None:
        self.snapshots = 0
        self.last_update_id = last_update_id

    async def book_snapshot(self, symbol, depth=100):
        self.snapshots += 1
        return BookSnapshot(bids=((dec("60000"), dec("5")),),
                            asks=((dec("60001"), dec("5")),),
                            last_update_id=self.last_update_id)


def depth(first, final, bids=(("60000", "1"),), asks=(("60001", "1"),), ts=1):
    return {"stream": "btcusdt@depth@100ms",
            "data": {"e": "depthUpdate", "E": ts, "s": "BTCUSDT",
                     "U": first, "u": final, "b": [list(b) for b in bids],
                     "a": [list(a) for a in asks]}}


def feed(venue=None, **kw):
    return BinanceFeed("binance-spot-testnet", venue or FakeVenue(),
                       clock=lambda: START, **kw)


def test_the_first_delta_is_snapshotted_then_applied_not_thrown_away():
    """Dropping it leaves a one-update hole the next delta reports as a gap.

    That resync leaves another hole, and the loop tightens the busier the
    market gets - so it arrives exactly when it costs the most. Binance's own
    procedure is buffer, snapshot, then apply the first delta whose range spans
    the snapshot's last update id.
    """
    venue = FakeVenue(last_update_id=100)
    f = feed(venue)
    events = run(f.decode(depth(101, 105)))
    assert venue.snapshots == 1
    assert [e.kind for e in events] == ["book_snapshot", "book_delta"]
    assert f.sequencer("BTCUSDT").last_applied_id == 105


def test_a_delta_already_covered_by_the_resync_snapshot_is_not_reapplied():
    """The snapshot is fetched after the delta, so it usually already has it."""
    venue = FakeVenue(last_update_id=200)
    f = feed(venue)
    events = run(f.decode(depth(101, 105)))
    assert [e.kind for e in events] == ["book_snapshot"]
    assert f.sequencer("BTCUSDT").last_applied_id == 200


def test_a_gap_discards_the_book_and_resyncs():
    venue = FakeVenue(last_update_id=100)
    f = feed(venue)
    run(f.decode(depth(101, 105)))             # resync to 100, then apply
    run(f.decode(depth(106, 110)))             # contiguous, applied
    events = run(f.decode(depth(200, 205)))    # gap: 111..199 missing
    assert f.stats.gaps == 1
    assert venue.snapshots == 2
    assert [e.kind for e in events] == ["book_snapshot"]


def test_the_resync_event_is_marked_unusable_for_research():
    """A window containing a reconnection must never train a model.

    Without the flag the model learns to trade the shape of our own
    reconnections, which do not exist in the future it will trade.
    """
    f = feed(FakeVenue(last_update_id=100))
    run(f.decode(depth(101, 105)))              # cold start
    event = run(f.decode(depth(900, 905)))[0]   # a real gap
    assert event.quality.gap_detected
    assert event.quality.resync_in_progress
    assert not event.quality.usable_for_research


def test_a_cold_start_is_not_counted_as_a_gap():
    """The first delta on any connection has nothing to apply to.

    Counting it would tick ``sequence_gaps`` once per healthy reconnect, and a
    counter that increments when nothing is wrong cannot be alerted on.
    """
    f = feed(FakeVenue(last_update_id=100))
    event = run(f.decode(depth(101, 105)))[0]
    assert f.stats.gaps == 0
    assert f.stats.gaps == 0
    assert f.stats.resyncs == 1
    assert not event.quality.gap_detected
    assert event.quality.resync_in_progress, "still not research-grade data"


def test_a_stale_delta_after_a_resync_is_dropped_silently():
    """Every resync produces some. They are expected, not a problem."""
    f = feed(FakeVenue(last_update_id=100))
    run(f.decode(depth(101, 105)))
    assert run(f.decode(depth(50, 90))) == []
    assert f.stats.dropped_stale_deltas == 1
    assert f.stats.gaps == 0


def test_a_contiguous_delta_moves_the_local_book():
    f = feed(FakeVenue(last_update_id=100))
    run(f.decode(depth(101, 101)))
    run(f.decode(depth(102, 102, bids=(("60000.5", "3"),))))
    assert f.book("BTCUSDT").best_bid == dec("60000.5")


def test_aggressor_side_follows_the_maker_flag_not_the_side_field():
    """``m`` true means the buyer was passive, so the seller crossed.

    Getting this backwards inverts every order-flow feature while leaving the
    volume correct, which is why it survives review.
    """
    f = feed()
    trade = {"data": {"e": "aggTrade", "E": 1, "T": 1, "s": "BTCUSDT",
                      "p": "60000", "q": "2", "m": True, "a": 7}}
    assert run(f.decode(trade))[0].payload.aggressor_side == "sell"
    trade["data"]["m"] = False
    assert run(f.decode(trade))[0].payload.aggressor_side == "buy"


def test_a_mark_update_yields_both_a_mark_and_a_funding_event():
    f = feed()
    events = run(f.decode({"data": {"e": "markPriceUpdate", "E": 1, "s": "BTCUSDT",
                                    "p": "60010", "i": "60000", "r": "0.0003",
                                    "T": 2}}))
    assert [e.kind for e in events] == ["mark", "funding"]
    assert events[1].payload.rate == dec("0.0003")


def test_a_subscription_acknowledgement_is_not_an_error():
    f = feed()
    assert run(f.decode({"result": None, "id": 1})) == []


def test_staleness_is_flagged_on_the_event_itself():
    """Quality delivered in a side channel arrives later and gets ignored."""
    f = BinanceFeed("v", FakeVenue(), clock=lambda: START,
                    stale_after_ns=1_000_000)
    event = run(f.decode({"data": {"e": "aggTrade", "E": 1, "T": 1, "s": "BTCUSDT",
                                   "p": "1", "q": "1", "m": False, "a": 1}},
                         local_recv_ts=10 * 3600 * 10**9))
    assert event[0].quality.stale


def test_no_adapter_means_no_book_rather_than_a_book_with_a_hole():
    f = BinanceFeed("v", None, clock=lambda: START)
    assert run(f.decode(depth(101, 105))) == []
    assert f.book("BTCUSDT").is_empty


def test_a_reconnect_discards_every_book_unconditionally():
    f = feed(FakeVenue(last_update_id=100))
    run(f.decode(depth(101, 101)))
    assert not f.book("BTCUSDT").is_empty
    f.on_disconnect()
    assert f.book("BTCUSDT").is_empty
    assert f.sequencer("BTCUSDT").last_applied_id is None


# --------------------------------------------------------------------------
# Fills
# --------------------------------------------------------------------------


def execution_report(**over):
    payload = {"e": "executionReport", "s": "BTCUSDT", "c": "carry-BTC-1",
               "S": "BUY", "x": "TRADE", "X": "PARTIALLY_FILLED", "i": 42,
               "l": "0.5", "z": "0.5", "L": "60000", "n": "0.01", "N": "USDT",
               "T": 1, "m": True}
    payload.update(over)
    return payload


def test_only_an_actual_execution_becomes_a_fill():
    """``X == FILLED`` on its own repeats quantity the TRADE reports delivered."""
    assert decode_fill(execution_report(x="NEW", l="0"), "v") is None
    assert decode_fill(execution_report(x="CANCELED", l="0"), "v") is None
    assert decode_fill(execution_report(), "v") is not None


def test_a_fill_carries_maker_status_and_fee():
    fill = decode_fill(execution_report(), "v", local_recv_ts=START)
    assert fill.is_maker and fill.fee == dec("0.01") and fill.quantity == dec("0.5")
    assert fill.price == dec("60000")


def test_a_futures_order_update_is_unwrapped():
    message = {"e": "ORDER_TRADE_UPDATE", "o": execution_report()}
    assert decode_fill(message, "v") is not None


def test_an_unattributable_fill_still_produces_a_fill():
    """The position is real whether or not we know whose it is."""
    fill = decode_fill(execution_report(), "v", strategy_of=lambda _: "")
    assert fill is not None and fill.strategy_id == ""


# --------------------------------------------------------------------------
# Backoff
# --------------------------------------------------------------------------


def test_backoff_grows_and_is_capped():
    policy = BackoffPolicy(jitter=False)
    assert [policy.delay(n) for n in (1, 2, 3)] == [1.0, 2.0, 4.0]
    assert policy.delay(50) == policy.max_s


def test_backoff_jitters_so_every_process_does_not_retry_in_lockstep():
    """Without jitter a venue-side outage produces a synchronised storm."""
    policy = BackoffPolicy()
    assert policy.delay(5, rand=lambda: 0.5) == pytest.approx(8.0)
    assert policy.delay(5, rand=lambda: 0.0) == 0.0


# --------------------------------------------------------------------------
# Shadow mode
# --------------------------------------------------------------------------


def test_shadow_keeps_the_inner_venue_name():
    """Renaming the venue here splits positions between two keys.

    Reconciliation would then compare two different, both-empty accounts and
    report clean.
    """
    inner = FakeVenue()
    assert ShadowVenue(inner).name == inner.name


def test_shadow_records_an_order_and_sends_nothing():
    from tradesys.core.events import OrderIntent

    class Refuses(FakeVenue):
        async def place(self, intent):
            raise AssertionError("shadow mode must not reach the venue")

    venue = ShadowVenue(Refuses())
    intent = OrderIntent(correlation_id="c", emitted_at=START, source="t",
                         client_order_id="abc", strategy_id="s", venue="v",
                         symbol="BTCUSDT", side="buy", order_type="limit",
                         quantity=dec("1"), price=dec("60000"))
    ack = run(venue.place(intent))
    assert ack.client_order_id == "abc"
    assert [o.client_order_id for o in venue.orders] == ["abc"]


# --------------------------------------------------------------------------
# The runner
# --------------------------------------------------------------------------


class FakeSession:
    """The session's surface as the runner uses it, and nothing more."""

    def __init__(self) -> None:
        self.adapters = {}
        self.started = 0
        self.events = []
        self.ticks = 0
        self.pipeline = self

        class _Exec:
            def open_machines(self):
                return []
        self.executor = _Exec()
        self.strategies = []
        self.fills = []

    async def start(self, operator=None):
        self.started += 1

    async def on_event(self, event):
        self.events.append(event)

    async def tick(self, now=None):
        self.ticks += 1

    def on_fill(self, fill):
        self.fills.append(fill)


def runner_over(batches, **config):
    session = FakeSession()
    f = feed()
    source = ReplaySource(batches)
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)
        await asyncio.sleep(0)

    runner = LiveRunner(session, f, lambda: source, clock=lambda: START,
                        config=LiveConfig(**config), sleep=sleep)
    return runner, session, source, sleeps


def test_the_runner_drives_the_session_from_decoded_messages():
    runner, session, _, _ = runner_over(
        [[depth(101, 105), depth(106, 110)]], max_connections=1)
    report = run(runner.run())
    assert report.messages == 2
    assert [e.kind for e in session.events] == [
        "book_snapshot", "book_delta", "book_delta"]


def test_the_startup_gate_runs_before_any_stream_is_read():
    runner, session, _, _ = runner_over([[depth(101, 105)]], max_connections=1)
    run(runner.run())
    assert session.started == 1


def test_a_dropped_connection_reconnects_with_backoff():
    source = ReplaySource([[depth(101, 105), DROP], [depth(101, 106)]])
    session = FakeSession()
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)
        await asyncio.sleep(0)

    runner = LiveRunner(session, feed(), lambda: source, clock=lambda: START,
                        config=LiveConfig(max_connections=2), sleep=sleep)
    report = run(runner.run())
    assert report.drops >= 1
    assert report.connections == 2
    assert any(s > 0 for s in sleeps), "a reconnect must back off, or the IP is banned"


def test_every_reconnect_discards_the_book():
    """The whole reason a drop must not be handled inside the stream source."""
    source = ReplaySource([[depth(101, 105), DROP], [depth(101, 106)]])
    session = FakeSession()
    f = feed(FakeVenue(last_update_id=100))
    runner = LiveRunner(session, f, lambda: source, clock=lambda: START,
                        config=LiveConfig(max_connections=2),
                        sleep=lambda s: asyncio.sleep(0))
    run(runner.run())
    # Two connections, and the first delta of each had to resync.
    assert f.stats.resyncs == 2


def test_the_connection_rotates_before_the_venue_drops_it():
    """Binance closes every connection at 24h whether or not anything is wrong."""
    now = {"t": START}
    source = ReplaySource([[depth(101, 105)], [depth(101, 106)]])
    session = FakeSession()

    async def sleep(seconds):
        await asyncio.sleep(0)

    def clock():
        now["t"] += 12 * 3600 * 10**9      # half a day per call
        return now["t"]

    runner = LiveRunner(session, feed(), lambda: source, clock=clock,
                        config=LiveConfig(rotate_after_ns=23 * 3600 * 10**9,
                                          max_connections=2),
                        sleep=sleep)
    report = run(runner.run())
    assert report.rotations >= 1


def test_a_planned_rotation_does_not_back_off():
    """A minute of darkness every day, for a reconnect we chose ourselves."""
    now = {"t": START}
    sleeps = []

    async def sleep(seconds):
        sleeps.append(seconds)
        await asyncio.sleep(0)

    def clock():
        now["t"] += 12 * 3600 * 10**9
        return now["t"]

    source = ReplaySource([[depth(101, 105)], [depth(101, 106)]])
    runner = LiveRunner(FakeSession(), feed(), lambda: source, clock=clock,
                        config=LiveConfig(rotate_after_ns=23 * 3600 * 10**9,
                                          max_connections=2, tick_interval_s=0),
                        sleep=sleep)
    run(runner.run())
    assert all(s == 0 for s in sleeps), "a rotation is not a failure"


def test_the_tick_loop_runs_independently_of_market_data():
    """A feed that has died without closing produces no events, forever.

    The market loop here blocks for good, exactly as it would against a socket
    that is open and silent. If reconciliation were driven from the event
    handler, nothing in the system would ever check anything again.
    """
    session = FakeSession()
    source = SilentSource()
    ticked = {"n": 0}

    async def sleep(seconds):
        ticked["n"] += 1
        if ticked["n"] >= 3:
            runner.stop()
        await asyncio.sleep(0)

    runner = LiveRunner(session, feed(), lambda: source, clock=lambda: START,
                        config=LiveConfig(), sleep=sleep)
    run(asyncio.wait_for(runner.run(), timeout=5))
    assert session.ticks >= 2, "reconciliation must not depend on the market"


def test_read_only_mode_disables_every_strategy():
    """Step 2 of the ladder validates the data path and nothing else."""

    class Strategy:
        class health:
            enabled = True

    session = FakeSession()
    session.strategies = [Strategy()]
    source = ReplaySource([[depth(101, 105)]])
    runner = LiveRunner(session, feed(), lambda: source, clock=lambda: START,
                        config=LiveConfig(mode=Mode.READ_ONLY, max_connections=1),
                        sleep=lambda s: asyncio.sleep(0))
    run(runner.run())
    assert session.strategies[0].health.enabled is False


# --------------------------------------------------------------------------
# Wiring and mode safety
# --------------------------------------------------------------------------


def test_an_unknown_mode_is_refused_at_construction():
    with pytest.raises(ValueError):
        LiveConfig(mode="fast")


def test_production_live_requires_an_explicit_acknowledgement():
    with pytest.raises(PermissionError):
        build_binance_live(mode=Mode.LIVE, testnet=False,
                           credentials=LiveCredentials("k", "s"))


def test_the_default_is_testnet_and_shadow():
    session, _, runner = build_binance_live(credentials=LiveCredentials("k", "s"))
    assert runner.config.mode == Mode.SHADOW
    assert "testnet" in next(iter(session.adapters))


def test_shadow_is_the_adapter_that_receives_orders_by_default():
    session, _, _ = build_binance_live(credentials=LiveCredentials("k", "s"))
    assert isinstance(next(iter(session.adapters.values())), ShadowVenue)


def test_credentials_are_read_from_the_environment_only(monkeypatch):
    monkeypatch.delenv("BINANCE_API_KEY", raising=False)
    monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
    with pytest.raises(MissingCredentials):
        credentials_from_env()
    monkeypatch.setenv("BINANCE_API_KEY", "k")
    monkeypatch.setenv("BINANCE_API_SECRET", "s")
    assert credentials_from_env().api_key == "k"


def test_credentials_never_appear_in_a_repr():
    """Tracebacks are logged, and a logged traceback is a logged secret."""
    assert "hunter2" not in repr(LiveCredentials("k", "hunter2"))


def test_read_only_needs_no_credentials_at_all(monkeypatch):
    """Public streams need no key, and running without one is a real improvement."""
    monkeypatch.delenv("BINANCE_API_KEY", raising=False)
    monkeypatch.delenv("BINANCE_API_SECRET", raising=False)
    session, feed_, runner = build_binance_live(mode=Mode.READ_ONLY)
    assert runner.config.mode == Mode.READ_ONLY


def test_the_trading_adapter_is_keyed_by_its_own_name_in_every_mode():
    for mode in (Mode.READ_ONLY, Mode.SHADOW, Mode.PAPER, Mode.LIVE):
        session, _, _ = build_binance_live(
            mode=mode, credentials=LiveCredentials("k", "s"))
        for key, adapter in session.adapters.items():
            assert adapter.name == key


# --------------------------------------------------------------------------
# End to end: real Binance payload shapes through the real pipeline
# --------------------------------------------------------------------------


def binance_script(venue_symbol="BTCUSDT"):
    """A plausible minute of Binance: a book, some trades, a funding print."""
    out = [depth(1, 1, bids=(("60000", "50"),), asks=(("60001", "50"),))]
    for i in range(6):
        out.append({"stream": "btcusdt@aggTrade",
                    "data": {"e": "aggTrade", "E": 1000 + i, "T": 1000 + i,
                             "s": venue_symbol, "p": "60000.5", "q": "2",
                             "m": i % 2 == 0, "a": i}})
    # Thirty-odd funding prints, because the z-score refuses to report on
    # fewer (a missing feature beats a confident number built on eight points).
    for i in range(34):
        out.append({"stream": "btcusdt@markPrice",
                    "data": {"e": "markPriceUpdate", "E": 2000 + i, "s": venue_symbol,
                             "p": "60000.5", "i": "60000",
                             "r": f"0.000{4 + i % 5}",
                             "T": 2000 + 8 * 3600 * 1000}})
    return out


def test_binance_payloads_drive_the_real_pipeline():
    """The whole point of the layering, asserted once.

    Nothing between the decoder and the ledger knows the data arrived over a
    socket rather than from the simulator. If this needed a single special
    case, SPEC section 3.4's "one code path" would be an intention rather than
    a property.
    """
    from tradesys.demo import PERP_VENUE, build_pipeline
    from tradesys.session import SessionConfig, SessionState, TradingSession

    pipeline, adapters, _ = build_pipeline()
    clock = {"now": START}
    session = TradingSession(
        pipeline, adapters,
        config=SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                             heartbeat_interval_ns=3600 * 10**9,
                             strategy_settle_ns=0),
        clock=lambda: clock["now"])
    f = BinanceFeed(PERP_VENUE, FakeVenue(last_update_id=0), clock=lambda: clock["now"])
    source = ReplaySource([binance_script()])
    runner = LiveRunner(session, f, lambda: source, clock=lambda: clock["now"],
                        config=LiveConfig(mode=Mode.PAPER, max_connections=1),
                        sleep=lambda s: asyncio.sleep(0))

    report = run(runner.run())

    assert session.state == SessionState.RUNNING
    assert report.events >= 8
    assert session.metrics.snapshot()["events_processed"] == report.events
    # The feature engine saw a real book, real trades and a real funding rate.
    engine = pipeline.engine(PERP_VENUE, "BTCUSDT")
    assert engine.book.best_bid == dec("60000")
    snapshot = engine.snapshot("c", clock["now"])
    assert snapshot.features["microprice"] is not None
    assert snapshot.features["funding_zscore"] is not None


def test_a_gap_mid_stream_is_counted_by_the_session_not_just_the_feed():
    """The metric the dashboard reads has to move, not only the feed's own tally."""
    from tradesys.demo import PERP_VENUE, build_pipeline
    from tradesys.session import SessionConfig, TradingSession

    pipeline, adapters, _ = build_pipeline()
    clock = {"now": START}
    session = TradingSession(
        pipeline, adapters,
        config=SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                             heartbeat_interval_ns=3600 * 10**9,
                             strategy_settle_ns=0),
        clock=lambda: clock["now"])
    f = BinanceFeed(PERP_VENUE, FakeVenue(last_update_id=0), clock=lambda: clock["now"])
    # The first delta is a cold start, the second must follow it cleanly, and
    # only the third is a real discontinuity.
    script = [depth(1, 1), depth(2, 2), depth(900, 905)]
    runner = LiveRunner(session, f, lambda: ReplaySource([script]),
                        clock=lambda: clock["now"],
                        config=LiveConfig(max_connections=1),
                        sleep=lambda s: asyncio.sleep(0))
    run(runner.run())
    assert f.stats.gaps == 1
    assert session.metrics.snapshot()["sequence_gaps"] == 1
