"""The two-person rule, technically enforced (SPEC section 13.2).

v1.0 of the specification states the rule as policy. A policy enforced by
memory is not enforced: the moment that matters is the middle of a drawdown at
3am, which is exactly when one tired person will change a limit and exactly
when nobody is available to review it.

So the risk service **refuses to load a config whose signature chain does not
show two distinct signers**. Not warns - refuses. A control that can be
overridden by the person it constrains is not a control.

Track A has one person, and pretending otherwise would be worse than admitting
it. The substitute is a mandatory delay between committing a change and it
taking effect. It does not prevent a bad decision; it prevents a bad decision
made in the middle of the incident that prompted it, which is the failure mode
the two-person rule is actually guarding against.
"""

from __future__ import annotations

import hashlib
import hmac
import json
import time
from dataclasses import dataclass, field
from typing import Callable, Dict, List, Mapping, Optional, Sequence, Tuple

__all__ = ["Approval", "ApprovalChain", "ApprovalRequired", "config_digest",
           "TWO_PERSON", "DELAYED_SINGLE_PERSON"]

#: Institutional track: two distinct signers, no delay.
TWO_PERSON = "two_person"
#: Small track: one signer, and the change waits.
DELAYED_SINGLE_PERSON = "delayed_single_person"

#: How long a single-person change waits before it takes effect.
DEFAULT_DELAY_SECONDS = 24 * 3600


class ApprovalRequired(PermissionError):
    """The config will not load. Never bypassed, never warned-and-continued."""


def config_digest(payload: Mapping[str, object]) -> str:
    """Stable digest of a config document.

    Sorted and separator-pinned, so a reformatting that changes no values also
    changes no digest - otherwise every whitespace edit invalidates approvals
    and people learn to re-approve without reading.
    """
    return hashlib.sha256(
        json.dumps(payload, sort_keys=True, separators=(",", ":"), default=str).encode()
    ).hexdigest()


@dataclass(frozen=True)
class Approval:
    """One person signing off one exact config."""

    signer: str
    digest: str
    at: float
    signature: str

    @staticmethod
    def sign(signer: str, digest: str, secret: str, at: float) -> "Approval":
        material = f"{signer}\x00{digest}\x00{int(at)}"
        signature = hmac.new(secret.encode(), material.encode(), hashlib.sha256).hexdigest()
        return Approval(signer=signer, digest=digest, at=at, signature=signature)

    def verify(self, secret: str) -> bool:
        material = f"{self.signer}\x00{self.digest}\x00{int(self.at)}"
        expected = hmac.new(secret.encode(), material.encode(), hashlib.sha256).hexdigest()
        return hmac.compare_digest(expected, self.signature)


class ApprovalChain:
    """Holds the approvals for a config and decides whether it may load."""

    def __init__(
        self,
        mode: str = TWO_PERSON,
        secrets: Optional[Mapping[str, str]] = None,
        delay_seconds: int = DEFAULT_DELAY_SECONDS,
        clock: Callable[[], float] = time.time,
    ) -> None:
        if mode not in (TWO_PERSON, DELAYED_SINGLE_PERSON):
            raise ValueError(f"unknown approval mode {mode!r}")
        self.mode = mode
        self.secrets: Dict[str, str] = dict(secrets or {})
        self.delay_seconds = delay_seconds
        self.clock = clock
        self._approvals: Dict[str, List[Approval]] = {}

    # ------------------------------------------------------------------

    def approve(self, signer: str, payload: Mapping[str, object]) -> Approval:
        secret = self.secrets.get(signer)
        if secret is None:
            raise ApprovalRequired(
                f"{signer!r} is not a registered approver. Approvers are named in "
                "advance so an approval cannot be minted by whoever is editing."
            )
        digest = config_digest(payload)
        approval = Approval.sign(signer, digest, secret, self.clock())
        self._approvals.setdefault(digest, []).append(approval)
        return approval

    def approvals_for(self, payload: Mapping[str, object]) -> List[Approval]:
        digest = config_digest(payload)
        return [a for a in self._approvals.get(digest, [])
                if a.verify(self.secrets.get(a.signer, ""))]

    def distinct_signers(self, payload: Mapping[str, object]) -> List[str]:
        """Distinct, because one person signing twice is one person."""
        return sorted({a.signer for a in self.approvals_for(payload)})

    # ------------------------------------------------------------------

    def check(self, payload: Mapping[str, object]) -> None:
        """Raise unless this config may take effect now."""
        approvals = self.approvals_for(payload)
        if not approvals:
            raise ApprovalRequired(
                "this risk config carries no valid approval. A limit change is "
                "not a code change: it takes effect immediately and nothing "
                "downstream reviews it."
            )

        if self.mode == TWO_PERSON:
            signers = self.distinct_signers(payload)
            if len(signers) < 2:
                raise ApprovalRequired(
                    f"risk config has {len(signers)} distinct approver(s) "
                    f"({', '.join(signers) or 'none'}); two are required. One "
                    "person approving twice is one person."
                )
            return

        # Single person, so the change waits instead.
        earliest = min(a.at for a in approvals)
        elapsed = self.clock() - earliest
        if elapsed < self.delay_seconds:
            remaining = self.delay_seconds - elapsed
            raise ApprovalRequired(
                f"risk config was approved {elapsed / 3600:.1f}h ago and takes "
                f"effect in {remaining / 3600:.1f}h. With one approver the delay "
                "is the control: it does not prevent a bad decision, it prevents "
                "one made in the middle of the incident that prompted it."
            )

    def may_load(self, payload: Mapping[str, object]) -> bool:
        try:
            self.check(payload)
        except ApprovalRequired:
            return False
        return True

    def status(self, payload: Mapping[str, object]) -> Dict[str, object]:
        approvals = self.approvals_for(payload)
        return {
            "mode": self.mode,
            "digest": config_digest(payload)[:12],
            "signers": self.distinct_signers(payload),
            "approved_at": min((a.at for a in approvals), default=None),
            "may_load": self.may_load(payload),
        }
