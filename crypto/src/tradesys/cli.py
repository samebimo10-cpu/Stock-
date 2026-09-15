"""Command line entry point.

Every command corresponds to something the specification says must be
verifiable rather than asserted, or to a question an operator has to be able to
answer instantly.

**Prove it**

* ``selfcheck`` - the Phase 0 gates checkable against the code itself (Annex
  F). Exits non-zero when one fails, because a requirement nobody can fail
  automatically is a requirement that gets waived at 2am.
* ``chaos`` - injects each failure SPEC section 8.5 ranks above strategy risk
  and asserts the guarantee holds.
* ``verify-audit`` - re-verifies a hash-chained audit log.

**See it work, offline**

* ``demo`` - the funding-carry strategy through the real pipeline against the
  simulator.
* ``session`` - the same, with the startup gate, reconciliation and the
  dead-man's switch.
* ``validate`` - the full section 11.2 protocol. Exits 1: nothing is validated.
* ``viability`` - what the market would have to pay for the strategy to clear
  its own cost gate.

**Operate it**

* ``doctor`` - everything that must be true before anything connects.
* ``limits`` - which limits are in force, and which file they came from. The
  second half is the point: a system that silently falls back to built-in
  defaults will trade all week on limits nobody chose.
* ``live`` - connect to Binance. Testnet and shadow mode unless told otherwise.
"""

from __future__ import annotations

import argparse
import asyncio
import copy
import sys
from pathlib import Path
from dataclasses import replace
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
    """The limits actually in force, wherever they came from.

    Reading ``ROOT / "risk" / "limits.yaml"`` directly, as this used to, made
    three of the fifteen gates fail for anyone who installed the package rather
    than working in the checkout - and selfcheck is the first thing the
    quickstart tells them to run. A gate that fails because of where the code
    was installed teaches people to ignore gate failures.
    """
    from .config import find_limits, load_limits

    try:
        source = find_limits()
        reg = load_limits()
    except Exception as e:                                     # noqa: BLE001
        return False, f"{type(e).__name__}: {e}"
    where = "built-in" if source.is_built_in else str(source.path)
    return True, f"{len(reg.names())} limits, bounds validated, ladder ordered ({where})"


def _check_fat_finger_rejected() -> Tuple[bool, str]:
    from .config import BUILT_IN_LIMITS
    from .layers.l5_risk.limits import LimitError, LimitRegister

    payload = copy.deepcopy(dict(BUILT_IN_LIMITS))
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
    from .config import load_limits
    from .core.events import OrderIntent
    from .core.types import dec
    from .layers.l5_risk.service import RiskContext, RiskService
    from .layers.l5_risk.state import PortfolioState

    state = PortfolioState(cash=dec("100000"))
    state.median_order_notional = dec("1000")
    state.mark()
    svc = RiskService(load_limits(), state)
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


def _check_chaos_suite() -> Tuple[bool, str]:
    from .chaos import run_all

    results = run_all()
    failed = [r for r in results if not r.passed]
    if failed:
        return False, "; ".join(f"{r.scenario.name}: {r.detail}" for r in failed)
    return True, f"{len(results)} failure-injection scenarios pass"


def _check_signer_refuses_withdrawals() -> Tuple[bool, str]:
    from .security import SigningRefused, SigningService

    service = SigningService()
    service.add_key("k", "s", "testnet", "secret", permissions=("spot",))
    for endpoint in ("/sapi/v1/capital/withdraw/apply", "/v5/asset/withdraw/create"):
        try:
            service.sign("s", "testnet", endpoint, "x")
        except SigningRefused:
            continue
        return False, f"the signer signed {endpoint}"
    try:
        service.add_key("k2", "s2", "testnet", "x", permissions=("withdraw",))
    except SigningRefused:
        return True, "withdrawal endpoints and withdrawal-capable keys both refused"
    return False, "a key claiming withdrawal rights was accepted"


