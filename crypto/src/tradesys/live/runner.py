"""The live runner: real streams in, the same pipeline underneath.

Everything below this file already worked against the simulator. The runner's
job is to keep a real connection alive well enough that the difference stops
mattering, and to be honest about the moments when it cannot.

Four things it does that a naive read loop does not:

1. **Rotates the connection before the venue drops it.** Binance disconnects
   every 24 hours regardless of health. Rotating at 23 means the reconnection
   happens at a moment of our choosing, with a resync already expected, rather
   than as a surprise.
2. **Discards the book on every reconnect.** Not "if the sequence looks wrong"
   - every time. The gap is invisible precisely when it matters.
3. **Ticks on its own clock.** Reconciliation, the dead-man's switch and the
   drawdown ladder run on a timer, not on market data. A feed that has silently
   died produces no events, and a system that only acts on events is then a
   system that has stopped checking whether it still holds what it thinks.
4. **Keeps the private-stream token alive independently of the socket.** The
   token expires on its own schedule; a healthy socket carrying a dead token
   delivers nothing and looks fine.

Mode is a first-class argument and defaults to the safest one. See
:class:`Mode` for the ladder, which is SPEC section 17.5's, not an invention.
"""

from __future__ import annotations

import asyncio
from dataclasses import dataclass, field
from typing import Any, Callable, Dict, List, Optional

from ..core.events import MarketEvent
from ..core.types import Nanos, now_ns
from .binance_live import BinanceFeed, decode_fill
from .streams import BackoffPolicy, StreamSource
from .websocket import WebSocketClosed

__all__ = ["Mode", "LiveConfig", "LiveRunner", "RunReport"]


class Mode:
    """The SPEC section 17.5 rollout ladder, as values the code understands.

    Each step removes exactly one unknown. Skipping one does not save the time
    it would have taken; it moves the discovery into the step where money is at
    stake.
    """

    #: Step 2. Feeds, latency and book depth are real; no strategy is enabled,
    #: so no intent is ever generated. Validates the data path alone.
    READ_ONLY = "read_only"
    #: Step 3. The full system runs and orders are recorded but never sent.
    SHADOW = "shadow"
    #: Between 3 and 4, and not in the SPEC ladder: orders go to the simulator,
    #: driven by the real book. Fills are modelled, so they are evidence about
    #: the model rather than about the venue. Useful, and never sufficient.
    PAPER = "paper"
    #: Step 4 onward. Real orders, full limits.
    LIVE = "live"

    ALL = (READ_ONLY, SHADOW, PAPER, LIVE)


@dataclass(frozen=True)
class LiveConfig:
    mode: str = Mode.SHADOW
    #: Rotate before the venue's own 24h disconnect (Annex E section 3).
    rotate_after_ns: int = 23 * 3600 * 1_000_000_000
    #: Independent of market data. SPEC section 9.3 sets 5s as the *maximum*
    #: interval, not a target.
    tick_interval_s: float = 5.0
    #: Extend the private-stream token at half its 60-minute life, so a single
    #: failed request is survivable rather than fatal.
    token_keepalive_s: float = 1800.0
    backoff: BackoffPolicy = field(default_factory=BackoffPolicy)
    #: Test and operational bounds. ``None`` means run until stopped.
    max_connections: Optional[int] = None
    max_messages: Optional[int] = None

    def __post_init__(self) -> None:
        if self.mode not in Mode.ALL:
            raise ValueError(f"unknown mode {self.mode!r}; one of {Mode.ALL}")


@dataclass
class RunReport:
    connections: int = 0
    rotations: int = 0
    drops: int = 0
    messages: int = 0
    events: int = 0
    fills: int = 0
    ticks: int = 0
    token_refreshes: int = 0
    errors: List[str] = field(default_factory=list)

    def __str__(self) -> str:
        return (f"connections={self.connections} rotations={self.rotations} "
                f"drops={self.drops} messages={self.messages} events={self.events} "
                f"fills={self.fills} ticks={self.ticks}")


class UserStreamKeys:
    """What the runner needs from a venue to hold a private stream open.

    Named for what it does rather than for Binance's word for it, so a second
    venue can satisfy it without the runner learning a third vocabulary.
    """

    async def open_user_stream(self) -> str: ...
    async def keep_user_stream_alive(self, token: str) -> None: ...
    async def close_user_stream(self, token: str) -> None: ...


