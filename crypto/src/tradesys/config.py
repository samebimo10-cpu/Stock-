"""Where the running system gets its configuration, and how to find out.

One question has to be answerable in one command, instantly, by somebody who
did not deploy this: **which limits are actually in force right now?** A system
that silently falls back to a built-in default when a file is missing will
happily trade all week on limits nobody chose, and the first sign of it is a
position larger than anyone expected.

So the search order is explicit, it is reported rather than assumed, and
``tradesys limits`` prints both the values and the file they came from.

Search order, first hit wins:

1. An explicit path passed by the caller.
2. ``$TRADESYS_LIMITS``. The deployment's answer.
3. ``./risk/limits.yaml`` relative to the working directory.
4. ``risk/limits.yaml`` in the repository checkout, if this is one.
5. The built-in register below.

Step 5 is a real fallback, not a placeholder: an installed package has no
repository to read from, and refusing to start would be worse. It carries the
same values as the repository file - and a test asserts they cannot drift,
because two copies of a limit register that disagree is exactly the failure
this fallback would otherwise introduce.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, Optional

from .layers.l5_risk.limits import LimitRegister

__all__ = ["LIMITS_ENV", "LimitsSource", "find_limits", "load_limits",
           "BUILT_IN_LIMITS", "export_limits"]

LIMITS_ENV = "TRADESYS_LIMITS"


@dataclass(frozen=True)
class LimitsSource:
    """Where a limit register came from, so it can be printed rather than guessed."""

    path: Optional[Path]
    how: str

    @property
    def is_built_in(self) -> bool:
        return self.path is None

    def __str__(self) -> str:
        return f"{self.path}  ({self.how})" if self.path else f"built-in ({self.how})"


#: The values as committed. Kept in sync with ``risk/limits.yaml`` by a test -
#: see ``tests/test_risk.py`` - because a fallback that has drifted from the
#: file it mirrors is worse than no fallback: it starts, it looks right, and it
#: enforces something nobody agreed to.
BUILT_IN_LIMITS: Dict[str, Any] = {
    "schema_version": 1,
    "equity_definition": "cash_plus_unrealised_plus_accrued",
    "limits": {
        "per_trade_risk": {"value": 0.02, "action": "reject"},
        "daily_loss": {"value": 0.03, "action": "flatten_and_halt"},
        "weekly_loss": {"value": 0.07, "action": "flatten_and_halt"},
        "drawdown_amber": {"value": 0.06, "action": "alert"},
        "drawdown_soft": {"value": 0.08, "action": "halve_allocations"},
        "drawdown_hard": {"value": 0.12, "action": "full_stop"},
        "gross_exposure": {"value": 3.0, "action": "reject_new"},
        "asset_concentration": {"value": 0.25, "action": "reject"},
        "venue_concentration": {"value": 0.40, "action": "alert_and_sweep"},
        "liquidation_distance": {"value": 0.25, "action": "auto_deleverage"},
        "single_order_equity_frac": {"value": 0.02, "action": "reject"},
        "single_order_median_mult": {"value": 5.0, "action": "reject"},
        "order_rate": {"value": 0.7, "action": "throttle"},
        "consecutive_rejects": {"value": 5, "action": "disable_strategy"},
        "backtest_divergence_z": {"value": -2.0, "action": "disable_strategy"},
        "feed_staleness_s": {"value": 30.0, "action": "reject"},
        "clock_drift_ms": {"value": 100.0, "action": "halt"},
    },
    "bounds": {
        "per_trade_risk": [0.0001, 0.05], "daily_loss": [0.005, 0.10],
        "weekly_loss": [0.01, 0.20], "drawdown_amber": [0.01, 0.20],
        "drawdown_soft": [0.02, 0.20], "drawdown_hard": [0.05, 0.25],
        "gross_exposure": [1.0, 5.0], "asset_concentration": [0.05, 1.0],
        "venue_concentration": [0.10, 1.0], "liquidation_distance": [0.05, 0.90],
        "single_order_equity_frac": [0.0001, 0.10], "single_order_median_mult": [1.0, 50.0],
        "order_rate": [0.1, 0.95], "consecutive_rejects": [1, 50],
        "backtest_divergence_z": [-5.0, -1.0], "feed_staleness_s": [1.0, 300.0],
        "clock_drift_ms": [10.0, 1000.0],
    },
}


def repository_limits() -> Optional[Path]:
    """``risk/limits.yaml`` in the checkout, if this is running from one."""
    candidate = Path(__file__).resolve().parents[2] / "risk" / "limits.yaml"
    return candidate if candidate.exists() else None


def find_limits(path: Optional[str | Path] = None) -> LimitsSource:
    """Resolve where limits will be read from, without reading them.

    Separate from :func:`load_limits` so a preflight check can report the
    answer without the side effect of loading - and so the answer is the same
    one the loader will get, rather than a second implementation of the search
    that can disagree with it.
    """
    if path:
        resolved = Path(path).expanduser()
        if not resolved.exists():
            raise FileNotFoundError(f"limits file not found: {resolved}")
        return LimitsSource(resolved, "explicit path")

    env = os.environ.get(LIMITS_ENV, "")
    if env:
        resolved = Path(env).expanduser()
        if not resolved.exists():
            # Refuse rather than fall through. Somebody set this on purpose;
            # silently using different limits than the ones they pointed at is
            # the worst possible response to a typo.
            raise FileNotFoundError(
                f"{LIMITS_ENV}={env!r} does not exist. Refusing to fall back to "
                "different limits than the ones you named."
            )
        return LimitsSource(resolved, f"${LIMITS_ENV}")

    local = Path.cwd() / "risk" / "limits.yaml"
    if local.exists():
        return LimitsSource(local, "./risk/limits.yaml")

    repo = repository_limits()
    if repo is not None:
        return LimitsSource(repo, "repository checkout")

    return LimitsSource(None, "no limits file found")


def load_limits(path: Optional[str | Path] = None) -> LimitRegister:
    """The limit register the system will actually enforce.

    >>> load_limits().get("drawdown_hard")
    Decimal('0.12')
    """
    source = find_limits(path)
    if source.path is None:
        return LimitRegister.from_mapping(BUILT_IN_LIMITS)
    return LimitRegister.from_yaml(source.path)


def export_limits(destination: str | Path) -> Path:
    """Write the built-in register to a file an operator can edit.

    An installed package has no repository file to copy, so without this the
    only way to change a limit is to edit site-packages - which is untracked,
    unreviewable, and lost on the next upgrade.

    Refuses to overwrite. Limits are the thing you least want silently
    replaced, and a clobbered file with local edits in it is unrecoverable.
    """
    target = Path(destination).expanduser()
    if target.exists():
        raise FileExistsError(
            f"{target} already exists. Refusing to overwrite a limit register - "
            "move it aside yourself if that is really what you want."
        )
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(_as_yaml(BUILT_IN_LIMITS), encoding="utf-8")
    return target


def _as_yaml(payload: Dict[str, Any]) -> str:
    """Render the register as YAML, with the comments that make it reviewable.

    Hand-rolled rather than ``yaml.dump`` because a dumped mapping loses every
    comment, and a limit register without the note explaining why a number is
    that number is a file people edit confidently and wrongly.
    """
    lines = [
        "# Risk limits. Every value is enforced, and every value has bounds:",
        "# a limit outside its bounds refuses to load rather than warning,",
        "# because a fat-fingered 20 where 2 was meant is exactly the change",
        "# that gets made at 3am and exactly the one nobody reviews.",
        "#",
        "# Production changes need two signers, or one signer and a 24-hour",
        "# delay (SPEC section 13.2). The delay is not bureaucracy: it prevents",
        "# a bad decision made in the middle of the incident that prompted it.",
        "#",
        f"# Exported by `tradesys limits --export`. Point {LIMITS_ENV} at it.",
        "",
        f"schema_version: {payload['schema_version']}",
        f"equity_definition: {payload['equity_definition']}",
        "",
        "limits:",
    ]
    for name, spec in payload["limits"].items():
        lines.append(f"  {name}:")
        lines.append(f"    value: {spec['value']}")
        lines.append(f"    action: {spec['action']}")
    lines.append("")
    lines.append("# Refuse to load outside these. The register validates itself.")
    lines.append("bounds:")
    for name, (low, high) in payload["bounds"].items():
        lines.append(f"  {name}: [{low}, {high}]")
    lines.append("")
    return "\n".join(lines)
