"""The risk service: ordered checks, invariants, and the limits that bite."""

from __future__ import annotations

import pytest
from hypothesis import given, settings, strategies as hs

from tradesys.core.events import OrderIntent, Position
from tradesys.core.types import dec
from tradesys.layers.l5_risk.killswitch import KillSwitch, SwitchState, Trigger, RECOVERY
from tradesys.layers.l5_risk.limits import LimitError, LimitRegister
from tradesys.layers.l5_risk.service import CHECKS, RiskContext, RiskService
from tradesys.layers.l5_risk.state import PortfolioState

NOW = 1_700_000_000_000_000_000


def intent(qty="0.01", symbol="BTCUSDT", price="60000", strategy="carry", **kw):
    return OrderIntent(
        correlation_id="c", emitted_at=NOW, source="t",
        client_order_id=kw.pop("coid", "ts_test"), venue="sim", symbol=symbol,
        side=kw.pop("side", "buy"), quantity=dec(qty), order_type="limit",
        price=dec(price), strategy_id=strategy, **kw,
    )


def ctx(**kw):
    base = dict(now=NOW, feed_last_event={"BTCUSDT": NOW, "ETHUSDT": NOW},
                reconciliation_clean=True, mark_prices={"BTCUSDT": dec("60000"),
                                                        "ETHUSDT": dec("3000")})
    base.update(kw)
    return RiskContext(**base)


# ---------------------------------------------------------------- config


def test_fat_finger_config_fails_to_load(limits):
    """A misplaced decimal must fail at LOAD, not at the first fill."""
    import yaml
    from pathlib import Path

    payload = yaml.safe_load((Path(__file__).resolve().parents[1] / "risk" / "limits.yaml").read_text())
    payload["limits"]["per_trade_risk"]["value"] = 0.2      # 20%, not 2%
    with pytest.raises(LimitError, match="outside its declared bounds"):
        LimitRegister.from_mapping(payload)


def test_limit_without_bounds_is_refused():
    with pytest.raises(LimitError, match="no declared bounds"):
        LimitRegister.from_mapping({"limits": {"x": {"value": 1}}, "bounds": {}})


def test_drawdown_ladder_must_be_ordered():
    """The v1.0 defect: a hard stop below the soft trigger cannot be loaded.

    v1.0 of the specification set a 15% kill limit under a 20% tolerance,
    leaving no room between acceptable and dead. Encoding the ordering here
    means the mistake cannot be reintroduced by a config edit.
    """
    import yaml
    from pathlib import Path

    payload = yaml.safe_load((Path(__file__).resolve().parents[1] / "risk" / "limits.yaml").read_text())
    payload["limits"]["drawdown_hard"]["value"] = 0.05
    with pytest.raises(LimitError, match="ordered amber < soft < hard"):
        LimitRegister.from_mapping(payload)


def test_daily_loss_must_fire_before_the_full_stop():
    import yaml
    from pathlib import Path

    payload = yaml.safe_load((Path(__file__).resolve().parents[1] / "risk" / "limits.yaml").read_text())
    payload["limits"]["daily_loss"]["value"] = 0.10
    payload["limits"]["weekly_loss"]["value"] = 0.10
    payload["limits"]["drawdown_hard"]["value"] = 0.09
    with pytest.raises(LimitError, match="not below drawdown_hard"):
        LimitRegister.from_mapping(payload)


# ---------------------------------------------------------------- checks


def test_happy_path_approves(risk):
    d = risk.evaluate(intent(), ctx())
    assert d.approved, d.rejected_by
    assert d.adjusted_quantity == dec("0.01")


def test_check_order_kill_switch_first(risk):
    """The cheapest check runs first, and it blocks everything."""
    risk.killswitch.engage(Trigger.DRAWDOWN_HARD, NOW, "test")
    d = risk.evaluate(intent(), ctx(reconciliation_clean=False))
    assert not d.approved
    assert d.rejected_by.startswith(CHECKS[0])       # not the reconciliation check


def test_reduce_only_survives_a_flatten(risk):
    """A flatten is executed by orders, so those orders must get through."""
    risk.killswitch.engage(Trigger.DAILY_LOSS, NOW, "test")
    assert risk.killswitch.state == SwitchState.FLATTENING
    d = risk.evaluate(intent(reduce_only=True), ctx())
    assert d.approved


def test_unknown_symbol_has_no_feed_and_is_rejected(risk):
    d = risk.evaluate(intent(symbol="ETHUSDT"), ctx(feed_last_event={"BTCUSDT": NOW}))
    assert not d.approved and "no feed" in d.rejected_by


