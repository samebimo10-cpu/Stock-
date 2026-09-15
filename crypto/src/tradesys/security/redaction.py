"""Log redaction (SPEC section 13.2).

Secrets never reach logs. The usual way one does is an exception handler
printing the request that failed, which is why this is tested rather than
trusted.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, Mapping, Pattern, Tuple

__all__ = ["SECRET_PATTERNS", "REDACTED", "redact", "redact_mapping", "looks_secret"]

REDACTED = "[redacted]"

#: Keys whose values are never printed, whatever they contain.
SECRET_KEYS: Tuple[str, ...] = (
    "secret", "api_secret", "apisecret", "signature", "sign", "private_key",
    "privatekey", "password", "passphrase", "token", "authorization", "cookie",
    "api_key", "apikey", "x-mbx-apikey", "x-bapi-api-key", "x-bapi-sign",
)

#: Value shapes that are secrets wherever they appear, including inside a URL
#: or a free-text message. A key name check alone misses the query string an
#: exception handler helpfully included.
SECRET_PATTERNS: Tuple[Pattern[str], ...] = (
    re.compile(r"(?i)(signature=)[A-Za-z0-9+/=_-]{16,}"),
    re.compile(r"(?i)(sign=)[A-Za-z0-9+/=_-]{16,}"),
    re.compile(r"(?i)(secret[\"'\s:=]+)[A-Za-z0-9+/=_-]{16,}"),
    re.compile(r"(?i)(api[_-]?key[\"'\s:=]+)[A-Za-z0-9+/=_-]{16,}"),
    re.compile(r"(?i)(bearer\s+)[A-Za-z0-9._-]{16,}"),
    re.compile(r"-----BEGIN [A-Z ]*PRIVATE KEY-----.*?-----END [A-Z ]*PRIVATE KEY-----",
               re.DOTALL),
)


def looks_secret(key: str) -> bool:
    flat = key.replace("-", "").replace("_", "").lower()
    return any(term.replace("-", "").replace("_", "") in flat for term in SECRET_KEYS)


def redact(text: str) -> str:
    """Strip secret-shaped values out of free text.

    >>> redact("GET /api/v3/order?symbol=BTCUSDT&signature=abcdef0123456789abcdef")
    'GET /api/v3/order?symbol=BTCUSDT&signature=[redacted]'
    """
    out = text
    for pattern in SECRET_PATTERNS:
        if pattern.groups:
            out = pattern.sub(lambda m: m.group(1) + REDACTED, out)
        else:
            out = pattern.sub(REDACTED, out)
    return out


def redact_mapping(data: Mapping[str, Any]) -> Dict[str, Any]:
    """Redact by key name and by value shape, recursively.

    >>> redact_mapping({"symbol": "BTCUSDT", "signature": "abc123"})
    {'signature': '[redacted]', 'symbol': 'BTCUSDT'}
    """
    out: Dict[str, Any] = {}
    for key, value in data.items():
        if looks_secret(str(key)):
            out[str(key)] = REDACTED
        elif isinstance(value, Mapping):
            out[str(key)] = redact_mapping(value)
        elif isinstance(value, str):
            out[str(key)] = redact(value)
        elif isinstance(value, (list, tuple)):
            out[str(key)] = [
                redact_mapping(v) if isinstance(v, Mapping)
                else redact(v) if isinstance(v, str) else v
                for v in value
            ]
        else:
            out[str(key)] = value
    return dict(sorted(out.items()))
