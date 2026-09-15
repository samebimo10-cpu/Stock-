"""Stream sources: where live messages come from, and what happens when they stop.

A :class:`StreamSource` yields decoded JSON messages. Three things are
deliberately *not* its job:

* **Decoding into domain events.** That belongs to the venue module, so the
  same source serves market data and user data without knowing either.
* **Reconnecting silently.** A source that reconnects inside its own iterator
  hides the fact that state was lost. On a depth stream the correct response to
  a reconnect is to throw the local book away and resync from a REST snapshot;
  a caller that never learns the connection dropped will instead keep applying
  deltas to a book with a hole in it. So a drop ends the iteration, loudly, and
  the caller decides.
* **Retrying without backoff.** Binance bans an IP for reconnecting too often
  (Annex E section 3), and an IP ban during an open position is strictly worse
  than a gap in the feed: no data *and* no ability to flatten. The backoff here
  is a risk control, not politeness.
"""

from __future__ import annotations

import asyncio
import random
from dataclasses import dataclass
from typing import Any, AsyncIterator, Callable, Iterable, List, Optional, Protocol

from .websocket import WebSocketClient, WebSocketClosed

__all__ = ["StreamSource", "WebsocketSource", "ReplaySource", "SilentSource",
           "BackoffPolicy", "DROP"]


class StreamSource(Protocol):
    """A source of decoded JSON messages from one connection."""

    name: str

    async def connect(self) -> None: ...

    def messages(self) -> AsyncIterator[dict]: ...

    async def close(self) -> None: ...


@dataclass(frozen=True)
class BackoffPolicy:
    """Exponential backoff with full jitter.

    Full jitter rather than a fixed schedule because every process watching the
    same venue sees the same outage at the same instant. Without jitter they
    all retry in lockstep and the reconnect storm is indistinguishable, from
    the venue's side, from an attack - which is when the IP ban arrives.
    """

    initial_s: float = 1.0
    max_s: float = 60.0
    factor: float = 2.0
    jitter: bool = True

    def delay(self, attempt: int, rand: Callable[[], float] = random.random) -> float:
        """Seconds to wait before attempt ``attempt`` (1 is the first retry).

        >>> BackoffPolicy(jitter=False).delay(1)
        1.0
        >>> BackoffPolicy(jitter=False).delay(4)
        8.0
        >>> BackoffPolicy(jitter=False).delay(99)
        60.0
        """
        if attempt < 1:
            return 0.0
        raw = min(self.initial_s * (self.factor ** (attempt - 1)), self.max_s)
        return raw * rand() if self.jitter else raw


class WebsocketSource:
    """A stream over a real WebSocket.

    The URL is produced by a callable rather than fixed, because a user data
    stream's URL contains a listenKey that must be re-issued on every
    reconnect. Reusing one across a reconnect gives a socket that opens
    successfully and then delivers nothing, which is the quietest possible way
    to stop hearing about your own fills.
    """

    def __init__(
        self,
        url_factory: Callable[[], str],
        *,
        name: str = "ws",
        read_timeout: float = 60.0,
        client_factory: Optional[Callable[[str], WebSocketClient]] = None,
    ) -> None:
        self._url_factory = url_factory
        self.name = name
        self._read_timeout = read_timeout
        self._client_factory = client_factory
        self._client: Optional[WebSocketClient] = None
        self.connections = 0

    async def connect(self) -> None:
        url = self._url_factory()
        if self._client_factory is not None:
            self._client = self._client_factory(url)
        else:
            self._client = WebSocketClient(url, read_timeout=self._read_timeout)
        await self._client.connect()
        self.connections += 1

    async def messages(self) -> AsyncIterator[dict]:
        if self._client is None:
            raise RuntimeError("connect() first")
        async for message in self._client.messages():
            yield message

    async def close(self) -> None:
        if self._client is not None:
            await self._client.close()
            self._client = None


#: Put this in a batch where the connection should die. Placing the drop in the
#: script rather than counting messages is what lets a test say "this connection
#: fails halfway and the next one is fine", which is the case that matters:
#: a source that drops on every connection tests the retry, not the recovery.
DROP = object()


class ReplaySource:
    """A source that yields canned messages. The fake the tests run against.

    One batch per connection, so a test scripts the whole reconnect sequence up
    front. Reaching :data:`DROP` inside a batch raises
    :class:`~tradesys.live.websocket.WebSocketClosed` exactly where the venue
    would have dropped, which is the behaviour a live venue will not reproduce
    on demand and the one everything downstream depends on.
    """

    #: Re-exported so a test needs one import.
    DROP = DROP

    def __init__(
        self,
        batches: Iterable[Iterable[Any]],
        *,
        name: str = "replay",
    ) -> None:
        self._batches: List[List[Any]] = [list(b) for b in batches]
        self.name = name
        self.connections = 0
        self.closed = 0
        self.delivered = 0

    async def connect(self) -> None:
        if self.connections >= len(self._batches):
            raise WebSocketClosed(f"{self.name}: no further batches scripted")
        self.connections += 1

    async def messages(self) -> AsyncIterator[dict]:
        for message in self._batches[self.connections - 1]:
            if message is DROP:
                raise WebSocketClosed(f"{self.name}: scripted drop")
            self.delivered += 1
            await asyncio.sleep(0)
            yield message

    async def close(self) -> None:
        self.closed += 1

    @property
    def exhausted(self) -> bool:
        return self.connections >= len(self._batches)


class SilentSource:
    """Connects, then says nothing, forever.

    A venue feed that has died without closing the socket looks exactly like
    this, and it is the case the independent timer exists for. Ordinary quiet
    markets look like it too, which is why the timer cannot distinguish them
    and must simply keep checking.
    """

    def __init__(self, name: str = "silent") -> None:
        self.name = name
        self.connections = 0
        self.closed = 0

    async def connect(self) -> None:
        self.connections += 1

    async def messages(self) -> AsyncIterator[dict]:
        await asyncio.Event().wait()         # never set
        yield {}                             # pragma: no cover - unreachable

    async def close(self) -> None:
        self.closed += 1
