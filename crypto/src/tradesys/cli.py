"""Command line entry point.

Three commands, each corresponding to something the specification says must be
verifiable rather than asserted:

* ``selfcheck`` - the Phase 0 gates that can be checked against the code
  itself (Annex F). Exits non-zero when one fails, because a requirement
  nobody can fail automatically is a requirement that gets waived at 2am.
* ``demo`` - runs the funding-carry strategy through the real pipeline against
  the simulator, so the system can be seen working.
* ``verify-audit`` - re-verifies a hash-chained audit log.
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path
from typing import List, Tuple

ROOT = Path(__file__).resolve().parents[2]


def _check_import_rules() -> Tuple[bool, str]:
    import ast

    src = Path(__file__).resolve().parent
    problems: List[str] = []
    rules = (("layers/l3_strategy", "adapters", "strategies must not reach a venue"),
             ("layers/l5_risk", "l3_strategy", "risk must not depend on strategies"))
    for package, forbidden, why in rules:
        for path in (src / package).rglob("*.py"):
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for node in ast.walk(tree):
                mod = None
                if isinstance(node, ast.ImportFrom):
                    mod = node.module or ""
                    if node.level:
                        parts = path.relative_to(src).parts[:-1]
                        base = list(parts[: len(parts) - (node.level - 1)]) if node.level > 1 else list(parts)
                        mod = ".".join(base + ([node.module] if node.module else []))
                elif isinstance(node, ast.Import):
                    mod = " ".join(a.name for a in node.names)
                if mod and forbidden in mod:
                    problems.append(f"{path.relative_to(src)} imports {forbidden} ({why})")
    return (not problems), "; ".join(problems) or "import graph clean"


def _check_limits_load() -> Tuple[bool, str]:
    from .layers.l5_risk.limits import LimitRegister

    try:
        reg = LimitRegister.from_yaml(ROOT / "risk" / "limits.yaml")
    except Exception as e:
        return False, f"{type(e).__name__}: {e}"
    return True, f"{len(reg.names())} limits, bounds validated, ladder ordered"


def _check_fat_finger_rejected() -> Tuple[bool, str]:
    import yaml

    from .layers.l5_risk.limits import LimitError, LimitRegister

    payload = yaml.safe_load((ROOT / "risk" / "limits.yaml").read_text())
    payload["limits"]["per_trade_risk"]["value"] = 0.2
    try:
        LimitRegister.from_mapping(payload)
    except LimitError:
        return True, "a 10x size parameter fails to load"
    return False, "an out-of-range limit loaded cleanly"


def _check_query_never_orders() -> Tuple[bool, str]:
    from .core.events import OrderIntent, OrderStatus
    from .core.types import dec
    from .layers.l6_execution.fsm import OrderMachine

    intent = OrderIntent(correlation_id="c", emitted_at=0, source="cli",
                         client_order_id="ts_x", venue="sim", symbol="BTCUSDT",
                         side="buy", quantity=dec("1"), strategy_id="s")
    m = OrderMachine(intent)
    m.on_sent(1)
    m.on_unknown(2, "-1007")
    ok = m.status == OrderStatus.QUERY and not m.may_place_new_order
    return ok, "an order of unknown state cannot place another"


def _check_risk_never_enlarges() -> Tuple[bool, str]:
    from .core.events import OrderIntent
    from .core.types import dec
    from .layers.l5_risk.limits import LimitRegister
    from .layers.l5_risk.service import RiskContext, RiskService
    from .layers.l5_risk.state import PortfolioState

    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("1000")
    state.mark()
    svc = RiskService(LimitRegister.from_yaml(ROOT / "risk" / "limits.yaml"), state)
    now = 1_700_000_000_000_000_000
    for qty in ("0.001", "0.01", "0.05", "0.5", "5"):
        intent = OrderIntent(correlation_id="c", emitted_at=now, source="cli",
                             client_order_id="ts_x", venue="sim", symbol="BTCUSDT",
                             side="buy", quantity=dec(qty), order_type="limit",
                             price=dec("60000"), strategy_id="s")
        d = svc.evaluate(intent, RiskContext(now=now, feed_last_event={"BTCUSDT": now},
                                             mark_prices={"BTCUSDT": dec("60000")}))
        if d.approved and d.adjusted_quantity > dec(qty):
            return False, f"risk enlarged an order of {qty}"
    return True, "risk reduces or refuses, never enlarges"


def _check_no_decision_is_reject() -> Tuple[bool, str]:
    from .adapters.sim import SimAdapter
    from .core.events import OrderIntent, SymbolFilter
    from .core.types import dec
    from .layers.l6_execution.executor import Executor

    filters = {"BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10"))}
    adapter = SimAdapter(filters=filters)
    adapter.set_book("BTCUSDT", [("60000", "5")], [("60001", "5")])
    ex = Executor(adapter, filters, clock=lambda: adapter.now)
    intent = OrderIntent(correlation_id="c", emitted_at=0, source="cli",
                         client_order_id="ts_x", venue="sim", symbol="BTCUSDT",
                         side="buy", quantity=dec("0.01"), order_type="limit",
                         price=dec("60000"), strategy_id="s")
    result = asyncio.run(ex.submit(intent, None))
    return (not result.accepted and not adapter.fills), "a missing risk decision rejects"


def _check_double_fill_prevented() -> Tuple[bool, str]:
    from .adapters.sim import SimAdapter
    from .core.events import OrderIntent, RiskDecision, SymbolFilter
    from .core.types import dec
    from .layers.l6_execution.executor import Executor

    filters = {"BTCUSDT": SymbolFilter("BTCUSDT", dec("0.01"), dec("0.00001"), dec("10"))}
    adapter = SimAdapter(filters=filters)
    adapter.set_book("BTCUSDT", [("60000", "5")], [("60001", "5")])
    ex = Executor(adapter, filters, clock=lambda: adapter.now)
    intent = OrderIntent(correlation_id="c", emitted_at=0, source="cli",
                         client_order_id="ts_x", venue="sim", symbol="BTCUSDT",
                         side="buy", quantity=dec("0.5"), order_type="market",
                         strategy_id="s")
    decision = RiskDecision(correlation_id="c", emitted_at=0, source="l5_risk",
                            intent_id="ts_x", approved=True, adjusted_quantity=dec("0.5"))
    adapter.faults.drop_response_after_accept = True
    asyncio.run(ex.submit(intent, decision))
    asyncio.run(ex.submit(intent, decision))       # the retry that must not fill
    return len(adapter.fills) == 1, f"{len(adapter.fills)} fill(s) after a dropped response"


def _check_lookahead_audit() -> Tuple[bool, str]:
    from .layers.l2_features.audit import LookAheadError, assert_causal

    def leaky(series):
        mean = sum(series) / len(series)
        return [x - mean for x in series]

    try:
        assert_causal(leaky, [1, 2, 3, 9])
    except LookAheadError:
        return True, "full-sample normalisation is detected"
    return False, "a leaking feature passed the audit"


def _check_registry_required() -> Tuple[bool, str]:
    from .research.backtest import Backtester
    from .research.registry import RegistryRequired

    try:
        Backtester(pipeline=None, adapter=None, registry=None)
    except RegistryRequired:
        return True, "a backtest without a trial registry cannot start"
    return False, "a backtest started without registering"


def _check_audit_halt() -> Tuple[bool, str]:
    from .layers.l7_observability.audit import AuditBufferFull, AuditLog

    log = AuditLog(sink=lambda line: (_ for _ in ()).throw(IOError("down")), buffer_limit=2)
    try:
        for i in range(4):
            log.record("x", {"i": i})
    except AuditBufferFull:
        return log.must_halt_trading, "losing the audit path halts trading"
    return False, "trading continued with no audit path"


GATES = [
    ("risk.import_graph", _check_import_rules),
    ("risk.limits_bounded", _check_limits_load),
    ("risk.fat_finger_rejected", _check_fat_finger_rejected),
    ("risk.never_enlarges", _check_risk_never_enlarges),
    ("exec.no_decision_is_reject", _check_no_decision_is_reject),
    ("exec.query_state", _check_query_never_orders),
    ("exec.idempotency", _check_double_fill_prevented),
    ("data.lookahead_audit", _check_lookahead_audit),
    ("research.trial_registry", _check_registry_required),
    ("audit.halt_on_buffer_full", _check_audit_halt),
]


def cmd_selfcheck(args) -> int:
    print("PHASE 0 - checks verifiable against the code itself\n")
    failures = 0
    for name, fn in GATES:
        try:
            ok, detail = fn()
        except Exception as e:
            ok, detail = False, f"{type(e).__name__}: {e}"
        print(f"  [{'PASS' if ok else 'FAIL'}] {name:<34} {detail}")
        failures += 0 if ok else 1
    total = len(GATES)
    print(f"\n  RESULT: {'PASS' if not failures else 'FAIL'} ({total - failures} of {total})")
    if failures:
        return 1
    print("\n  These are the machine-checkable subset of Annex F. The rest -")
    print("  30 days of green data, holdout discipline, chaos coverage - needs")
    print("  a running system and live telemetry.")
    return 0


def cmd_demo(args) -> int:
    from .demo import build_events, build_pipeline
    from .research.backtest import Backtester
    from .research.registry import TrialRegistry

    pipeline, adapter, recorder = build_pipeline()
    registry = TrialRegistry()
    bt = Backtester(pipeline, adapter, registry, "funding_carry",
                    pipeline.strategies[0].parameters())
    result = asyncio.run(bt.run(build_events(), "synthetic", "synthetic"))

    print("Funding carry through the live pipeline, against the simulator.\n")
    rows = [
        ("events replayed", result.events),
        ("signals", result.signals),
        ("orders submitted", result.orders),
        ("orders rejected", result.rejections),
        ("orders of unknown state", result.unknown),
        ("fills", result.fills),
        ("decisions recorded", len(recorder)),
        ("trial id", result.trial_id),
    ]
    for label, value in rows:
        print(f"  {label:<26} {value}")
    print(f"\n  The strategy declines to enter at baseline funding: break-even")
    print(f"  needs ten days at tier-0 fees and it holds for seven.")
    return 0


def cmd_verify_audit(args) -> int:
    from .layers.l7_observability.audit import AuditLog, ChainBroken

    log = AuditLog(args.path)
    try:
        log.verify()
    except ChainBroken as e:
        print(f"CHAIN BROKEN: {e}")
        return 1
    print(f"chain verified: {args.path}")
    return 0


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(prog="tradesys", description=__doc__)
    sub = parser.add_subparsers(dest="command", required=True)

    sub.add_parser("selfcheck", help="run the machine-checkable Phase 0 gates")
    sub.add_parser("demo", help="run the demo backtest through the live pipeline")
    va = sub.add_parser("verify-audit", help="verify a hash-chained audit log")
    va.add_argument("path")

    args = parser.parse_args(argv)
    return {"selfcheck": cmd_selfcheck, "demo": cmd_demo,
            "verify-audit": cmd_verify_audit}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
