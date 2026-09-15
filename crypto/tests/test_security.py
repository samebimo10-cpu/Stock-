"""The signing service and log redaction (SPEC section 13.2)."""

from __future__ import annotations

import pytest

from tradesys.security import (
    FORBIDDEN_ENDPOINTS, SigningRefused, SigningService, redact, redact_mapping,
)


def service():
    s = SigningService()
    s.add_key("k1", "carry", "testnet", "supersecret", permissions=("spot",))
    return s


# --------------------------------------------------------------- signing


def test_an_ordinary_order_is_signed():
    signed = service().sign("carry", "testnet", "/api/v3/order", "symbol=BTCUSDT")
    assert signed.signature
    assert signed.key_id == "k1"


def test_the_same_payload_signs_identically():
    s = service()
    a = s.sign("carry", "testnet", "/api/v3/order", "x").signature
    b = s.sign("carry", "testnet", "/api/v3/order", "x").signature
    assert a == b


@pytest.mark.parametrize("endpoint", sorted(FORBIDDEN_ENDPOINTS))
def test_every_withdrawal_endpoint_is_refused(endpoint):
    """Refused at the signer regardless of what the key permits.

    Defence in depth against the one failure in the whole specification that is
    unrecoverable: a leaked key with withdrawal rights is a total loss.
    """
    with pytest.raises(SigningRefused, match="moves funds"):
        service().sign("carry", "testnet", endpoint, "x")


def test_an_unknown_withdrawal_shaped_endpoint_is_also_refused():
    """Venues add endpoints. An allowlist that only knows today's fails open."""
    with pytest.raises(SigningRefused):
        service().sign("carry", "testnet", "/sapi/v9/capital/withdraw/new-thing", "x")


def test_a_query_string_does_not_hide_a_withdrawal():
    with pytest.raises(SigningRefused):
        service().sign("carry", "testnet",
                       "/sapi/v1/capital/withdraw/apply?coin=BTC", "x")


def test_a_key_claiming_withdrawal_rights_is_refused_at_the_door():
    with pytest.raises(SigningRefused, match="withdrawals disabled"):
        SigningService().add_key("bad", "s", "testnet", "x",
                                 permissions=("spot", "withdraw"))


def test_keys_are_scoped_per_strategy_and_environment():
    """A fallback key would defeat both containment and attribution."""
    s = service()
    with pytest.raises(SigningRefused, match="no key for strategy"):
        s.sign("other_strategy", "testnet", "/api/v3/order", "x")
    with pytest.raises(SigningRefused, match="no key for strategy"):
        s.sign("carry", "production", "/api/v3/order", "x")


def test_a_revoked_key_cannot_sign():
    s = service()
    s.revoke("k1")
    with pytest.raises(SigningRefused, match="revoked"):
        s.sign("carry", "testnet", "/api/v3/order", "x")


def test_every_refusal_is_logged():
    """A refused withdrawal attempt is the most interesting line in the log."""
    s = service()
    for endpoint in ("/sapi/v1/capital/withdraw/apply", "/v5/asset/withdraw/create"):
        with pytest.raises(SigningRefused):
            s.sign("carry", "testnet", endpoint, "x")
    assert len(s.refusals) == 2
    assert all(row["reason"] == "endpoint moves funds" for row in s.refusals)


def test_the_secret_never_appears_in_a_repr():
    record = service()._keys["k1"]
    assert "supersecret" not in repr(record)
    assert "supersecret" not in str(record)


def test_the_scoped_signer_exposes_only_signing():
    """The adapter gets something that can sign and nothing that can be read."""
    signer = service().as_signer("carry", "testnet", "/api/v3/order")
    assert signer.sign("payload")
    assert not hasattr(signer, "_secret")


def test_rotation_refreshes_the_age():
    clock = {"t": 0.0}
    s = SigningService(rotation_days=90, clock=lambda: clock["t"])
    s.add_key("k", "carry", "testnet", "a")
    clock["t"] = 100 * 86400
    assert s.keys_due_for_rotation()
    s.rotate("k", "b")
    assert not s.keys_due_for_rotation()


def test_a_key_without_an_ip_allowlist_is_flagged_before_it_lapses():
    """Unrestricted keys lose their trading permission after 90 days."""
    clock = {"t": 0.0}
    s = SigningService(clock=lambda: clock["t"])
    s.add_key("open", "carry", "production", "x", ip_allowlisted=False)
    clock["t"] = 100 * 86400
    assert [k.key_id for k in s.keys_at_risk()] == ["open"]


# -------------------------------------------------------------- redaction


def test_a_signature_in_a_url_is_redacted():
    """The usual way a secret reaches a log is a handler printing the request."""
    text = "GET /api/v3/order?symbol=BTCUSDT&signature=abcdef0123456789abcdef0123"
    assert "abcdef0123456789" not in redact(text)
    assert "symbol=BTCUSDT" in redact(text)


def test_a_private_key_block_is_redacted():
    pem = ("-----BEGIN PRIVATE KEY-----\nMIIBVgIBADANBgkq\n-----END PRIVATE KEY-----")
    assert "MIIBVgIBADANBgkq" not in redact(pem)


def test_a_bearer_token_is_redacted():
    assert "eyJhbGciOiJIUzI1NiJ9" not in redact("Authorization: Bearer eyJhbGciOiJIUzI1NiJ9")


def test_secret_keys_are_redacted_by_name():
    out = redact_mapping({"symbol": "BTCUSDT", "api_secret": "zzz", "X-BAPI-SIGN": "q"})
    assert out["api_secret"] == "[redacted]"
    assert out["X-BAPI-SIGN"] == "[redacted]"
    assert out["symbol"] == "BTCUSDT"


def test_redaction_recurses():
    out = redact_mapping({"outer": {"signature": "abc"}, "list": [{"password": "p"}]})
    assert out["outer"]["signature"] == "[redacted]"
    assert out["list"][0]["password"] == "[redacted]"


def test_a_clean_payload_is_unchanged():
    payload = {"symbol": "BTCUSDT", "quantity": "0.01", "side": "BUY"}
    assert redact_mapping(payload) == dict(sorted(payload.items()))
