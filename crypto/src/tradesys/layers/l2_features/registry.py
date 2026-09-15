"""Feature registration and versioning.

Every feature declares its lookback and its lag, and carries a content hash of
its own source (SPEC section 5.3). Changing the computation creates a new
version; it never silently changes history. A backtest records which feature
versions it used, so a result can be reproduced two years later rather than
merely re-run.
"""

from __future__ import annotations

import hashlib
import inspect
import textwrap
from dataclasses import dataclass
from typing import Callable, Dict, Optional

__all__ = ["FeatureSpec", "FeatureRegistry", "REGISTRY", "feature"]


@dataclass(frozen=True)
class FeatureSpec:
    name: str
    fn: Callable
    #: How many input events the feature needs before it produces a value.
    lookback: int
    #: Events of delay between an input and its use. Zero means the feature may
    #: be used for a decision stamped at the same timestamp as its last input;
    #: anything reading a *completed* bar must declare lag >= 1.
    lag: int
    version: str
    doc: str = ""

    @property
    def qualified(self) -> str:
        return f"{self.name}@{self.version}"


class FeatureRegistry:
    def __init__(self) -> None:
        self._specs: Dict[str, FeatureSpec] = {}

    def register(self, spec: FeatureSpec) -> None:
        existing = self._specs.get(spec.name)
        if existing is not None and existing.version != spec.version:
            raise ValueError(
                f"feature {spec.name} already registered at version {existing.version}; "
                "changing a computation requires a new name or an explicit version bump"
            )
        self._specs[spec.name] = spec

    def get(self, name: str) -> FeatureSpec:
        return self._specs[name]

    def names(self):
        return sorted(self._specs)

    def all(self):
        return [self._specs[n] for n in self.names()]

    def versions(self) -> Dict[str, str]:
        return {n: self._specs[n].version for n in self.names()}


REGISTRY = FeatureRegistry()


def _content_hash(fn: Callable) -> str:
    """Hash the function's own source.

    Source rather than bytecode: bytecode varies across Python versions, and a
    version string that changes when you upgrade the interpreter would
    invalidate every historical backtest for no reason.
    """
    src = textwrap.dedent(inspect.getsource(fn))
    return hashlib.blake2b(src.encode(), digest_size=6).hexdigest()


def feature(name: str, *, lookback: int = 1, lag: int = 0, registry: Optional[FeatureRegistry] = None):
    """Register a pure feature function.

    >>> @feature("double", lookback=1)
    ... def _double(values):
    ...     return values[-1] * 2
    >>> REGISTRY.get("double").lookback
    1
    """

    def decorator(fn: Callable) -> Callable:
        spec = FeatureSpec(
            name=name,
            fn=fn,
            lookback=lookback,
            lag=lag,
            version=_content_hash(fn),
            doc=(fn.__doc__ or "").strip().splitlines()[0] if fn.__doc__ else "",
        )
        (registry or REGISTRY).register(spec)
        fn.spec = spec  # type: ignore[attr-defined]
        return fn

    return decorator