def test_stale_feed_is_rejected(risk):
    stale = NOW - 60 * 1_000_000_000
    d = risk.evaluate(intent(), ctx(feed_last_event={"BTCUSDT": stale}))
    assert not d.approved and CHECKS[3] in d.rejected_by


def test_reconciliation_not_clean_blocks_trading(risk):
    d = risk.evaluate(intent(), ctx(reconciliation_clean=False))
    assert not d.approved and CHECKS[2] in d.rejected_by


def test_oversized_order_is_rejected(risk):
    """Single-order notional: the fat-finger guard at order time."""
    d = risk.evaluate(intent(qty="5"), ctx())           # 5 BTC = $300k on $100k
    assert not d.approved and CHECKS[5] in d.rejected_by


def test_per_trade_risk_cap(risk):
    """2% of equity, and with no declared stop the whole notional is at risk."""
    risk.state.median_order_notional = dec("1000000")   # defuse the notional cap
    d = risk.evaluate(intent(qty="0.1"), ctx())         # $6,000 on $100k = 6%
    assert not d.approved and CHECKS[6] in d.rejected_by


def test_declared_stop_permits_a_larger_position(risk):
    """A strategy with a 10% stop risks a tenth of its notional."""
    risk.state.median_order_notional = dec("1000000")
    c = ctx(stop_distance_frac={"carry": dec("0.1")})
    d = risk.evaluate(intent(qty="0.03"), c)            # $1,800 notional, $180 at risk
    assert d.approved, d.rejected_by


def test_daily_loss_halts_and_engages_the_switch(risk):
    risk.state.day_start_equity = dec("100000")
    risk.state.cash = dec("96000")                      # 4% down, limit is 3%
    d = risk.evaluate(intent(), ctx())
    assert not d.approved and CHECKS[12] in d.rejected_by
    assert Trigger.DAILY_LOSS in risk.killswitch.engaged


def test_rate_pressure_throttles_rather_than_rejects(risk):
    """Check 11 queues. Rejecting would silently drop intent the strategy sent."""
    from tradesys.adapters.base import RateLimitState

    d = risk.evaluate(intent(), ctx(rate_limit=RateLimitState(5500, 6000)))
    assert d.approved
    assert d.throttle


def test_consecutive_rejects_disable_a_strategy(risk):
    c = ctx(reconciliation_clean=False)
    for _ in range(5):
        risk.evaluate(intent(), c)
    assert "carry" in risk.state.disabled_strategies
    d = risk.evaluate(intent(), ctx())
    assert not d.approved and CHECKS[1] in d.rejected_by


def test_liquidation_distance_blocks_increases_but_not_reductions(risk):
    st = risk.state
    st.positions[("sim", "BTCUSDT")] = Position("sim", "BTCUSDT", dec("0.02"), dec("60000"), dec("60000"))
    c = ctx(liquidation_distance={("sim", "BTCUSDT"): dec("0.10")})
    assert not risk.evaluate(intent(qty="0.005", side="buy"), c).approved
    assert risk.evaluate(intent(qty="0.005", side="sell"), c).approved


# ------------------------------------------------------------ invariants


def test_risk_never_enlarges_an_order(risk):
    """The invariant. Risk reduces or refuses."""
    st = risk.state
    st.median_order_notional = dec("1000000")
    for qty in ("0.001", "0.01", "0.02", "0.05", "0.2", "1"):
        d = risk.evaluate(intent(qty=qty), ctx())
        if d.approved:
            assert d.adjusted_quantity <= dec(qty)


@settings(max_examples=150, deadline=None)
@given(
    qty=hs.decimals(min_value=1, max_value=10_000, places=0),
    equity=hs.integers(min_value=1_000, max_value=10_000_000),
)
def test_property_approval_is_never_larger_than_requested(qty, equity):
    from pathlib import Path

    limits = LimitRegister.from_yaml(Path(__file__).resolve().parents[1] / "risk" / "limits.yaml")
    st = PortfolioState(cash=dec(str(equity)))
    st.median_order_notional = dec("1000")
    st.mark()
    svc = RiskService(limits, st)
    quantity = dec(str(qty)) / dec("100000")
    d = svc.evaluate(intent(qty=str(quantity)), ctx())
    if d.approved:
        assert d.adjusted_quantity is not None
        assert d.adjusted_quantity <= quantity