class LiveRunner:
    """Drives a :class:`~tradesys.session.TradingSession` from live streams."""

    def __init__(
        self,
        session: Any,
        feed: BinanceFeed,
        market_source: Callable[[], StreamSource],
        *,
        user_source: Optional[Callable[[str], StreamSource]] = None,
        keys: Optional[UserStreamKeys] = None,
        config: Optional[LiveConfig] = None,
        clock: Callable[[], Nanos] = now_ns,
        sleep: Optional[Callable[[float], Any]] = None,
    ) -> None:
        self.session = session
        self.feed = feed
        self._market_source = market_source
        self._user_source = user_source
        self._keys = keys
        self.config = config or LiveConfig()
        self.clock = clock
        self._sleep = sleep or asyncio.sleep
        self.report = RunReport()
        self._stop = False
        self._stop_event: Optional[asyncio.Event] = None
        self._connected_at: Nanos = 0
        self._token: Optional[str] = None

    # ------------------------------------------------------------------

    def stop(self) -> None:
        """Ask every loop to finish at its next opportunity.

        Never cancels work in progress. A blocked *read* is abandoned at once
        (see :meth:`_until_stop`); an order being placed, a reconciliation
        pass, a flatten - those run to completion. Cancelling mid-flight is how
        a shutdown leaves an order whose outcome nobody ever learns, which is
        the one state SPEC section 9.2 has no recovery for.
        """
        self._stop = True
        if self._stop_event is not None:
            self._stop_event.set()

    @property
    def stopped(self) -> bool:
        return self._stop

    async def run(self, operator: Optional[str] = None) -> RunReport:
        """Start the session, then run the loops until stopped.

        The startup gate runs first and is allowed to refuse. A live runner
        that catches :class:`StartupGateFailed` and carries on has removed the
        only thing standing between a restart and trading around a position
        nobody knows about.
        """
        await self.session.start(operator=operator)
        if self.config.mode == Mode.READ_ONLY:
            # Step 2 is about the data path. Enabling strategies here would
            # make it step 3 by accident.
            for strategy in self.session.pipeline.strategies:
                strategy.health.enabled = False

        self._stop_event = asyncio.Event()
        tasks = [asyncio.create_task(self._market_loop()),
                 asyncio.create_task(self._tick_loop())]
        if self._user_source is not None and self._keys is not None:
            tasks.append(asyncio.create_task(self._user_loop()))
        try:
            await asyncio.gather(*tasks)
        finally:
            self._stop = True
            for task in tasks:
                task.cancel()
            await asyncio.gather(*tasks, return_exceptions=True)
            await self._release_token()
        return self.report

    # ------------------------------------------------------------------
    # Market data
    # ------------------------------------------------------------------

    async def _market_loop(self) -> None:
        attempt = 0
        while not self._stop:
            if (self.config.max_connections is not None
                    and self.report.connections >= self.config.max_connections):
                self.stop()
                return
            source = self._market_source()
            planned = False
            try:
                await source.connect()
            except Exception as e:                              # noqa: BLE001
                self.report.errors.append(f"connect: {e}")
                attempt += 1
                await self._backoff(attempt)
                continue

            self.report.connections += 1
            self._connected_at = self.clock()
            # Unconditional. A new connection means an unknown amount of the
            # book was missed, including none - and "including none" is not
            # something that can be established from this side.
            self.feed.on_disconnect()
            attempt = 0
            try:
                async for message in self._until_stop(source):
                    await self._on_market_message(message)
                    if self._stop:
                        break
                    if self._should_rotate():
                        planned = True
                        self.report.rotations += 1
                        break
            except (WebSocketClosed, OSError, asyncio.IncompleteReadError) as e:
                self.report.drops += 1
                self.report.errors.append(f"market stream: {e}")
            finally:
                await source.close()

            if self._stop:
                return
            if planned:
                # A rotation we chose is not a failure, so it does not earn a
                # backoff. Backing off here would leave the feed dark for a
                # minute every day for no reason.
                continue
            attempt += 1
            await self._backoff(attempt)

    async def _on_market_message(self, message: dict) -> None:
        self.report.messages += 1
        events = await self.feed.decode(message)
        for event in events:
            await self._dispatch(event)
        if (self.config.max_messages is not None
                and self.report.messages >= self.config.max_messages):
            self.stop()

    async def _dispatch(self, event: MarketEvent) -> None:
        self.report.events += 1
        # Paper mode: the simulator has to see the real book before the
        # pipeline acts on it, or the order it receives is priced against a
        # book it has not been told about.
        for adapter in self.session.adapters.values():
            apply = getattr(adapter, "apply_market_event", None)
            if apply is not None:
                apply(event)
        await self.session.on_event(event)
        for adapter in self.session.adapters.values():
            step = getattr(adapter, "step", None)
            if step is not None:
                for fill in step():
                    self.report.fills += 1
                    self.session.pipeline.on_fill(fill)

    async def _until_stop(self, source: StreamSource):
        """Yield messages, but give up waiting the moment :meth:`stop` is called.

        A silent socket is indistinguishable from a quiet market from in here,
        and both block a plain ``async for`` indefinitely. Racing each read
        against the stop signal means a shutdown does not have to wait out a
        read timeout - while still never interrupting a message already being
        handled, because the race is only ever around the read itself.
        """
        iterator = source.messages().__aiter__()
        stop_wait = asyncio.ensure_future(self._stop_event.wait())
        try:
            while not self._stop:
                nxt = asyncio.ensure_future(iterator.__anext__())
                done, _ = await asyncio.wait({nxt, stop_wait},
                                             return_when=asyncio.FIRST_COMPLETED)
                if nxt not in done:
                    nxt.cancel()
                    return
                try:
                    yield nxt.result()
                except StopAsyncIteration:
                    return
        finally:
            stop_wait.cancel()

    def _should_rotate(self) -> bool:
        return (self.config.rotate_after_ns > 0
                and self.clock() - self._connected_at >= self.config.rotate_after_ns)

    async def _backoff(self, attempt: int) -> None:
        delay = self.config.backoff.delay(attempt)
        if delay > 0:
            await self._sleep(delay)

    # ------------------------------------------------------------------
    # User data
    # ------------------------------------------------------------------

    async def _user_loop(self) -> None:
        attempt = 0
        while not self._stop:
            try:
                # A fresh token on every connect. Reusing one across a
                # reconnect yields a socket that opens and then says nothing,
                # which is the quietest way to stop hearing about your fills.
                await self._release_token()
                self._token = await self._keys.open_user_stream()
                self.report.token_refreshes += 1
                source = self._user_source(self._token)
                await source.connect()
            except Exception as e:                              # noqa: BLE001
                self.report.errors.append(f"user stream connect: {e}")
                attempt += 1
                await self._backoff(attempt)
                continue

            attempt = 0
            try:
                async for message in self._until_stop(source):
                    self._on_user_message(message)
                    if self._stop:
                        break
            except (WebSocketClosed, OSError, asyncio.IncompleteReadError) as e:
                self.report.drops += 1
                self.report.errors.append(f"user stream: {e}")
            finally:
                await source.close()
            if self._stop:
                return
            attempt += 1
            await self._backoff(attempt)

    def _on_user_message(self, message: dict) -> None:
        self.report.messages += 1
        fill = decode_fill(message, self.feed.venue, self.clock(),
                           strategy_of=self._strategy_of)
        if fill is None:
            return
        self.report.fills += 1
        self.session.pipeline.on_fill(fill)

    def _strategy_of(self, client_order_id: str) -> str:
        """Attribute a fill from the order it belongs to, never from the symbol.

        Two strategies trading the same symbol is the normal case, and symbol
        attribution silently merges their books.
        """
        for machine in self.session.pipeline.executor.open_machines():
            if machine.intent.client_order_id == client_order_id:
                return machine.intent.strategy_id
        return ""

    async def _release_token(self) -> None:
        if self._token and self._keys is not None:
            try:
                await self._keys.close_user_stream(self._token)
            except Exception:                                   # noqa: BLE001
                pass
            self._token = None

    # ------------------------------------------------------------------
    # The independent timer
    # ------------------------------------------------------------------

    async def _tick_loop(self) -> None:
        """Reconciliation, dead-man and the drawdown ladder, on a wall clock.

        Driven here rather than from ``_market_loop`` on purpose. A market that
        has gone quiet and a feed that has died look identical from inside an
        event handler, and it is the second one during which a position
        mismatch goes unnoticed.
        """
        last_keepalive = self.clock()
        while not self._stop:
            await self._sleep(self.config.tick_interval_s)
            if self._stop:
                return
            try:
                await self.session.tick()
                self.report.ticks += 1
            except Exception as e:                              # noqa: BLE001
                self.report.errors.append(f"tick: {e}")

            now = self.clock()
            if (self._token and self._keys is not None
                    and (now - last_keepalive) / 1e9 >= self.config.token_keepalive_s):
                last_keepalive = now
                try:
                    await self._keys.keep_user_stream_alive(self._token)
                except Exception as e:                          # noqa: BLE001
                    # Not fatal on its own: there is another half-hour of
                    # validity left, and the reconnect path issues a fresh
                    # token anyway.
                    self.report.errors.append(f"token keepalive: {e}")
