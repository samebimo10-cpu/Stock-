"""The signing service (SPEC section 13.2).

A separate process holding keys, exposing only "sign this request". The trading
system never handles key material, so a memory dump of the trading process
yields nothing.

The control that matters most is the endpoint allowlist. **A request to a
withdrawal endpoint is refused at the signer even if the key somehow carried
the permission.** That is defence in depth against the one failure in the whole
document that is unrecoverable: if a key with withdrawal rights leaks, the loss
is total and instant, and no other control here matters.

Keys are held per strategy and per environment, so one compromise is contained
and attributable (SPEC section 13.2). A signer asked to sign for an unknown
strategy refuses rather than falling back to a default key - a fallback is how
attribution quietly stops working.
"""

from __future__ import annotations

import hashlib
import hmac
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

__all__ = ["SigningService", "SigningRefused", "KeyRecord", "SignedRequest",
           "FORBIDDEN_ENDPOINTS", "FORBIDDEN_SUBSTRINGS"]

#: Exact endpoint paths the signer will never sign, whatever the key allows.
FORBIDDEN_ENDPOINTS: frozenset = frozenset({
    "/sapi/v1/capital/withdraw/apply",
    "/wapi/v3/withdraw.html",
    "/sapi/v1/asset/transfer",
    "/sapi/v1/sub-account/universalTransfer",
    "/v5/asset/withdraw/create",
    "/v5/asset/transfer/inter-transfer",
    "/v5/asset/transfer/universal-transfer",
    "/api/v5/asset/withdrawal",
})

#: Substrings that make a path suspect even when it is not on the exact list.
#: Venues add endpoints; an allowlist that only knows today's paths is an
#: allowlist that fails open on tomorrow's.
FORBIDDEN_SUBSTRINGS: Tuple[str, ...] = (
    "withdraw", "transfer", "sub-account", "subaccount", "apikey", "api-key",
)


class SigningRefused(PermissionError):
    """The signer will not sign this. Never retried, never worked around."""


@dataclass
class KeyRecord:
    """One key, scoped to a strategy and an environment."""

    key_id: str
    strategy_id: str
    environment: str                 # testnet | production
    #: The secret. Held only inside the service; never returned, never logged.
    _secret: bytes = field(repr=False, default=b"")
    created_at: float = field(default_factory=time.time)
    rotated_at: Optional[float] = None
    #: Permissions the venue actually granted, for the audit record. The signer
    #: does not consult these to decide: the endpoint allowlist decides, so a
    #: key that wrongly carries withdrawal rights still cannot use them.
    permissions: Tuple[str, ...] = ()
    ip_allowlisted: bool = True
    revoked: bool = False

    def __repr__(self) -> str:                       # pragma: no cover - trivial
        return (f"KeyRecord(key_id={self.key_id!r}, strategy_id={self.strategy_id!r}, "
                f"environment={self.environment!r}, revoked={self.revoked})")

    def age_days(self, now: float) -> float:
        """Age since creation or last rotation, in days.

        Takes ``now`` rather than reading the clock. A record that calls
        ``time.time()`` ignores the service's injected clock, which makes
        rotation and expiry untestable and therefore untested.
        """
        return (now - (self.rotated_at or self.created_at)) / 86400

    def expires_without_ip_allowlist(self, now: float) -> bool:
        """Unrestricted keys lose their trading permission after 90 days.

        IP-restricted keys do not expire, so the security control and the
        operational control point the same way and there is no trade-off.
        """
        return not self.ip_allowlisted and self.age_days(now) > 90


@dataclass(frozen=True)
class SignedRequest:
    signature: str
    key_id: str
    signed_at: float
    #: What was signed, for the audit record. Never includes the secret.
    payload_digest: str