def test_no_decision_is_not_an_approval():
    """Enforced on the consuming side; see test_execution.py.

    Stated here too because it is a risk-layer guarantee: the absence of a
    RiskDecision must never be read as permission.
    """
    from tradesys.core.events import RiskDecision

    blank = RiskDecision(correlation_id="c", emitted_at=NOW, source="l5_risk")
    assert blank.approved is False                   # the default is refusal
    assert blank.adjusted_quantity is None


# ----------------------------------------------------------- kill switch


def test_every_trigger_has_a_recovery_path():
    """A kill switch with no defined way back gets bypassed rather than reset."""
    for attr, name in vars(Trigger).items():
        if attr.startswith("_") or not isinstance(name, str):
            continue
        assert name in RECOVERY, f"trigger {name} has no recovery path"


def test_automatic_recovery_needs_the_settle_period():
    ks = KillSwitch()
    ks.engage(Trigger.FEED_STALENESS, NOW, "stale")
    assert not ks.try_clear(Trigger.FEED_STALENESS, NOW)        # condition still true
    ks.condition_cleared(Trigger.FEED_STALENESS, NOW)
    assert not ks.try_clear(Trigger.FEED_STALENESS, NOW + 60 * 10**9)   # too soon
    assert ks.try_clear(Trigger.FEED_STALENESS, NOW + 301 * 10**9)
    assert not ks.is_engaged


def test_reconciliation_mismatch_needs_a_human():
    """Auto-recovery here would mean trading while not knowing what we hold."""
    ks = KillSwitch()
    ks.engage(Trigger.RECONCILE_MISMATCH, NOW, "mismatch")
    ks.condition_cleared(Trigger.RECONCILE_MISMATCH, NOW)
    assert not ks.try_clear(Trigger.RECONCILE_MISMATCH, NOW + 10**12)
    ks.approve(Trigger.RECONCILE_MISMATCH, "operator-a")
    assert ks.try_clear(Trigger.RECONCILE_MISMATCH, NOW + 10**12)


def test_hard_drawdown_needs_two_distinct_people():
    ks = KillSwitch()
    ks.engage(Trigger.DRAWDOWN_HARD, NOW, "12%")
    ks.condition_cleared(Trigger.DRAWDOWN_HARD, NOW)
    ks.approve(Trigger.DRAWDOWN_HARD, "operator-a")
    ks.approve(Trigger.DRAWDOWN_HARD, "operator-a")          # same person twice
    assert not ks.try_clear(Trigger.DRAWDOWN_HARD, NOW)
    ks.approve(Trigger.DRAWDOWN_HARD, "operator-b")
    assert ks.try_clear(Trigger.DRAWDOWN_HARD, NOW)


def test_deadman_fires_on_a_missed_heartbeat():
    ks = KillSwitch()
    ks.heartbeat(NOW)
    assert not ks.check_deadman(NOW + 5 * 10**9)
    assert ks.check_deadman(NOW + 11 * 10**9)
    assert ks.must_flatten


def test_state_is_derived_from_the_worst_trigger():
    """Two triggers cannot leave the system in the milder of the two states."""
    ks = KillSwitch()
    ks.engage(Trigger.FEED_STALENESS, NOW, "")
    assert ks.state == SwitchState.HALTED
    ks.engage(Trigger.DRAWDOWN_HARD, NOW, "")
    assert ks.state == SwitchState.FLATTENING


# ---------------------------------------------------------------- ladder


def test_drawdown_ladder_escalates(risk):
    st = risk.state
    st.peak_equity = dec("100000")
    st.cash = dec("93000")                       # 7% -> amber
    assert risk.check_drawdown_ladder(NOW) == "drawdown_amber"
    st.cash = dec("91000")                       # 9% -> soft
    assert risk.check_drawdown_ladder(NOW) == Trigger.DRAWDOWN_SOFT
    assert risk.allocation_multiplier() == dec("0.5")
    st.cash = dec("87000")                       # 13% -> hard
    assert risk.check_drawdown_ladder(NOW) == Trigger.DRAWDOWN_HARD


# ----------------------------------------------------------------- state


def test_state_survives_a_restart(tmp_path):
    """A risk service that forgets today's losses converts a restart into a bypass."""
    st = PortfolioState(cash=dec("100000"))
    st.mark()
    st.day_start_equity = dec("100000")
    st.cash = dec("98000")
    st.disabled_strategies.add("bad_strategy")
    path = tmp_path / "state.json"
    st.save(path)

    restored = PortfolioState.load(path)
    assert restored.daily_loss == st.daily_loss
    assert restored.peak_equity == dec("100000")
    assert "bad_strategy" in restored.disabled_strategies
