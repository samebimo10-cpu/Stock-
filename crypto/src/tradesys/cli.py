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


def _check_adapter_conformance() -> Tuple[bool, str]:
    from .adapters.binance import BinanceAdapter
    from .adapters.bybit import BybitAdapter
    from .adapters.conformance import structural_report
    from .adapters.sim import SimAdapter

    reports = [structural_report(cls, label)
               for cls, label in ((SimAdapter, "sim"), (BinanceAdapter, "binance"),
                                  (BybitAdapter, "bybit"))]
    failed = [r for r in reports if not r.ok]
    if failed:
        return False, "; ".join(str(r) for r in failed)
    return True, f"{len(reports)} adapters conform; no venue vocabulary leaks"


def _check_normalisation_deterministic() -> Tuple[bool, str]:
    from .layers.l1_data.archive import Normaliser

    base = 1_700_000_000_000_000_000
    records = [{
        "venue": "binance", "symbol": "BTCUSDT", "stream": "depth",
        "kind": "book_delta", "exchange_ts": base + i * 1_000_000,
        "local_recv_ts": base + i * 1_000_000 + 5_000_000, "sequence": 100 + i,
        "payload": {"b": [["60000.01", "1.5"]]},
    } for i in range(25)]
    n = Normaliser()
    ok = n.is_deterministic(records)
    return ok, ("re-running a version on the same bytes is byte-identical"
                if ok else "normalisation output depends on input order")


def _check_raw_archive_immutable() -> Tuple[bool, str]:
    import tempfile

    from .layers.l1_data.archive import ImmutableViolation, RawArchive

    with tempfile.TemporaryDirectory() as tmp:
        archive = RawArchive(tmp)
        rows = [{"venue": "v", "symbol": "s", "stream": "d",
                 "exchange_ts": 1, "local_recv_ts": 2, "sequence": 1,
                 "payload": {}}]
        path = archive.write("v", "d", rows)
        try:
            archive.overwrite_guard(path)
        except ImmutableViolation:
            checked, failures = archive.verify_all()
            return not failures, f"write-once enforced, {checked} part(s) verified"
    return False, "an existing raw part could be overwritten"


