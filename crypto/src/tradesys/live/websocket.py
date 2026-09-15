"""A minimal RFC 6455 WebSocket client.

Written rather than imported, for two reasons. The package has no HTTP or
WebSocket dependency and adding one for a few hundred lines of framing is a
poor trade on a system that must run unattended. And the failure modes that
matter here - a connection dropped at 24 hours, a ping unanswered, a frame
split across reads - are ones we need to handle explicitly anyway, so the
handling may as well be visible.

What it does **not** do: extensions, compression, fragmentation of *outgoing*
messages, or servers that mask. None of those appear on a venue market-data
stream, and implementing them unused would be code nobody can test. Incoming
fragmentation *is* handled: a venue does not usually fragment, but nothing
stops an intermediary from doing so, and a client that silently returns half a
depth update is worse than one that fails.
"""

from __future__ import annotations

import asyncio
import base64
import json
import os
import ssl
import struct
from dataclasses import dataclass
from typing import AsyncIterator, Dict, Optional, Tuple
from urllib.parse import urlparse

__all__ = ["WebSocketClient", "WebSocketError", "WebSocketClosed", "Frame"]

# Opcodes
_CONT, _TEXT, _BINARY, _CLOSE, _PING, _PONG = 0x0, 0x1, 0x2, 0x8, 0x9, 0xA
_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11"


class WebSocketError(RuntimeError):
    pass


class WebSocketClosed(WebSocketError):
    """The peer closed, or we did. Reconnect rather than retrying a send."""


@dataclass(frozen=True)
class Frame:
    opcode: int
    payload: bytes

    @property
    def is_text(self) -> bool:
        return self.opcode == _TEXT

    def json(self):
        return json.loads(self.payload.decode())


