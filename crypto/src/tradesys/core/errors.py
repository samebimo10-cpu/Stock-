"""Normalised venue error taxonomy.

SPEC Annex A section 5 rule 2: venue error codes are normalised before they
cross the adapter boundary. No ``-1013`` above the adapter, or the multi-venue
hedge of SPEC section 18.3 is fictional.

The original venue code is preserved on the exception for the audit record.
"""

from __future__ import annotations

__all__ = [
    "VenueError",
    "RateLimited",
    "IpBanned",
    "InsufficientBalance",
    "FilterViolation",
    "UnknownState",
    "AuthFailed",
    "VenueDown",
    "OrderNotFound",
    "CancelRejected",
]


class VenueError(Exception):
    """Base class. ``venue_code`` keeps the original for the audit log."""

    #: whether a bare retry of the identical request is ever correct
    retryable = False

    def __init__(self, message: str, venue_code: str | int | None = None) -> None:
        super().__init__(message)
        self.venue_code = venue_code


class RateLimited(VenueError):
    """HTTP 429 or weight exhaustion. Back off with jitter, never retry tight."""

    retryable = True

    def __init__(self, message: str, venue_code=None, retry_after_s: float | None = None):
        super().__init__(message, venue_code)
        self.retry_after_s = retry_after_s


class IpBanned(VenueError):
    """HTTP 418. The limiter failed and the ban must be waited out.

    Never reconnect from a different address to get around it: that turns a
    timed ban into an account-level problem.
    """


class InsufficientBalance(VenueError):
    """Binance ``-2010``.

    Usually stale local balance state rather than an actual shortfall
    (SPEC section 8.5 failure mode 8), so the correct response is to trigger a
    reconciliation, not to retry against the same wrong cache.
    """


class FilterViolation(VenueError):
    """Binance ``-1013``. A defect in our rounding, not a market condition.

    Re-fetch ``exchangeInfo``, fix the rounding, and log it as a defect. The
    risk layer approved a quantity; if we cannot express that quantity the
    order does not go out in some other size.
    """


class UnknownState(VenueError):
    """Binance ``-1007`` and every network timeout after the request was sent.

    **Execution status is unknown.** The order may have filled. The only
    correct response is the QUERY state of SPEC section 9.2: poll until
    resolved, and never place another order for this intent.
    """


class AuthFailed(VenueError):
    """Binance ``-2015``. Halt. Retrying can itself trigger a ban."""


class VenueDown(VenueError):
    """Maintenance or 5xx. Held positions stay held; new orders stop."""

    retryable = True


class OrderNotFound(VenueError):
    """Binance ``-2013``. Terminal for that client order ID."""


class CancelRejected(VenueError):
    """Binance ``-2011``. Query the order - it may already have filled."""
