"""Replay from the audit log (SPEC section 10.4, rule 3 of section 3.2).

Two guarantees the specification makes about the log, both of which are claims
until something checks them:

* **Full system state is reconstructible from the log.** Event-sourced state is
  how you debug a bad day. :func:`reconstruct_state` rebuilds positions, cash
  and order state from the records alone, with no access to the running system.
* **Given the log for a window, the research environment reproduces every
  decision the live system made.** :func:`compare_decisions` puts the recorded
  decisions beside a fresh run's and reports where they differ.

This is a different check from the same-code-path test in ``tests/``. That one
replays *market events* through the pipeline and compares two runs. This one
replays *the log itself* and asks whether the record of what happened is
complete enough to reproduce it. A system can pass the first and fail this one,
and the failure mode is the worse of the two: a bad day that cannot be
reconstructed afterwards.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from decimal import Decimal
from typing import Any, Dict, Iterable, List, Mapping, Optional, Sequence, Tuple

from ..core.types import Decimal as Dec, dec

__all__ = ["ReconstructedState", "ReplayDivergence", "reconstruct_state",
           "extract_decisions", "compare_decisions", "AUDITED_DECISIONS"]

#: Record kinds that represent a decision, in the order they occur.
AUDITED_DECISIONS: Tuple[str, ...] = ("signal", "target", "intent", "risk_decision", "order")


@dataclass
class ReconstructedState:
    """System state rebuilt from the log alone."""

    positions: Dict[Tuple[str, str], Dec] = field(default_factory=dict)
    average_price: Dict[Tuple[str, str], Dec] = field(default_factory=dict)
    cash_delta: Dec = dec(0)
    fees: Dec = dec(0)
    orders: Dict[str, str] = field(default_factory=dict)      # client id -> last outcome
    fills: int = 0
    signals: int = 0
    rejections: int = 0
    unknown_orders: List[str] = field(default_factory=list)
    correlation_ids: set = field(default_factory=set)

    def position(self, venue: str, symbol: str) -> Dec:
        return self.positions.get((venue, symbol), dec(0))

    @property
    def open_exposure(self) -> Dec:
        return sum((abs(q) for q in self.positions.values()), dec(0))


def _d(value: Any) -> Dec:
    """Decimals come back from the log as strings, deliberately.

    The audit writer stores them as strings so a float round-trip cannot change
    a recorded number. Reading them back through ``Decimal`` keeps that intact.
    """
    if value is None or value == "":
        return dec(0)
    return dec(str(value))


def reconstruct_state(records: Iterable[Mapping[str, Any]]) -> ReconstructedState:
    """Rebuild positions, cash movement and order outcomes from the log.

    Nothing here consults the live system. If a field was never recorded, it
    cannot be reconstructed, and that is exactly what this function is for -
    finding out before the day you need it.
    """
    state = ReconstructedState()

    for record in records:
        kind = record.get("kind")
        payload = record.get("payload") or {}
        correlation = record.get("correlation_id")
        if correlation:
            state.correlation_ids.add(correlation)

        if kind == "signal":
            state.signals += 1

        elif kind == "fill":
            state.fills += 1
            venue = str(payload.get("venue", ""))
            symbol = str(payload.get("symbol", ""))
            quantity = _d(payload.get("quantity"))
            price = _d(payload.get("price"))
            fee = _d(payload.get("fee"))
            signed = quantity if payload.get("side") == "buy" else -quantity

            key = (venue, symbol)
            previous = state.positions.get(key, dec(0))
            new = previous + signed
            if previous == 0 or (previous > 0) == (signed > 0):
                prior_avg = state.average_price.get(key, dec(0))
                state.average_price[key] = (
                    price if new == 0 or previous == 0
                    else (previous * prior_avg + signed * price) / new
                )
            if new == 0:
                state.positions.pop(key, None)
                state.average_price.pop(key, None)
            else:
                state.positions[key] = new

            state.fees += fee
            state.cash_delta -= fee

        elif kind == "order":
            coid = str(payload.get("coid", ""))
            accepted = bool(payload.get("accepted"))
            state.orders[coid] = "accepted" if accepted else "refused"
            if not accepted:
                state.rejections += 1
                reason = str(payload.get("reason", ""))
                if "unknown" in reason.lower() or "timeout" in reason.lower():
                    state.unknown_orders.append(coid)

    return state


def extract_decisions(records: Iterable[Mapping[str, Any]]) -> List[Tuple[str, str, Tuple]]:
    """Pull the decision sequence out of the log, in recorded order.

    Timestamps and correlation IDs are deliberately excluded: they differ
    between a session and its replay by construction, and comparing them would
    make the check fail for reasons that carry no information. What must match
    is *what was decided*.
    """
    out: List[Tuple[str, str, Tuple]] = []
    for record in records:
        kind = record.get("kind")
        if kind not in AUDITED_DECISIONS:
            continue
        payload = record.get("payload") or {}

        if kind == "signal":
            key = f"{payload.get('strategy_id', '')}:{payload.get('symbol', '')}"
            fields = (("target", str(payload.get("target_position", ""))),
                      ("urgency", str(payload.get("urgency", ""))))
        elif kind == "target":
            key = f"{payload.get('venue', '')}:{payload.get('symbol', '')}"
            fields = (("target", str(payload.get("target", ""))),)
        elif kind == "intent":
            key = str(payload.get("client_order_id", ""))
            fields = (("px", str(payload.get("price", ""))),
                      ("qty", str(payload.get("quantity", ""))),
                      ("side", str(payload.get("side", ""))))
        elif kind == "risk_decision":
            key = str(payload.get("intent_id", ""))
            fields = (("approved", str(payload.get("approved", ""))),
                      ("qty", str(payload.get("adjusted_quantity", ""))),
                      ("rejected_by", str(payload.get("rejected_by", ""))))
        else:                                        # order
            key = str(payload.get("coid", ""))
            fields = (("accepted", str(payload.get("accepted", ""))),)

        out.append((kind, key, tuple(sorted(fields))))
    return out


@dataclass(frozen=True)
class ReplayDivergence:
    index: int
    recorded: Optional[Tuple]
    replayed: Optional[Tuple]

    def __str__(self) -> str:
        return f"[{self.index}] log: {self.recorded!r}\n       replay: {self.replayed!r}"


def compare_decisions(log_records: Iterable[Mapping[str, Any]],
                      replay_decisions: Sequence) -> List[ReplayDivergence]:
    """Compare the log's decisions against a fresh run's.

    ``replay_decisions`` is a :class:`~tradesys.pipeline.DecisionRecorder`'s
    ``decisions``. The recorder names risk decisions ``risk`` and orders
    ``submit``, while the log names them ``risk_decision`` and ``order``; the
    mapping is handled here so neither side has to know about the other's
    vocabulary.
    """
    recorded = extract_decisions(log_records)
    replayed = [_from_recorder(d) for d in replay_decisions]

    divergences: List[ReplayDivergence] = []
    for i in range(max(len(recorded), len(replayed))):
        a = recorded[i] if i < len(recorded) else None
        b = replayed[i] if i < len(replayed) else None
        if a != b:
            divergences.append(ReplayDivergence(i, a, b))
    return divergences


_RECORDER_TO_LOG = {"risk": "risk_decision", "submit": "order"}
#: Only these recorder fields survive into the comparison. The recorder carries
#: a couple that the log has no equivalent for, and comparing those would
#: fail on an absence rather than on a disagreement.
_COMPARED_FIELDS = {
    "signal": ("target", "urgency"),
    "target": ("target",),
    "intent": ("px", "qty", "side"),
    "risk_decision": ("approved", "qty", "rejected_by"),
    "order": ("accepted",),
}


def _from_recorder(decision) -> Tuple[str, str, Tuple]:
    kind = _RECORDER_TO_LOG.get(decision.kind, decision.kind)
    keep = _COMPARED_FIELDS.get(kind, ())
    fields = tuple(sorted((k, v) for k, v in decision.detail if k in keep))
    return (kind, decision.key, fields)
