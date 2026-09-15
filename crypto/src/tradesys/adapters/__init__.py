"""Venue adapters - the only code that knows a venue exists.

SPEC Annex A section 5. No venue concept appears above this boundary: no
``listenKey``, no ``recvWindow``, no ``orderLinkId``. If those leak upward,
multi-venue is not real and the regulatory hedge of SPEC section 18.3 does not
exist.

Three implementations, and that is the point: an interface with one working
implementation is a Binance client with extra indirection.
:mod:`tradesys.adapters.conformance` is the suite all three must pass.
"""

from .base import VenueAdapter, FilterRounder, RateLimitState, OrderAck, CancelAck
from .conformance import ConformanceReport, structural_report

__all__ = [
    "VenueAdapter", "FilterRounder", "RateLimitState", "OrderAck", "CancelAck",
    "ConformanceReport", "structural_report",
]
