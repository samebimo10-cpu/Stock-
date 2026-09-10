import pytest

from stockselector.config import FACTORS, GoalProfile, Objective


def test_factor_weights_sum_to_one_for_every_objective():
    for obj in Objective:
        w = GoalProfile(objective=obj).factor_weights
        assert set(w) == set(FACTORS)
        assert abs(sum(w.values()) - 1) < 1e-9


def test_overrides_are_renormalised():
    p = GoalProfile(objective="growth", factor_weight_overrides={"momentum": 0.9})
    assert abs(sum(p.factor_weights.values()) - 1) < 1e-9
    assert p.factor_weights["momentum"] > 0.5


def test_required_return():
    p = GoalProfile(budget=100, target_amount=200, horizon_years=5)
    assert abs(p.required_return - (2 ** 0.2 - 1)) < 1e-9
    assert GoalProfile(budget=100, target_amount=50).required_return is None


def test_validation():
    with pytest.raises(ValueError):
        GoalProfile(ngx_weight_range=(0.8, 0.2))
    with pytest.raises(ValueError):
        GoalProfile(budget=0)
    assert GoalProfile(risk_tolerance=9).risk_tolerance == 5


def test_yaml_roundtrip(tmp_path):
    p = GoalProfile(objective="income", ngx_weight_range=(0.1, 0.4), target_income_yield=0.05)
    path = tmp_path / "g.yaml"
    p.to_yaml(path)
    q = GoalProfile.from_yaml(path)
    assert q.objective == Objective.INCOME
    assert q.ngx_weight_range == (0.1, 0.4)
    assert q.target_income_yield == 0.05
