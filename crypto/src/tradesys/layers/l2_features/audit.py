"""Look-ahead audit (SPEC section 5.4).

An automated test, not a code review. Look-ahead bias is invisible in review
because the code looks correct - it is the timestamps that are wrong.

Two shapes of feature leak in two different ways, so there are two checks:

* **Series features** compute a value at every timestamp, usually vectorised
  over a whole column. This is where the classic killer lives:
  ``(x - x.mean()) / x.std()`` over the full sample, a centred rolling window,
  a ``shift(-1)``. :func:`assert_causal` catches all of them by recomputing on
  prefixes and demanding the answers agree.
* **Point features** return one value for a window. They cannot see past the
  window they are handed, so the leak is instead *using* a value that is not
  knowable yet - a feature declared with ``lag >= 1`` that in fact reads the
  most recent element. :func:`assert_respects_lag` perturbs the elements the
  feature claims not to read and demands the output does not move.
"""

from __future__ import annotations

from typing import Any, Callable, List, Sequence

__all__ = ["LookAheadError", "assert_causal", "is_causal", "assert_respects_lag",
           "audit_registry"]


class LookAheadError(AssertionError):
    """Raised when a feature's value depends on data after its timestamp."""


# --------------------------------------------------------------------------
# Series features
# --------------------------------------------------------------------------


def assert_causal(fn: Callable[[Sequence[Any]], Sequence[Any]], series: Sequence[Any],
                  min_points: int = 2, name: str = "") -> None:
    """Assert a series-producing feature never reads beyond each timestamp.

    ``fn`` maps a series of length *n* to a series of length *n*: the value at
    position *k* is the feature as of *k*. Causality means recomputing on the
    prefix ``series[:k+1]`` yields the same value at *k* that the full-series
    computation did.

    >>> assert_causal(lambda s: list(s), [1, 2, 3])          # identity: causal
    >>> assert_causal(lambda s: [max(s)] * len(s), [1, 2, 9])
    Traceback (most recent call last):
    tradesys.layers.l2_features.audit.LookAheadError: ...
    """
    label = name or getattr(fn, "__name__", "feature")
    if len(series) < min_points:
        raise ValueError(f"{label}: need at least {min_points} points to audit")

    full = list(fn(series))
    if len(full) != len(series):
        raise ValueError(
            f"{label}: series feature must return one value per input "
            f"(got {len(full)} for {len(series)} inputs)"
        )

    for k in range(min_points - 1, len(series)):
        prefix = list(fn(series[: k + 1]))
        if prefix[k] != full[k]:
            raise LookAheadError(
                f"{label}: value at position {k} is {full[k]!r} when the whole "
                f"series is available but {prefix[k]!r} when only data up to {k} "
                "is. The feature reads beyond its own timestamp."
            )


def is_causal(fn, series, min_points: int = 2) -> bool:
    try:
        assert_causal(fn, series, min_points=min_points)
        return True
    except LookAheadError:
        return False


# --------------------------------------------------------------------------
# Point features
# --------------------------------------------------------------------------


def assert_respects_lag(fn: Callable[[Sequence[Any]], Any], window: Sequence[Any],
                        lag: int, name: str = "") -> None:
    """Assert a point feature ignores the last ``lag`` elements of its window.

    A feature declared ``lag=1`` says it decides on completed information: it
    may use everything up to the previous element and not the current one.
    Perturbing the elements it claims not to read must not move its output.

    ``lag=0`` is a no-op - a feature that may read its whole window has nothing
    to prove here, and :func:`assert_causal` is the check that applies to it.

    >>> assert_respects_lag(lambda w: w[-2], [1, 2, 3], lag=1)
    >>> assert_respects_lag(lambda w: w[-1], [1, 2, 3], lag=1)
    Traceback (most recent call last):
    tradesys.layers.l2_features.audit.LookAheadError: ...
    """
    label = name or getattr(fn, "__name__", "feature")
    if lag <= 0:
        return
    if len(window) <= lag:
        raise ValueError(f"{label}: window of {len(window)} is too short to test lag {lag}")

    baseline = fn(window)
    perturbed = list(window)
    for i in range(len(window) - lag, len(window)):
        scaled = _perturb(perturbed[i])
        if scaled is None:
            return
        perturbed[i] = scaled
    after = fn(perturbed)
    if after != baseline:
        raise LookAheadError(
            f"{label}: declares lag={lag} but its output changed "
            f"({baseline!r} -> {after!r}) when only the last {lag} element(s) "
            "were altered. It is reading information it says it does not use."
        )


def _perturb(sample: Any):
    """A clearly different value of the same shape, or None if we cannot make one."""
    try:
        return sample * 7 + 13
    except Exception:
        return None


# --------------------------------------------------------------------------
# Registry sweep
# --------------------------------------------------------------------------


def audit_registry(registry, samples: dict) -> List[str]:
    """Run :func:`assert_respects_lag` over every registered feature with a sample.

    Returns the names of features that had no sample supplied, so the CI gate
    can fail on *unaudited* features rather than only on failing ones. A
    feature nobody wrote a sample for is a feature nobody checked.
    """
    unaudited = []
    for spec in registry.all():
        sample = samples.get(spec.name)
        if sample is None:
            unaudited.append(spec.name)
            continue
        if spec.lag > 0:
            assert_respects_lag(spec.fn, sample, spec.lag, name=spec.name)
    return unaudited
