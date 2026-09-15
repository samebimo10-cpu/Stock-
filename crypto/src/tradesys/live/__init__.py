"""Live venue connectivity.

Everything below this package is venue-agnostic and offline-testable. This is
the only place that opens a socket, and it is deliberately thin: it turns
bytes into the same :class:`~tradesys.core.events.MarketEvent` and
:class:`~tradesys.core.events.Fill` objects the simulator produces, and hands
them to the same pipeline.

That is the whole point of SPEC section 3.4 - one code path for backtest,
paper and live. If anything in here needed the pipeline to behave differently
because the data came from a socket, the separation would have failed.
"""

from .streams import (
    DROP, BackoffPolicy, ReplaySource, SilentSource, StreamSource, WebsocketSource,
)
from .websocket import Frame, WebSocketClient, WebSocketClosed, WebSocketError

__all__ = [
    "BackoffPolicy",
    "ReplaySource",
    "SilentSource",
    "DROP",
    "StreamSource",
    "WebsocketSource",
    "Frame",
    "WebSocketClient",
    "WebSocketClosed",
    "WebSocketError",
]
