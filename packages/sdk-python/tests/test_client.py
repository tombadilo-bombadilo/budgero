"""Tests for the v2 sync wire format, headers, and error mapping."""

import base64
import json
import os
from decimal import Decimal

import httpx
import pytest

import budgero
from budgero import (
    BudgeroClient,
    Transaction,
    TransactionInput,
    UpgradeRequiredError,
    ValidationError,
    from_milliunits,
    to_milliunits,
)
from budgero.client import PROTOCOL_VERSION
from budgero.encryption import decrypt_payload, KEY_LENGTH


@pytest.fixture
def key():
    return os.urandom(KEY_LENGTH)


@pytest.fixture
def b64_key(key):
    return base64.b64encode(key).decode("ascii")


def make_client(b64_key, handler=None):
    transport = httpx.MockTransport(handler) if handler else None
    return BudgeroClient(
        api_key="test-key",
        encryption_key=b64_key,
        base_url="http://example.com",
        transport=transport,
    )


# ---------------------------------------------------------------------------
# Milliunit conversion
# ---------------------------------------------------------------------------


def test_to_milliunits_float():
    assert to_milliunits(12.34) == 12340
    assert to_milliunits(0.0) == 0
    assert to_milliunits(0.001) == 1
    assert to_milliunits(-5.5) == -5500


def test_to_milliunits_decimal():
    assert to_milliunits(Decimal("12.34")) == 12340
    assert to_milliunits(Decimal("0.001")) == 1


def test_to_milliunits_int():
    assert to_milliunits(12) == 12000


def test_to_milliunits_returns_int_type():
    assert isinstance(to_milliunits(12.34), int)
    assert isinstance(to_milliunits(Decimal("12.34")), int)


def test_to_milliunits_rejects_non_finite():
    for bad in (float("nan"), float("inf"), float("-inf"),
                Decimal("NaN"), Decimal("Infinity")):
        with pytest.raises(ValidationError, match="finite"):
            to_milliunits(bad)


def test_to_milliunits_rejects_non_numbers():
    with pytest.raises(ValidationError):
        to_milliunits("12.34")
    with pytest.raises(ValidationError):
        to_milliunits(True)


def test_from_milliunits():
    assert from_milliunits(12340) == Decimal("12.34")
    assert isinstance(from_milliunits(12340), Decimal)
    assert from_milliunits(0) == Decimal("0")
    assert from_milliunits(-5500) == Decimal("-5.5")


# ---------------------------------------------------------------------------
# Wire format: versioned payload with milliunit amounts
# ---------------------------------------------------------------------------


def test_encrypted_payload_contains_v2(key, b64_key):
    client = make_client(b64_key)
    try:
        _, encrypted = client._encrypt_mutation("transactions.add", {"foo": "bar"})
        decrypted = decrypt_payload(encrypted, key)
        assert decrypted["v"] == 2
        assert decrypted["op"] == "transactions.add"
        assert decrypted["args"] == {"foo": "bar"}
    finally:
        client.close()


def test_transaction_input_converts_amounts_to_milliunits():
    tx = TransactionInput(
        account_id=1,
        category_id=5,
        budget_id=1,
        date="2026-07-03",
        inflow=Decimal("12.34"),
        outflow=0,
    )
    api = tx.to_api_dict()
    assert api["inflow"] == 12340
    assert api["outflow"] == 0
    assert isinstance(api["inflow"], int)


def test_push_transaction_wire_payload(key, b64_key):
    """End-to-end: the encrypted payload on the wire is v2 with milliunits."""
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["request"] = request
        captured["body"] = json.loads(request.content)
        return httpx.Response(200, json={"id": "q-1", "message": "queued"})

    client = make_client(b64_key, handler)
    try:
        result = client.add_transaction(
            account_id=1,
            category_id=5,
            budget_id=1,
            date="2026-07-03",
            outflow=12.34,
            memo="Coffee",
        )
    finally:
        client.close()

    assert result.success
    assert result.queue_id == "q-1"

    decrypted = decrypt_payload(captured["body"]["encrypted_payload"], key)
    assert decrypted["v"] == 2
    assert decrypted["op"] == "transactions.add"
    assert decrypted["args"]["outflow"] == 12340
    assert decrypted["args"]["inflow"] == 0


def test_add_transaction_rejects_non_finite_amounts(b64_key):
    client = make_client(b64_key)
    try:
        with pytest.raises(ValidationError, match="finite"):
            client.add_transaction(
                account_id=1,
                category_id=5,
                budget_id=1,
                date="2026-07-03",
                outflow=float("nan"),
            )
        with pytest.raises(ValidationError, match="finite"):
            client.add_transaction(
                account_id=1,
                category_id=5,
                budget_id=1,
                date="2026-07-03",
                inflow=Decimal("Infinity"),
            )
    finally:
        client.close()


# ---------------------------------------------------------------------------
# Headers
# ---------------------------------------------------------------------------


def test_protocol_header_sent_on_all_requests(b64_key):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"items": []})

    client = make_client(b64_key, handler)
    try:
        client.get_queue()
        client.health_check()
    finally:
        client.close()

    assert len(seen) == 2
    for request in seen:
        assert request.headers["X-Budgero-Protocol"] == str(PROTOCOL_VERSION)
        assert request.headers["User-Agent"] == f"budgero-python/{budgero.__version__}"


def test_data_format_header_sent_on_push(b64_key):
    seen = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(request)
        return httpx.Response(200, json={"id": "q-1"})

    client = make_client(b64_key, handler)
    try:
        client.add_transaction(
            account_id=1,
            category_id=5,
            budget_id=1,
            date="2026-07-03",
            outflow=1.00,
        )
    finally:
        client.close()

    (request,) = seen
    assert request.headers["X-Data-Format-Version"] == str(PROTOCOL_VERSION)
    assert request.headers["X-Budgero-Protocol"] == str(PROTOCOL_VERSION)


# ---------------------------------------------------------------------------
# 426 handling
# ---------------------------------------------------------------------------


def test_426_raises_upgrade_required(b64_key):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(426, text="upgrade required")

    client = make_client(b64_key, handler)
    try:
        with pytest.raises(UpgradeRequiredError, match="upgrade"):
            client.get_queue()
    finally:
        client.close()


def test_426_exception_carries_status_and_body(b64_key):
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(426, text="protocol too old")

    client = make_client(b64_key, handler)
    try:
        with pytest.raises(UpgradeRequiredError) as exc_info:
            client.get_queue_stats()
    finally:
        client.close()

    assert exc_info.value.status_code == 426
    assert exc_info.value.response_body == "protocol too old"


# ---------------------------------------------------------------------------
# Read paths: milliunits -> Decimal
# ---------------------------------------------------------------------------


def test_transaction_from_api_dict_converts_milliunits():
    tx = Transaction.from_api_dict(
        {
            "ID": 1,
            "AccountID": 2,
            "CategoryID": 3,
            "BudgetID": 4,
            "Date": "2026-07-03",
            "Month": "2026-07",
            "Inflow": 12340,
            "Outflow": 0,
            "RunningBalance": 100500,
        }
    )
    assert tx.inflow == Decimal("12.34")
    assert tx.outflow == Decimal("0")
    assert tx.running_balance == Decimal("100.5")
    assert isinstance(tx.inflow, Decimal)
