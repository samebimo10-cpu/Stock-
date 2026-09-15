"""SPEC section 3.5 import rules, enforced.

These two rules are how "risk is a separate service" stops being a diagram and
becomes a property of the code. A strategy that *can* reach a venue will
eventually reach one.
"""

from __future__ import annotations

import ast
from pathlib import Path

import pytest

SRC = Path(__file__).resolve().parents[1] / "src" / "tradesys"


def _imports(path: Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    found = []
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            found.extend(a.name for a in node.names)
        elif isinstance(node, ast.ImportFrom):
            # Resolve relative imports to a dotted path under tradesys.
            if node.level:
                parts = path.relative_to(SRC).parts[:-1]
                base = list(parts[: len(parts) - (node.level - 1)]) if node.level > 1 else list(parts)
                found.append(".".join(["tradesys"] + base + ([node.module] if node.module else [])))
            elif node.module:
                found.append(node.module)
    return found


def _modules_under(package: str):
    return sorted((SRC / package.replace(".", "/")).rglob("*.py"))


@pytest.mark.parametrize("path", _modules_under("layers/l3_strategy"), ids=lambda p: p.name)
def test_strategies_cannot_reach_a_venue(path):
    """l3_strategy may not import adapters.

    Strategy processes hold no venue credentials, so they physically cannot
    place an order. This test is the code-level half of that guarantee.
    """
    offending = [i for i in _imports(path) if "adapters" in i]
    assert not offending, (
        f"{path.relative_to(SRC)} imports {offending}. Strategies must not be able "
        "to reach a venue (SPEC section 3.5)."
    )


@pytest.mark.parametrize("path", _modules_under("layers/l5_risk"), ids=lambda p: p.name)
def test_risk_does_not_depend_on_strategies(path):
    """l5_risk may not import l3_strategy.

    Risk cannot be made to depend on what a strategy wants. This is the
    code-level expression of SPEC section 3.2 rule 1.
    """
    offending = [i for i in _imports(path) if "l3_strategy" in i]
    assert not offending, (
        f"{path.relative_to(SRC)} imports {offending}. Risk must not depend on "
        "the strategy layer (SPEC section 3.5)."
    )


def test_every_layer_package_exists():
    """The seven layers of SPEC section 3.1 all have a home."""
    for layer in ("l1_data", "l2_features", "l3_strategy", "l4_portfolio",
                  "l5_risk", "l6_execution", "l7_observability"):
        assert (SRC / "layers" / layer / "__init__.py").exists(), f"missing layer {layer}"
