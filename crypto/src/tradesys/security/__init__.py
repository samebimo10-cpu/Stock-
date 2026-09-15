"""Key handling and secret hygiene (SPEC section 13.2).

The trading system never holds key material. It asks the signing service to
sign a request and receives a signature, so a memory dump of the trading
process yields nothing worth having.
"""

from .signer import (
    FORBIDDEN_ENDPOINTS, KeyRecord, SigningRefused, SigningService, SignedRequest,
)
from .redaction import SECRET_PATTERNS, redact, redact_mapping

__all__ = [
    "SigningService", "SigningRefused", "KeyRecord", "SignedRequest",
    "FORBIDDEN_ENDPOINTS", "redact", "redact_mapping", "SECRET_PATTERNS",
]