GATES = [
    ("risk.import_graph", _check_import_rules),
    ("data.normalisation_deterministic", _check_normalisation_deterministic),
    ("data.raw_archive_immutable", _check_raw_archive_immutable),
    ("data.multi_venue", _check_adapter_conformance),
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


def books_maker(pipeline):
    ratio = pipeline.books.maker_ratio()
    return "n/a" if ratio is None else f"{ratio:.0%}"


def cmd_demo(args) -> int:
    from .demo import build_cycling_events, build_pipeline
    from .research.backtest import Backtester, cost_impact
    from .research.registry import TrialRegistry

    events = build_cycling_events()
    registry = TrialRegistry()
    pipeline, adapters, recorder = build_pipeline()
    bt = Backtester(pipeline, adapters, registry, "funding_carry",
                    pipeline.strategies[0].parameters())
    result = asyncio.run(bt.run(events, "synthetic", "synthetic"))

    print("Hedged funding carry through the live pipeline, against two simulated")
    print("venues: a perpetual and a spot book.\n")
    for label, value in (
        ("events replayed", result.events),
        ("signals", result.signals),
        ("orders submitted", result.orders),
        ("orders rejected", result.rejections),
        ("orders of unknown state", result.unknown),
        ("fills", result.fills),
        ("decisions recorded", len(recorder)),
        ("leg groups completed", pipeline.unwinder.completed_count),
        ("leg groups broken", pipeline.unwinder.broken_count),
        ("maker share of fills", books_maker(pipeline)),
    ):
        print(f"  {label:<26} {value}")

    books = result.books
    print("\n  Books")
    for label, value in (
        ("equity", books.equity),
        ("realised", books.realised),
        ("unrealised", books.unrealised),
        ("funding accrued", books.accrued_funding),
        ("fees paid", books.total_fees()),
        ("ledger reconciles", books.reconciles()),
    ):
        print(f"    {label:<24} {value}")

    for sid, led in sorted(books.strategies.items()):
        ratio = led.cost_ratio
        print(f"\n  Strategy {sid}")
        print(f"    {'gross':<24} {led.gross_pnl}")
        print(f"    {'net':<24} {led.net_pnl}")
        gate = "" if ratio is None else ("  PASS" if led.passes_cost_gate else "  FAIL")
        print(f"    {'cost ratio':<24} "
              f"{'n/a (gross not positive)' if ratio is None else f'{ratio:.1%}'}"
              f"{gate}  (gate: below 40%)")
        if ratio is not None and not led.passes_cost_gate:
            print("      Costs take most of the carry. At tier-0 fees, crossing the")
            print("      spread on the hedge leg is expensive relative to what funding")
            print("      pays, which is the arithmetic in Annex B section 4 arriving")
            print("      with a hedge attached. A maker entry path on both legs is")
            print("      worth more here than any signal improvement.")

    modelled = result.modelled_costs
    if modelled:
        print("\n  Modelled costs charged into the fill price")
        for label, value in sorted(modelled.items()):
            print(f"    {label:<24} {value}")

    impact = asyncio.run(cost_impact(
        lambda with_costs: build_pipeline(with_costs=with_costs),
        events, registry, "funding_carry",
    ))
    print("\n  Cost model review (SPEC section 11.1)")
    print(f"    gross return             {impact.gross_return:.4%}")
    print(f"    net return               {impact.net_return:.4%}")
    print(f"    cut by costs             {impact.cut:.1%}")
    print(f"    verdict                  {'OK' if impact.passes else 'SUSPECT'}")
    if not impact.passes:
        print("\n  The heuristic is flagging the scenario, not only the model. This")
        print("  synthetic funding stays elevated for five consecutive settlements")
        print("  at a time, which real funding does not, so costs are a smaller")
        print("  share of profit here than they would be live. Reporting that is")
        print("  the point; tuning the scenario until the check passes would be")
        print("  the failure the check exists to catch.")

    print(f"\n  Trials registered: {registry.count()}. The costless run counts too -")
    print("  it informed the search, so it belongs in the deflated Sharpe denominator.")
    print("\n  The two legs are equal and opposite, so the book is delta-neutral")
    print("  while a position is open and what remains is the funding. The hedge")
    print("  leg crosses the spread deliberately: a resting bid does not get hit")
    print("  in a rising market, and a hedge that does not fill is not a hedge.")
    return 0


def cmd_validate(args) -> int:
    """Run the SPEC section 11.2 protocol against the demo strategy."""
    from .core.types import dec
    from .demo import build_events, make_backtest_runner
    from .research.harness import HoldoutStore, ValidationHarness
    from .research.registry import TrialRegistry

    registry = TrialRegistry()
    events = build_events()
    store = HoldoutStore(events, registry, fraction=0.2)
    harness = ValidationHarness(registry, make_backtest_runner(registry),
                                "funding_carry", code_hash="demo")

    report = harness.run(
        store.development, ("synthetic", "synthetic"),
        parameter_sweep={"entry_z": [dec("1.0"), dec("1.5"), dec("2.0")]},
    )
    print(report.render())
    print(f"\n  Trials registered during validation: {registry.count()}")
    print("  Every sweep configuration and cost-stressed run counts. That is the")
    print("  number deflated Sharpe divides by, and it is why it is recorded")
    print("  by the harness rather than by the researcher.")

    if args.holdout:
        print(f"\n  {harness.evaluate_holdout(store, args.holdout)}")

    if not report.passes:
        print("\n  This strategy is NOT validated. On a synthetic 45-period scenario")
        print("  most checks cannot be evaluated at all, and the harness reports that")
        print("  rather than computing a number from too little data.")
    return 0 if report.passes else 1


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
    v = sub.add_parser("validate", help="run the full validation protocol")
    v.add_argument("--holdout", metavar="WHO",
                   help="also evaluate the holdout, once, recorded against this name")

    va = sub.add_parser("verify-audit", help="verify a hash-chained audit log")
    va.add_argument("path")

    args = parser.parse_args(argv)
    return {"selfcheck": cmd_selfcheck, "demo": cmd_demo,
            "validate": cmd_validate,
            "verify-audit": cmd_verify_audit}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
