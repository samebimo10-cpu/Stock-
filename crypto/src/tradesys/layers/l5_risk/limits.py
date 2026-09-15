"""The limit register, loaded with bounds validation.

SPEC section 8.5 failure mode 3 is fat-finger config: a decimal misplaced in a
size parameter. The defence is not review, it is that an out-of-range value
**fails to load**. A system that starts up with ``per_trade_risk: 0.2`` and
discovers the problem at the first fill has no defence at all.
"""

from __future__ import annotations

from dataclasses import dataclass
from decimal import Decimal
from pathlib import Path
from typing import Any, Dict, Mapping, Optional, Tuple

from ...core.types import Decimal as Dec, dec
from .approval import ApprovalChain, ApprovalRequired

__all__ = ["LimitError", "Limit", "LimitRegister"]


class LimitError(ValueError):
    """Raised at load time. Never at order time - by then it is too late."""


@dataclass(frozen=True)
class Limit:
    name: str
    value: Dec
    unit: str
    action: str
    #: The declared range this value had to sit inside to load. Carried on the
    #: limit rather than discarded after validation, so an operator asking
    #: "how much room do I have here?" gets an answer from the running system
    #: instead of from whichever file they guess is the one in force.
    bounds: Optional[Tuple[Dec, Dec]] = None


class LimitRegister:
    """Immutable once loaded."""

    def __init__(self, limits: Mapping[str, Limit], equity_definition: str,
                 schema_version: int = 1) -> None:
        self._limits = dict(limits)
        self.equity_definition = equity_definition
        self.schema_version = schema_version

    # -- loading ---------------------------------------------------------

    @classmethod
    def from_mapping(cls, payload: Mapping[str, Any],
                     approvals: Optional[ApprovalChain] = None) -> "LimitRegister":
        """Build a register from a config document.

        When ``approvals`` is supplied the chain is checked **before** any
        value is read, so an unapproved config cannot take effect even
        partially. Passing ``None`` is for research and tests; a production
        risk service always passes a chain (SPEC section 13.2).
        """
        if approvals is not None:
            approvals.check(payload)
        return cls._build(payload)

    @classmethod
    def _build(cls, payload: Mapping[str, Any]) -> "LimitRegister":
        limits_raw = payload.get("limits")
        bounds = payload.get("bounds", {})
        if not isinstance(limits_raw, Mapping) or not limits_raw:
            raise LimitError("config has no 'limits' block")

        limits: Dict[str, Limit] = {}
        for name, spec in limits_raw.items():
            if not isinstance(spec, Mapping) or "value" not in spec:
                raise LimitError(f"limit {name!r} has no value")
            value = dec(str(spec["value"]))

            bound = bounds.get(name)
            if bound is None:
                raise LimitError(
                    f"limit {name!r} has no declared bounds; every limit needs a "
                    "range or a misplaced decimal loads cleanly (SPEC 8.5 #3)"
                )
            lo, hi = dec(str(bound[0])), dec(str(bound[1]))
            if not (lo <= value <= hi):
                raise LimitError(
                    f"limit {name!r} = {value} is outside its declared bounds "
                    f"[{lo}, {hi}]. Refusing to load."
                )
            limits[name] = Limit(name, value, str(spec.get("unit", "")),
                                 str(spec.get("action", "reject")), (lo, hi))

        reg = cls(
            limits,
            str(payload.get("equity_definition", "cash_plus_unrealised_plus_accrued")),
            int(payload.get("schema_version", 1)),
        )
        reg._validate_ladder()
        return reg

    @classmethod
    def from_yaml(cls, path: str | Path,
                  approvals: Optional[ApprovalChain] = None) -> "LimitRegister":
        import yaml

        with open(path, "r", encoding="utf-8") as fh:
            return cls.from_mapping(yaml.safe_load(fh), approvals)

    def _validate_ladder(self) -> None:
        """The drawdown ladder must be ordered, and must sit under the target.

        This is the v1.0 defect that v2.0 corrects: a hard stop at 15% under a
        20% tolerance leaves no room between acceptable and dead. Encoding the
        ordering here means the mistake cannot be reintroduced by a config
        edit.
        """
        amber = self.get("drawdown_amber")
        soft = self.get("drawdown_soft")
        hard = self.get("drawdown_hard")
        if not (amber < soft < hard):
            raise LimitError(
                f"drawdown ladder must be ordered amber < soft < hard, got "
                f"{amber} / {soft} / {hard}"
            )
        if self.get("daily_loss") >= hard:
            raise LimitError(
                f"daily_loss {self.get('daily_loss')} is not below drawdown_hard "
                f"{hard}; the daily limit would never fire before the full stop"
            )
        if self.get("daily_loss") >= self.get("weekly_loss"):
            raise LimitError("daily_loss must be below weekly_loss")

    # -- reading ---------------------------------------------------------

    def get(self, name: str) -> Dec:
        try:
            return self._limits[name].value
        except KeyError:
            raise LimitError(f"no such limit {name!r}") from None

    def limit(self, name: str) -> Limit:
        return self._limits[name]

    def names(self):
        return sorted(self._limits)

    def snapshot(self) -> Dict[str, Dec]:
        return {n: l.value for n, l in self._limits.items()}
