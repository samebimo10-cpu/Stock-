"""L2 - derived state, microstructure, regime.

Pure functions from L1 events to derived state. No I/O, no network, no clock
reads, no randomness. That is not a style preference: purity is what makes the
layer replayable, and replayability is what makes SPEC section 3.2 rule 2
testable.

This is also where look-ahead bias is introduced, so it is prevented
structurally here rather than reviewed for later (:mod:`.audit`).
"""

from .registry import feature, FeatureRegistry, REGISTRY, FeatureSpec
from .engine import FeatureEngine
from .audit import assert_causal, LookAheadError
from . import micro, derivs  # noqa: F401  - importing registers the features

__all__ = [
    "feature", "FeatureRegistry", "REGISTRY", "FeatureSpec",
    "FeatureEngine", "assert_causal", "LookAheadError",
]