class WebSocketClient:
    """One connection. Not reusable after close - make a new one.

    Reconnection lives in the caller, deliberately. A client that reconnects
    itself hides the fact that state was lost, and on a depth stream the
    correct response to a reconnect is to discard the local book and resync,
    not to carry on.
    """

    #: Venues disconnect a client that has not answered a ping within ten
    #: minutes. We answer immediately, so this is documentation of the venue's
    #: limit rather than a timer we run: if answering a ping ever became slow
    #: enough for it to matter, the event loop would already be the problem.
    VENUE_PING_DEADLINE_S = 600.0

    def __init__(self, url: str, *, open_timeout: float = 15.0,
                 read_timeout: float = 60.0) -> None:
        self.url = url
        self.open_timeout = open_timeout
        self.read_timeout = read_timeout
        self._reader: Optional[asyncio.StreamReader] = None
        self._writer: Optional[asyncio.StreamWriter] = None
        self._buffer = bytearray()
        self.closed = False
        self.pings_answered = 0

    # ------------------------------------------------------------------

    async def connect(self) -> None:
        parsed = urlparse(self.url)
        secure = parsed.scheme in ("wss", "https")
        port = parsed.port or (443 if secure else 80)
        host = parsed.hostname or ""
        path = parsed.path or "/"
        if parsed.query:
            path = f"{path}?{parsed.query}"

        context = ssl.create_default_context() if secure else None
        self._reader, self._writer = await asyncio.wait_for(
            asyncio.open_connection(host, port, ssl=context), timeout=self.open_timeout
        )

        key = base64.b64encode(os.urandom(16)).decode()
        request = (
            f"GET {path} HTTP/1.1\r\n"
            f"Host: {host}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self._writer.write(request.encode())
        await self._writer.drain()

        status_line = await asyncio.wait_for(self._reader.readline(), self.open_timeout)
        if b"101" not in status_line:
            raise WebSocketError(f"upgrade refused: {status_line!r}")
        # Drain the remaining headers. We do not verify the accept key: it
        # protects against a confused cache, not against an attacker, and TLS
        # already covers the attacker.
        while True:
            line = await asyncio.wait_for(self._reader.readline(), self.open_timeout)
            if line in (b"\r\n", b"\n", b""):
                break

    # ------------------------------------------------------------------

    async def _read_exact(self, count: int) -> bytes:
        while len(self._buffer) < count:
            chunk = await asyncio.wait_for(self._reader.read(65536), self.read_timeout)
            if not chunk:
                self.closed = True
                raise WebSocketClosed("connection closed by peer")
            self._buffer.extend(chunk)
        out = bytes(self._buffer[:count])
        del self._buffer[:count]
        return out

    async def _read_frame(self) -> Tuple[Frame, bool]:
        """One frame off the wire, with its FIN bit.

        The FIN bit is returned rather than swallowed because it is the only
        thing distinguishing a complete message from the first half of one.
        """
        header = await self._read_exact(2)
        final = bool(header[0] & 0x80)
        opcode = header[0] & 0x0F
        masked = bool(header[1] & 0x80)
        length = header[1] & 0x7F

        if length == 126:
            length = struct.unpack(">H", await self._read_exact(2))[0]
        elif length == 127:
            length = struct.unpack(">Q", await self._read_exact(8))[0]

        mask = await self._read_exact(4) if masked else b""
        payload = await self._read_exact(length) if length else b""
        if masked:
            payload = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        return Frame(opcode, payload), final

    async def recv(self) -> Frame:
        """Return the next data message, answering control frames transparently.

        Reassembles a fragmented message. Control frames may be interleaved
        between fragments, which is why the ping answer lives inside the same
        loop rather than around it.
        """
        pending: Optional[bytearray] = None
        pending_opcode = _TEXT
        while True:
            frame, final = await self._read_frame()
            if frame.opcode == _PING:
                # Answer immediately. A venue disconnects a client that has not
                # replied within ten minutes, and the disconnect looks exactly
                # like a market that went quiet.
                await self._send(_PONG, frame.payload)
                self.pings_answered += 1
                continue
            if frame.opcode == _PONG:
                continue
            if frame.opcode == _CLOSE:
                self.closed = True
                raise WebSocketClosed("peer sent close")

            if frame.opcode == _CONT:
                if pending is None:
                    raise WebSocketError("continuation frame with nothing to continue")
                pending.extend(frame.payload)
            elif not final:
                pending = bytearray(frame.payload)
                pending_opcode = frame.opcode
                continue
            else:
                return frame

            if final:
                assembled = Frame(pending_opcode, bytes(pending))
                pending = None
                return assembled

    async def messages(self) -> AsyncIterator[dict]:
        """Yield decoded JSON messages until the connection closes."""
        while not self.closed:
            frame = await self.recv()
            if frame.is_text:
                yield frame.json()

    # ------------------------------------------------------------------

    async def _send(self, opcode: int, payload: bytes) -> None:
        if self._writer is None or self.closed:
            raise WebSocketClosed("not connected")
        length = len(payload)
        header = bytearray([0x80 | opcode])
        # A client always masks. Servers reject unmasked client frames.
        if length < 126:
            header.append(0x80 | length)
        elif length < (1 << 16):
            header.append(0x80 | 126)
            header.extend(struct.pack(">H", length))
        else:
            header.append(0x80 | 127)
            header.extend(struct.pack(">Q", length))
        mask = os.urandom(4)
        header.extend(mask)
        masked = bytes(b ^ mask[i % 4] for i, b in enumerate(payload))
        self._writer.write(bytes(header) + masked)
        await self._writer.drain()

    async def send_json(self, payload: dict) -> None:
        await self._send(_TEXT, json.dumps(payload, separators=(",", ":")).encode())

    async def close(self) -> None:
        if self._writer is None or self.closed:
            return
        try:
            # Send the close frame *before* marking ourselves closed: ``_send``
            # refuses to write on a closed connection, so setting the flag first
            # means we silently never say goodbye, and the venue counts the
            # connection as dropped rather than as closed cleanly.
            await self._send(_CLOSE, b"")
        except Exception:                                      # noqa: BLE001
            pass
        self.closed = True
        self._writer.close()
        try:
            await self._writer.wait_closed()
        except Exception:                                      # noqa: BLE001
            pass

    async def __aenter__(self) -> "WebSocketClient":
        await self.connect()
        return self

    async def __aexit__(self, *exc) -> None:
        await self.close()