class SigningService:
    """Holds keys. Exposes exactly one useful verb.

    In production this runs as its own process and the trading system talks to
    it over a socket. In a test or on testnet it runs in-process; the interface
    is the same, which is the point.
    """

    def __init__(self, rotation_days: int = 90,
                 clock: Callable[[], float] = time.time) -> None:
        self._keys: Dict[str, KeyRecord] = {}
        self._by_scope: Dict[Tuple[str, str], str] = {}
        self.rotation_days = rotation_days
        self.clock = clock
        #: Every signature request, refused ones included. A refused withdrawal
        #: attempt is the most interesting line in the whole log.
        self.audit: List[Dict[str, object]] = []

    # ------------------------------------------------------------------
    # Key management
    # ------------------------------------------------------------------

    def add_key(self, key_id: str, strategy_id: str, environment: str, secret: str,
                permissions: Sequence[str] = (), ip_allowlisted: bool = True) -> KeyRecord:
        if "withdraw" in {p.lower() for p in permissions}:
            # Refuse at the door. A key with withdrawal rights should not exist,
            # and accepting one here would mean the only thing standing between
            # a leak and a total loss is a path comparison.
            raise SigningRefused(
                f"key {key_id!r} claims withdrawal permission. Trading keys have "
                "withdrawals disabled, always, no exception (SPEC section 13.2)."
            )
        record = KeyRecord(
            key_id=key_id, strategy_id=strategy_id, environment=environment,
            _secret=secret.encode(), permissions=tuple(permissions),
            ip_allowlisted=ip_allowlisted, created_at=self.clock(),
        )
        self._keys[key_id] = record
        self._by_scope[(strategy_id, environment)] = key_id
        return record

    def rotate(self, key_id: str, new_secret: str) -> KeyRecord:
        record = self._require_key(key_id)
        record._secret = new_secret.encode()
        record.rotated_at = self.clock()
        return record

    def revoke(self, key_id: str) -> None:
        self._require_key(key_id).revoked = True

    def keys_due_for_rotation(self) -> List[KeyRecord]:
        """Quarterly rotation is a rehearsed procedure, not an improvisation."""
        now = self.clock()
        return [k for k in self._keys.values()
                if not k.revoked and k.age_days(now) > self.rotation_days]

    def keys_at_risk(self) -> List[KeyRecord]:
        """Keys whose trading permission is about to lapse for want of an allowlist."""
        now = self.clock()
        return [k for k in self._keys.values()
                if not k.revoked and k.expires_without_ip_allowlist(now)]

    def _require_key(self, key_id: str) -> KeyRecord:
        try:
            return self._keys[key_id]
        except KeyError:
            raise SigningRefused(f"no such key {key_id!r}") from None

    # ------------------------------------------------------------------
    # Signing
    # ------------------------------------------------------------------

    def sign(self, strategy_id: str, environment: str, endpoint: str,
             payload: str) -> SignedRequest:
        """Sign a request, or refuse it.

        Refusal reasons, in the order they are checked, cheapest first:

        1. The endpoint moves money off the venue.
        2. There is no key for this strategy and environment.
        3. The key is revoked.

        There is no fourth reason and no override. An override path here is an
        override path an attacker can reach.
        """
        normalised = endpoint.split("?")[0].rstrip("/").lower()

        if self._is_forbidden(normalised):
            self._record(strategy_id, environment, endpoint, None, refused=True,
                         reason="endpoint moves funds")
            raise SigningRefused(
                f"refusing to sign {endpoint!r}: it moves funds off the venue. "
                "The signer refuses these regardless of what the key permits, "
                "because a key with withdrawal rights is a total loss and this "
                "is the last control before it."
            )

        key_id = self._by_scope.get((strategy_id, environment))
        if key_id is None:
            self._record(strategy_id, environment, endpoint, None, refused=True,
                         reason="no key for this scope")
            raise SigningRefused(
                f"no key for strategy {strategy_id!r} in {environment!r}. Keys are "
                "per strategy and per environment so a compromise is contained "
                "and attributable; falling back to another key would defeat both."
            )

        record = self._require_key(key_id)
        if record.revoked:
            self._record(strategy_id, environment, endpoint, key_id, refused=True,
                         reason="key revoked")
            raise SigningRefused(f"key {key_id!r} is revoked")

        signature = hmac.new(record._secret, payload.encode(), hashlib.sha256).hexdigest()
        digest = hashlib.sha256(payload.encode()).hexdigest()
        self._record(strategy_id, environment, endpoint, key_id, refused=False,
                     reason="", digest=digest)
        return SignedRequest(signature=signature, key_id=key_id,
                             signed_at=self.clock(), payload_digest=digest)

    @staticmethod
    def _is_forbidden(path: str) -> bool:
        if path in {p.lower() for p in FORBIDDEN_ENDPOINTS}:
            return True
        return any(term in path for term in FORBIDDEN_SUBSTRINGS)

    def _record(self, strategy_id: str, environment: str, endpoint: str,
                key_id: Optional[str], refused: bool, reason: str,
                digest: str = "") -> None:
        self.audit.append({
            "at": self.clock(), "strategy_id": strategy_id, "environment": environment,
            "endpoint": endpoint, "key_id": key_id, "refused": refused,
            "reason": reason, "payload_digest": digest,
        })

    # ------------------------------------------------------------------

    @property
    def refusals(self) -> List[Dict[str, object]]:
        return [row for row in self.audit if row["refused"]]

    def as_signer(self, strategy_id: str, environment: str, endpoint: str):
        """Adapt to the venue adapters' ``Signer`` protocol.

        The adapter gets something that can sign and nothing that can be read.
        """
        service = self

        class _ScopedSigner:
            def sign(self, payload: str) -> str:
                return service.sign(strategy_id, environment, endpoint, payload).signature

        return _ScopedSigner()
