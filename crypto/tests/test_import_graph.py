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


#: Modules allowed to open a network connection. Everything else in the package
#: reaches a venue through an injected transport or adapter, which is what makes
#: the whole system testable offline - and testable offline is the only way the
#: failure paths get tested at all.
NETWORK_ALLOWED = {
    "live/websocket.py",        # the socket itself
    "adapters/binance.py",      # UrllibTransport, the default injected one
    "adapters/bybit.py",
}

NETWORK_MODULES = ("socket", "ssl", "urllib.request", "http.client",
                   "asyncio.open_connection")


@pytest.mark.parametrize(
    "path", [p for p in SRC.rglob("*.py")], ids=lambda p: str(p.name))
def test_only_the_connection_modules_touch_the_network(path):
    relative = path.relative_to(SRC).as_posix()
    if relative in NETWORK_ALLOWED:
        return
    offending = [i for i in _imports(path)
                 if any(i == m or i.startswith(m + ".") for m in NETWORK_MODULES)]
    assert not offending, (
        f"{relative} imports {offending}. Network access belongs behind an "
        f"injected transport; only {sorted(NETWORK_ALLOWED)} may open a "
        "connection, or the failure paths stop being testable offline."
    )


@pytest.mark.parametrize("path", _modules_under("layers"), ids=lambda p: p.name)
def test_no_layer_imports_the_live_package(path):
    """The layers do not know live connectivity exists.

    ``live`` depends on the layers; nothing depends on ``live``. The moment that
    reverses, running a backtest starts requiring a venue to be reachable.
    """
    offending = [i for i in _imports(path) if i.startswith("tradesys.live")
                 or i == "live" or i.startswith("live.")]
    assert not offending, f"{path.relative_to(SRC)} imports {offending}"
