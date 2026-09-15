"""L3 - signal generation, per strategy.

A strategy is a pure function of :class:`FeatureSnapshot` to
:class:`Signal` or ``None``. No venue access, no order placement, no risk
decisions, no direct state mutation.

This package **may not import** :mod:`tradesys.adapters`: strategies cannot
reach a venue, and the rule is enforced in ``tests/test_import_graph.py``.
Strategy processes hold no credentials, so they physically cannot place an
order - which is how SPEC section 3.2 rule 1 stops being a promise.
"""

from .base import Strategy, StrategyState, StrategyHealth
from .funding_carry import FundingCarry, FundingCarryParams

__all__ = ["Strategy", "StrategyState", "StrategyHealth", "FundingCarry", "FundingCarryParams"]
