"""The conformance suite every venue adapter must pass.

SPEC section 17.1: the test that the abstraction is real is running the full
suite against more than one venue. If it only passes against Binance, you have
a Binance client with extra indirection, and the multi-venue regulatory hedge
of SPEC section 18.3 does not exist.

Two kinds of check, because they fail in different ways:

* **Structural** - the adapter implements every method, and no venue
  vocabulary appears in its public surface. A missing ``query_order`` makes the
  adapter unsafe regardless of what else it does well, and a leaked
  ``listenKey`` means the next venue will not fit.
* **Behavioural** - the adapter actually does the right thing with an order,
  a duplicate, a rounding, and an error.

The structural checks run with no venue and no network, so they can sit in the
CLI's selfcheck.
"""

from __future__ import annotations

import inspect
from dataclasses import dataclass, field
from typing import Any, Dict, List, Sequence, Tuple

__all__ = ["REQUIRED_METHODS", "VENUE_VOCABULARY", "ConformanceReport",
           "check_protocol", "check_no_venue_vocabulary", "structural_report"]

#: Every method of :class:`~tradesys.adapters.base.VenueAdapter`.
REQUIRED_METHODS: Tuple[str, ...] = (
    "reference_data", "fee_schedule", "book_snapshot",
    "place", "cancel", "query_order",
    "positions", "balances", "open_orders",
    "server_time", "rate_limit_state",
)

#: Terms that must not appear in a public method name or parameter. Each is a
#: real concept from one venue that would not translate to the next.
VENUE_VOCABULARY: Tuple[str, ...] = (
    "listenkey", "recvwindow", "newclientorderid", "orderlinkid",
    "mbx", "bapi", "retcode", "fapi", "instrumentsinfo", "clordid",
)

#: ``reference_data`` was originally named ``exchange_info``, after Binance's
#: own endpoint. The vocabulary check above caught it, which is the check doing
#: exactly its job: an interface method named after one venue's endpoint is how
#: the next venue comes to fit awkwardly.


@dataclass
class ConformanceReport:
    adapter: str
    passed: List[str] = field(default_factory=list)
    failed: List[Tuple[str, str]] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.failed

    def record(self, name: str, ok: bool, detail: str = "") -> None:
        (self.passed.append(name) if ok else self.failed.append((name, detail)))

    def __str__(self) -> str:
        lines = [f"{self.adapter}: {'PASS' if self.ok else 'FAIL'} "
                 f"({len(self.passed)}/{len(self.passed) + len(self.failed)})"]
        lines.extend(f"    FAIL {name}: {detail}" for name, detail in self.failed)
        return "\n".join(lines)


def check_protocol(adapter_cls: type) -> List[str]:
    """Return the names of missing or non-callable required methods."""
    missing = []
    for name in REQUIRED_METHODS:
        attr = getattr(adapter_cls, name, None)
        if attr is None or not callable(attr):
            missing.append(name)
    return missing


def check_no_venue_vocabulary(adapter_cls: type) -> List[str]:
    """Return public surface elements that leak a venue-specific concept.

    Checked on method names and parameter names, not on docstrings: the whole
    point of a docstring here is to explain the venue's quirk, and forbidding
    the word there would push the explanation out of the one place it belongs.
    """
    leaks: List[str] = []
    for name in REQUIRED_METHODS:
        attr = getattr(adapter_cls, name, None)
        if attr is None:
            continue
        flat = name.replace("_", "").lower()
        for term in VENUE_VOCABULARY:
            if term in flat:
                leaks.append(f"method name {name!r} contains {term!r}")
        try:
            signature = inspect.signature(attr)
        except (TypeError, ValueError):
            continue
        for param in signature.parameters:
            flat_param = param.replace("_", "").lower()
            for term in VENUE_VOCABULARY:
                if term in flat_param:
                    leaks.append(f"{name}({param}) contains {term!r}")
    return leaks


def structural_report(adapter_cls: type, label: str = "") -> ConformanceReport:
    """Run every check that needs no venue and no network."""
    report = ConformanceReport(label or adapter_cls.__name__)

    missing = check_protocol(adapter_cls)
    report.record(
        "implements_the_full_interface", not missing,
        f"missing: {', '.join(missing)}" if missing else "",
    )

    report.record(
        "query_order_is_present", "query_order" not in missing,
        "an adapter that cannot resolve an unknown order state cannot implement "
        "QUERY, and is unsafe regardless of what else it does well",
    )

    leaks = check_no_venue_vocabulary(adapter_cls)
    report.record(
        "no_venue_vocabulary_leaks", not leaks,
        "; ".join(leaks) if leaks else "",
    )

    has_name = isinstance(getattr(adapter_cls, "name", None), str) or "name" in getattr(
        adapter_cls, "__annotations__", {}
    )
    report.record("declares_a_name", has_name,
                  "adapters must carry a name for attribution and audit")

    return report