GATES = [
    ("risk.import_graph", _check_import_rules),
    ("test.chaos_suite", _check_chaos_suite),
    ("sec.signer_refuses_withdrawals", _check_signer_refuses_withdrawals),
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
            fallbacks = getattr(pipeline, "_fallback_count", None)
            print("      Costs take most of the carry. The hedge posts first and")
            print("      crosses only on the fallback, but in this scenario funding is")
            print("      elevated precisely while price trends, so the resting bid is")
            print("      never hit and the fallback fires every time. Maker entry does")
            print("      not help when the market moves away from you, which is exactly")
            print("      when the hedge is needed. What would help is a lower fee tier,")
            print("      a wider entry threshold so fewer round trips carry the cost,")
            print("      or accepting that tier-0 carry does not clear its own costs.")

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


def cmd_chaos(args) -> int:
    """Run the SPEC section 14.3 scenarios, not merely test them."""
    from .chaos import run_all

    print("CHAOS SUITE - each scenario injects a failure that SPEC section 8.5")
    print("ranks above strategy risk, and asserts what must happen.\n")
    results = run_all()
    for result in results:
        print(result)
        if not result.passed:
            print(f"         guarantee broken: {result.scenario.guarantee}")
    passed = sum(1 for r in results if r.passed)
    print(f"\n  RESULT: {'PASS' if passed == len(results) else 'FAIL'} "
          f"({passed} of {len(results)})")
    if passed == len(results):
        print("\n  Re-run these quarterly and after any change to risk or execution.")
        print("  Chaos tests that ran once, a year ago, test a system that no")
        print("  longer exists.")
    return 0 if passed == len(results) else 1


def cmd_session(args) -> int:
    """Start a session against the simulator and drive the demo scenario."""
    from .demo import build_cycling_events, build_pipeline
    from .session import SessionConfig, TradingSession

    pipeline, adapters, _ = build_pipeline()
    clock = {"now": 1_700_000_000_000_000_000}
    session = TradingSession(
        pipeline, adapters,
        config=SessionConfig(reconcile_interval_ns=8 * 3600 * 10**9,
                             heartbeat_interval_ns=3600 * 10**9,
                             strategy_settle_ns=0),
        clock=lambda: clock["now"],
    )

    async def drive():
        await session.start(operator=args.operator)
        print("  startup gate passed:")
        for step in session.startup_report:
            print(f"    {step}")
        print()
        for event in build_cycling_events():
            clock["now"] = event.emitted_at
            for venue in adapters.values():
                venue.apply_market_event(event)
            await session.on_event(event)
            for venue in adapters.values():
                for fill in venue.step():
                    pipeline.on_fill(fill)
        if args.kill:
            await session.manual_kill(args.operator or "operator")

    asyncio.run(drive())

    status = session.status()
    print("  Session status")
    for key in ("state", "equity", "open_positions", "open_orders",
                "open_leg_groups", "reconciliation_clean"):
        print(f"    {key:<24} {status[key]}")
    print(f"    {'kill switch':<24} {status['kill_switch']['state']}")

    print("\n  Indicators")
    snapshot = session.metrics.snapshot()
    for name in sorted(snapshot):
        if name.startswith(("events_", "reconciliation_", "flatten", "equity",
                            "drawdown", "open_", "kill_")):
            print(f"    {name:<34} {snapshot[name]:g}")

    pages = session.alerts.pages()
    print(f"\n  Pages raised: {len(pages)}")
    for alert in pages[:5]:
        print(f"    P1 {alert.name}: {alert.detail}")
    return 0


def cmd_live(args) -> int:
    """Connect to Binance. Testnet and shadow mode unless told otherwise.

    The defaults are the safe end of the SPEC section 17.5 ladder because the
    defaults are what runs when somebody is in a hurry.
    """
    import asyncio

    from .live.runner import Mode
    from .live.wiring import MissingCredentials, build_binance_live

    symbols = [s.strip().upper() for s in args.symbols.split(",") if s.strip()]
    try:
        session, feed, runner = build_binance_live(
            symbols, mode=args.mode, testnet=not args.production,
            futures=args.futures, equity=args.equity,
            base_notional=args.notional, confirm_live=args.confirm_live,
        )
    except (MissingCredentials, PermissionError) as e:
        print(f"REFUSED: {e}")
        return 2

    endpoint = "PRODUCTION" if args.production else "testnet"
    print(f"  venue      {feed.venue}  ({endpoint})")
    print(f"  mode       {args.mode}")
    print(f"  symbols    {', '.join(symbols)}")
    print(f"  orders     {_orders_go_where(args.mode)}")
    if args.mode == Mode.LIVE:
        print("  WARNING    real orders. Neither strategy in this repository has")
        print("             passed validation; `tradesys validate` exits 1.")

    if args.dry_run:
        print("\n  dry run: nothing connected, nothing sent.")
        return 0

    if args.max_messages:
        runner.config = replace(runner.config, max_messages=args.max_messages)

    try:
        report = asyncio.run(runner.run(operator=args.operator))
    except KeyboardInterrupt:
        runner.stop()
        print("\n  interrupted")
        return 0
    except Exception as e:                                     # noqa: BLE001
        print(f"  run failed: {e}")
        return 1

    print(f"\n  {report}")
    print(f"  feed: {feed.stats.events} events, {feed.stats.gaps} gaps, "
          f"{feed.stats.resyncs} resyncs")
    for error in report.errors[:5]:
        print(f"    error: {error}")
    status = session.status()
    for key in ("state", "equity", "open_positions", "open_orders",
                "reconciliation_clean"):
        print(f"    {key:<22} {status[key]}")
    return 0


def _orders_go_where(mode: str) -> str:
    from .live.runner import Mode

    return {
        Mode.READ_ONLY: "none - strategies are disabled",
        Mode.SHADOW: "recorded locally, never sent",
        Mode.PAPER: "the simulator, priced off the real book",
        Mode.LIVE: "THE VENUE",
    }[mode]


def cmd_viability(args) -> int:
    """What the market would have to pay for the carry strategy to clear its gate.

    "It fails the cost gate" is a poor place to stop. This says by how much, and
    what would have to change - which is either a specification for the next
    thing to build or a demonstration that nothing reachable supplies it.
    """
    from .core.types import dec
    from .research.viability import (
        BINANCE_FUTURES_TIERS, COST_GATE, OBSERVED_FUNDING, carry_requirement,
        CostStructure, survey,
    )

    hold = args.hold
    print(f"  Funding carry against the {float(COST_GATE) * 100:.0f}% cost gate "
          f"(SPEC section 11.1), held {hold} intervals ({hold / 3:.1f} days).")
    print("  One leg crosses, because the hedge leg must (ADR 0004).\n")

    requirements = survey(BINANCE_FUTURES_TIERS, hold_intervals=hold,
                          crossing_legs=1)
    for requirement in requirements:
        print(f"    {requirement}")

    print("\n  Against funding as it actually behaves:\n")
    tier0 = requirements[0]
    print(f"    {'regime':<26} {'rate/8h':>9}  {'vs tier-0 need':>14}")
    for label, rate in OBSERVED_FUNDING:
        multiple = rate / tier0.required_rate
        verdict = "clears" if rate >= tier0.required_rate else "short"
        print(f"    {label:<26} {float(rate) * 100:8.4f}%  "
              f"{float(multiple):13.2f}x  {verdict}")

    print("\n  What this says")
    print(f"    At tier 0 the trade needs {float(tier0.required_rate) * 100:.4f}% "
          f"per 8h sustained for {hold / 3:.0f} days")
    print(f"    ({float(tier0.required_annualised) * 100:.0f}% annualised). Baseline "
          "funding is a quarter of that.")
    print("    Reaching VIP 9 - four billion USDT of 30-day volume - lowers the")
    print(f"    requirement to {float(requirements[-1].required_rate) * 100:.4f}% per 8h, "
          "which is still above baseline.")
    print("\n    So the strategy needs a crowded market, and crowded is exactly")
    print("    when price trends against the short perpetual. That is not a")
    print("    coincidence to be optimised around; it is what funding is paying")
    print("    for. ADR 0004 records the same finding from the execution side.")
    return 0


def cmd_limits(args) -> int:
    """Print the limits actually in force, and the file they came from.

    The second half is the point. A system that silently falls back to
    built-in defaults when a file is missing will trade all week on limits
    nobody chose, and the first sign of it is a position larger than anyone
    expected.
    """
    from .config import LIMITS_ENV, export_limits, find_limits, load_limits

    if args.export:
        try:
            written = export_limits(args.export)
        except FileExistsError as e:
            print(f"REFUSED: {e}")
            return 2
        print(f"  wrote {written}")
        print(f"  point {LIMITS_ENV} at it, then `tradesys limits` to confirm "
              "it is the one in force.")
        return 0

    try:
        source = find_limits(args.path)
        register = load_limits(args.path)
    except FileNotFoundError as e:
        print(f"REFUSED: {e}")
        return 2
    except Exception as e:                                     # noqa: BLE001
        print(f"REFUSED: the limit register did not load: {e}")
        return 2

    print(f"  source           {source}")
    if source.is_built_in:
        print("                   No limits file was found. These are the built-in")
        print("                   values. That is survivable but it is not a choice")
        print("                   anyone made - run `tradesys limits --export` and")
        print(f"                   set {LIMITS_ENV}.")
    print(f"  equity           {register.equity_definition}")
    print()
    snapshot = register.snapshot()
    print(f"    {'limit':<28} {'value':>10}   action")
    for name in sorted(snapshot):
        limit = register.limit(name)
        low, high = limit.bounds if limit.bounds else ("", "")
        bound = f"[{low}, {high}]" if limit.bounds else ""
        print(f"    {name:<28} {str(limit.value):>10}   {limit.action:<20} {bound}")
    print(f"\n  {len(snapshot)} limits, every one bounded and validated on load.")
    return 0


def cmd_doctor(args) -> int:
    """Everything that must be true before anything connects.

    Written as a command rather than a checklist in a runbook because a
    checklist gets skipped and a command gets run. Each check says what it
    found, not merely pass or fail - "clock drift 4.2ms" is actionable and
    "clock: OK" is not.
    """
    import os
    import sys as _sys

    from .config import LIMITS_ENV, find_limits, load_limits

    problems: List[str] = []
    warnings: List[str] = []

    def report(name: str, ok: bool, detail: str, fatal: bool = True) -> None:
        mark = "ok  " if ok else ("FAIL" if fatal else "warn")
        print(f"  [{mark}] {name:<22} {detail}")
        if not ok:
            (problems if fatal else warnings).append(f"{name}: {detail}")

    print("  Preflight\n")

    version = ".".join(str(n) for n in _sys.version_info[:3])
    report("python", _sys.version_info >= (3, 10), f"{version} (3.10+ required)")

    try:
        import yaml                                            # noqa: F401
        report("pyyaml", True, "present")
    except ImportError:
        report("pyyaml", False, "missing - pip install pyyaml")

    try:
        source = find_limits()
        register = load_limits()
        report("limits", not source.is_built_in,
               f"{source}, {len(register.snapshot())} limits",
               fatal=False)
        if source.is_built_in:
            warnings.append(
                f"no limits file: run `tradesys limits --export risk/limits.yaml` "
                f"and set {LIMITS_ENV}")
    except Exception as e:                                     # noqa: BLE001
        report("limits", False, str(e))

    key = os.environ.get("BINANCE_API_KEY", "")
    secret = os.environ.get("BINANCE_API_SECRET", "")
    have_creds = bool(key and secret)
    report("credentials", have_creds,
           f"BINANCE_API_KEY set ({len(key)} chars), secret set" if have_creds
           else "BINANCE_API_KEY / BINANCE_API_SECRET not set "
                "(only read_only mode works without them)",
           fatal=False)
    if key and not key.startswith(("test", "TEST")) and not args.production:
        warnings.append(
            "the key does not look like a testnet key, and you have not passed "
            "--production. Check you are pointing where you think you are.")

    # Never print a secret, not even a prefix. A truncated secret in a terminal
    # is still a secret in a scrollback buffer and in whatever captured it.
    if secret and secret in os.environ.get("PS1", ""):
        problems.append("the API secret appears in your shell prompt")

    if args.network:
        ok, detail = _check_venue(args.production)
        report("venue", ok, detail)
        if ok:
            drift_ok, drift_detail = _check_clock(args.production)
            report("clock", drift_ok, drift_detail)
    else:
        print("  [skip] venue                 pass --network to check "
              "reachability and clock drift")

    print()
    for warning in warnings:
        print(f"  warn: {warning}")
    if problems:
        print(f"\n  RESULT: NOT READY ({len(problems)} blocking)")
        for problem in problems:
            print(f"    {problem}")
        return 1
    print("  RESULT: ready" + (" (with warnings)" if warnings else ""))
    print("\n  Ready means the machine is ready. It says nothing about whether")
    print("  the strategy should trade - that is `tradesys validate`, which")
    print("  exits 1 today, and the section 15 gates agreed in writing.")
    return 0


def _check_venue(production: bool) -> Tuple[bool, str]:
    import time as _time

    from .adapters.binance import BinanceAdapter, BinanceEndpoints

    endpoints = (BinanceEndpoints.spot_production() if production
                 else BinanceEndpoints.spot_testnet())
    adapter = BinanceAdapter(endpoints)
    started = _time.time()
    try:
        asyncio.run(adapter.server_time())
    except Exception as e:                                     # noqa: BLE001
        return False, f"{endpoints.rest} unreachable: {e}"
    return True, f"{endpoints.rest} reachable in {(_time.time() - started) * 1000:.0f}ms"


def _check_clock(production: bool) -> Tuple[bool, str]:
    from .adapters.binance import BinanceAdapter, BinanceEndpoints
    from .core.types import now_ns

    endpoints = (BinanceEndpoints.spot_production() if production
                 else BinanceEndpoints.spot_testnet())
    adapter = BinanceAdapter(endpoints)
    try:
        venue_ns = asyncio.run(adapter.server_time())
    except Exception as e:                                     # noqa: BLE001
        return False, f"could not read venue time: {e}"
    drift_ms = abs(venue_ns - now_ns()) / 1e6
    # 100ms is where the venue rejects signed requests outright, so trading on
    # is not an option anyway. 50ms is where it is worth fixing.
    return drift_ms < 100.0, (
        f"drift {drift_ms:.1f}ms"
        + ("" if drift_ms < 50 else " - above 50ms, check NTP")
        + ("" if drift_ms < 100 else " - the startup gate will halt on this"))


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
    sub.add_parser("chaos", help="run the failure-injection scenarios")

    se = sub.add_parser("session", help="start a session and drive the demo scenario")
    se.add_argument("--operator", help="acknowledge a startup discrepancy as this person")
    se.add_argument("--kill", action="store_true", help="exercise the manual kill switch")

    v = sub.add_parser("validate", help="run the full validation protocol")
    v.add_argument("--holdout", metavar="WHO",
                   help="also evaluate the holdout, once, recorded against this name")

    va = sub.add_parser("verify-audit", help="verify a hash-chained audit log")
    va.add_argument("path")

    vi = sub.add_parser("viability",
                        help="what funding the carry strategy would need to clear its gate")
    vi.add_argument("--hold", type=int, default=21,
                    help="holding period in funding intervals (default 21, seven days)")

    li2 = sub.add_parser("limits", help="print the limits in force and where they came from")
    li2.add_argument("--path", help="load this file instead of searching")
    li2.add_argument("--export", metavar="PATH",
                     help="write an editable limit register to PATH")

    do = sub.add_parser("doctor", help="preflight: everything that must be true before connecting")
    do.add_argument("--network", action="store_true",
                    help="also check the venue is reachable and the clock is close")
    do.add_argument("--production", action="store_true",
                    help="check production endpoints rather than testnet")

    li = sub.add_parser("live", help="connect to Binance (testnet + shadow by default)")
    li.add_argument("--mode", default="shadow",
                    choices=["read_only", "shadow", "paper", "live"],
                    help="SPEC 17.5 rollout step; default shadow, which sends nothing")
    li.add_argument("--production", action="store_true",
                    help="use production endpoints instead of testnet")
    li.add_argument("--confirm-live", action="store_true",
                    help="required alongside --mode live --production")
    li.add_argument("--symbols", default="BTCUSDT", help="comma separated")
    li.add_argument("--futures", action="store_true",
                    help="USD-M futures (carries funding; spot does not)")
    li.add_argument("--equity", default="10000", help="starting equity for the limits")
    li.add_argument("--notional", default="200", help="base notional per signal")
    li.add_argument("--operator", help="acknowledge a startup discrepancy as this person")
    li.add_argument("--max-messages", type=int, default=0,
                    help="stop after this many stream messages")
    li.add_argument("--dry-run", action="store_true",
                    help="print the wiring and exit without connecting")

    args = parser.parse_args(argv)
    return {"selfcheck": cmd_selfcheck, "demo": cmd_demo, "chaos": cmd_chaos,
            "session": cmd_session, "validate": cmd_validate,
            "verify-audit": cmd_verify_audit, "live": cmd_live,
            "viability": cmd_viability, "limits": cmd_limits,
            "doctor": cmd_doctor}[args.command](args)


if __name__ == "__main__":
    raise SystemExit(main())
