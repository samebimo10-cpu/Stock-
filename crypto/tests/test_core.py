"""Core types and identifiers."""

from __future__ import annotations

import pytest

from tradesys.core.ids import client_order_id, new_correlation_id
from tradesys.core.types import dec, floor_to, round_price_conservative


def test_decimal_refuses_floats():
    """A float in a quantity is a bug upstream; converting it would hide it."""
    with pytest.raises(TypeError, match="refusing to build a Decimal from float"):
        dec(0.1)


def test_decimal_accepts_strings_and_ints():
    assert dec("1.5") + dec(2) == dec("3.5")


@pytest.mark.parametrize("value,step,expected", [
    ("1.23456", "0.001", "1.234"),
    ("1.0", "0.1", "1.0"),
    ("0.999999", "0.00001", "0.99999"),
    ("100", "25", "100"),
])
def test_floor_to_always_rounds_down(value, step, expected):
    """Quantities round down. Rounding up would breach an approved limit."""
    assert floor_to(dec(value), dec(step)) == dec(expected)


def test_floor_to_rejects_non_positive_step():
    with pytest.raises(ValueError):
        floor_to(dec("1"), dec("0"))


def test_price_rounding_never_becomes_more_aggressive():
    """Buys round down, sells round up, so rounding cannot cross a spread."""
    assert round_price_conservative(dec("100.7"), dec("0.5"), "buy") == dec("100.5")
    assert round_price_conservative(dec("100.7"), dec("0.5"), "sell") == dec("101.0")


def test_client_order_id_is_deterministic():
    """The defence against double fills: a retry regenerates the same ID.

    A crash between sending an order and recording the send must not produce
    a second, different identifier - the venue can only refuse a duplicate it
    can recognise.
    """
    a = client_order_id("carry", "BTCUSDT", 7)
    b = client_order_id("carry", "BTCUSDT", 7)
    assert a == b
    assert a != client_order_id("carry", "BTCUSDT", 8)
    assert a != client_order_id("other", "BTCUSDT", 7)


def test_client_order_id_fits_venue_limits():
    """Binance allows 36 characters for newClientOrderId."""
    assert len(client_order_id("a_long_strategy_name", "BTCUSDT", 999999)) <= 36


def test_correlation_ids_sort_in_creation_order():
    """Audit records sort into causal order without a join on timestamps."""
    ids = [new_correlation_id(1_700_000_000_000_000_000) for _ in range(50)]
    assert ids == sorted(ids)
    assert len(set(ids)) == 50
