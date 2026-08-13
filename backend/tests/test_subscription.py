import json

import pytest


@pytest.fixture
def auth_headers_user(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "subuser@example.com", "password": "subpassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "subuser@example.com", "password": "subpassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def iyzico_configured(monkeypatch):
    """is_configured() gates every real call - without real credentials
    (never available in a test run), initialize_checkout() would otherwise
    refuse before ever reaching the (mocked) iyzico SDK call below."""
    from app.core.config import settings
    monkeypatch.setattr(settings, "IYZICO_API_KEY", "test-key")
    monkeypatch.setattr(settings, "IYZICO_SECRET_KEY", "test-secret")


class _FakeResponse:
    def __init__(self, data: dict):
        self._data = json.dumps(data).encode("utf-8")

    def read(self):
        return self._data


class _FakeCheckoutFormInitializeSuccess:
    """Records the conversationId iyzico would echo back, so the paired
    _FakeCheckoutFormRetrieve* below can return a matching one - mirrors
    the real round trip without needing a live sandbox account."""
    last_conversation_id = None

    def create(self, request, options):
        _FakeCheckoutFormInitializeSuccess.last_conversation_id = request["conversationId"]
        return _FakeResponse({
            "status": "success",
            "token": "fake-token-abc",
            "paymentPageUrl": "https://sandbox-cpp.iyzipay.com/fake-token-abc",
        })


class _FakeCheckoutFormInitializeFailure:
    def create(self, request, options):
        return _FakeResponse({"status": "failure", "errorMessage": "Kart reddedildi."})


class _FakeCheckoutFormRetrieveSuccess:
    def retrieve(self, request, options):
        return _FakeResponse({
            "status": "success",
            "paymentStatus": "SUCCESS",
            "paymentId": "12345",
            "conversationId": _FakeCheckoutFormInitializeSuccess.last_conversation_id,
        })


class _FakeCheckoutFormRetrieveFailure:
    def retrieve(self, request, options):
        return _FakeResponse({
            "status": "success",
            "paymentStatus": "FAILURE",
            "conversationId": _FakeCheckoutFormInitializeSuccess.last_conversation_id,
        })


def test_plans_endpoint_lists_paid_tiers(client, auth_headers_user):
    res = client.get("/api/v1/subscription/plans", headers=auth_headers_user)
    assert res.status_code == 200
    roles = {p["role"] for p in res.json()["plans"]}
    assert {"premium"} <= roles


def test_checkout_rejects_when_iyzico_not_configured(client, auth_headers_user):
    res = client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "12345678901"},
        headers=auth_headers_user,
    )
    assert res.status_code == 400


def test_checkout_rejects_invalid_identity_number(client, auth_headers_user, iyzico_configured):
    res = client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "123"},
        headers=auth_headers_user,
    )
    assert res.status_code == 400


def test_checkout_rejects_unknown_role(client, auth_headers_user, iyzico_configured):
    res = client.post(
        "/api/v1/subscription/checkout",
        json={"role": "institutional", "identity_number": "12345678901"},
        headers=auth_headers_user,
    )
    assert res.status_code == 400


def test_full_checkout_and_callback_upgrades_role(client, db, auth_headers_user, iyzico_configured, monkeypatch):
    import app.services.payment_service as payment_service
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutFormInitialize", _FakeCheckoutFormInitializeSuccess)
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutForm", _FakeCheckoutFormRetrieveSuccess)

    checkout_res = client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "12345678901", "city": "Istanbul"},
        headers=auth_headers_user,
    )
    assert checkout_res.status_code == 200
    assert checkout_res.json()["payment_page_url"].startswith("https://")

    # Simulate iyzico redirecting the buyer's browser back with the token -
    # this is the call that actually confirms payment server-side.
    callback_res = client.post(
        "/api/v1/subscription/callback",
        data={"token": "fake-token-abc"},
        headers=auth_headers_user,
        follow_redirects=False,
    )
    assert callback_res.status_code == 302
    assert "payment=success" in callback_res.headers["location"]

    me = client.get("/api/v1/auth/me", headers=auth_headers_user)
    assert me.json()["role"] == "premium"

    history_res = client.get("/api/v1/subscription/history", headers=auth_headers_user)
    assert history_res.status_code == 200
    assert history_res.json()[0]["status"] == "paid"
    assert history_res.json()[0]["expires_at"] is not None


def test_callback_with_failed_payment_does_not_upgrade_role(client, auth_headers_user, iyzico_configured, monkeypatch):
    import app.services.payment_service as payment_service
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutFormInitialize", _FakeCheckoutFormInitializeSuccess)
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutForm", _FakeCheckoutFormRetrieveFailure)

    client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "12345678901"},
        headers=auth_headers_user,
    )
    callback_res = client.post(
        "/api/v1/subscription/callback",
        data={"token": "fake-token-abc"},
        headers=auth_headers_user,
        follow_redirects=False,
    )
    assert "payment=failed" in callback_res.headers["location"]

    me = client.get("/api/v1/auth/me", headers=auth_headers_user)
    assert me.json()["role"] == "free"


def test_checkout_initialize_failure_is_reported(client, auth_headers_user, iyzico_configured, monkeypatch):
    import app.services.payment_service as payment_service
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutFormInitialize", _FakeCheckoutFormInitializeFailure)

    res = client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "12345678901"},
        headers=auth_headers_user,
    )
    assert res.status_code == 400
    assert "reddedildi" in res.json()["detail"]


def test_cancel_reverts_to_free_and_marks_subscription_canceled(client, db, auth_headers_user, iyzico_configured, monkeypatch):
    import app.services.payment_service as payment_service
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutFormInitialize", _FakeCheckoutFormInitializeSuccess)
    monkeypatch.setattr(payment_service.iyzipay, "CheckoutForm", _FakeCheckoutFormRetrieveSuccess)

    client.post(
        "/api/v1/subscription/checkout",
        json={"role": "premium", "identity_number": "12345678901"},
        headers=auth_headers_user,
    )
    client.post("/api/v1/subscription/callback", data={"token": "fake-token-abc"}, headers=auth_headers_user)

    cancel_res = client.post("/api/v1/subscription/cancel", headers=auth_headers_user)
    assert cancel_res.status_code == 200

    me = client.get("/api/v1/auth/me", headers=auth_headers_user)
    assert me.json()["role"] == "free"

    history_res = client.get("/api/v1/subscription/history", headers=auth_headers_user)
    assert history_res.json()[0]["status"] == "canceled"


def test_cancel_on_free_tier_rejected(client, auth_headers_user):
    res = client.post("/api/v1/subscription/cancel", headers=auth_headers_user)
    assert res.status_code == 400
