"""Identifiers.

Two kinds, with different requirements:

* **Correlation IDs** are minted once in L1 and carried through feature,
  signal, allocation, risk decision, order, fill and PnL (SPEC section 3.2
  rule 5). They only need to be unique and sortable.
* **Client order IDs are deterministic** (SPEC section 9.3). A retry after a
  crash must regenerate *the same* identifier so the venue rejects the
  duplicate on your behalf. This is the defence against failure mode 1 in
  SPEC section 8.5, where a network timeout leads to a retry and two fills.
"""

from __future__ import annotations

import hashlib
import os
import threading

from .types import Nanos, now_ns

__all__ = ["new_correlation_id", "client_order_id", "CorrelationId"]

CorrelationId = str

# Crockford base32: no I, L, O or U, so an ID read aloud or copied from a log
# cannot be ambiguous.
_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ"
_lock = threading.Lock()
_last_ms = 0
_last_rand = 0


def _encode(value: int, length: int) -> str:
    out = []
    for _ in range(length):
        out.append(_ALPHABET[value & 0x1F])
        value >>= 5
    return "".join(reversed(out))


def new_correlation_id(at_ns: Nanos | None = None) -> CorrelationId:
    """Mint a lexicographically sortable 26-character ID (ULID layout).

    Sortable matters: audit records sort into causal order without a join
    against their timestamps.

    Within a single millisecond the random component is incremented rather than
    redrawn, so two IDs minted in the same millisecond still sort in the order
    they were created.
    """
    global _last_ms, _last_rand
    ms = (at_ns if at_ns is not None else now_ns()) // 1_000_000
    with _lock:
        if ms == _last_ms:
            _last_rand += 1
        else:
            _last_ms = ms
            _last_rand = int.from_bytes(os.urandom(10), "big")
        rand = _last_rand & ((1 << 80) - 1)
    return _encode(ms, 10) + _encode(rand, 16)


def client_order_id(strategy_id: str, symbol: str, intent_sequence: int) -> str:
    """Derive a deterministic client order ID (SPEC section 9.3).

    The same three inputs always produce the same ID, so a process that
    crashes between sending an order and recording the send regenerates the
    identical ID on restart. The venue then rejects it as a duplicate, which
    is the outcome we want: the retry is refused rather than filled twice.

    Binance permits up to 36 characters for ``newClientOrderId``; the prefix
    plus 24 hex characters stays inside that on every venue in scope.

    >>> client_order_id("carry", "BTCUSDT", 7) == client_order_id("carry", "BTCUSDT", 7)
    True
    >>> client_order_id("carry", "BTCUSDT", 7) == client_order_id("carry", "BTCUSDT", 8)
    False
    """
    if intent_sequence < 0:
        raise ValueError("intent_sequence must be non-negative")
    material = f"{strategy_id}\x00{symbol}\x00{intent_sequence}".encode()
    return "ts_" + hashlib.blake2b(material, digest_size=12).hexdigest()
