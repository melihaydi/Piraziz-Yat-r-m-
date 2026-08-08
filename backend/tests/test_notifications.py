from unittest.mock import patch, MagicMock

import pytest

from app.models.push_subscription import PushSubscription


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post("/api/v1/auth/register", json={"email": "pushuser@example.com", "password": "mypassword", "terms_accepted": True})
    login = client.post("/api/v1/auth/login", data={"username": "pushuser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_get_vapid_public_key_is_public(client):
    res = client.get("/api/v1/notifications/vapid-public-key")
    assert res.status_code == 200
    assert res.json()["public_key"]


def test_subscribe_requires_auth(client):
    res = client.post("/api/v1/notifications/subscribe", json={
        "endpoint": "https://push.example.com/abc",
        "keys": {"p256dh": "key1", "auth": "key2"},
    })
    assert res.status_code == 401


def test_subscribe_then_unsubscribe(client, auth_headers, db):
    res = client.post("/api/v1/notifications/subscribe", json={
        "endpoint": "https://push.example.com/xyz",
        "keys": {"p256dh": "key1", "auth": "key2"},
    }, headers=auth_headers)
    assert res.status_code == 201
    assert db.query(PushSubscription).filter(PushSubscription.endpoint == "https://push.example.com/xyz").count() == 1

    res = client.post("/api/v1/notifications/unsubscribe", json={"endpoint": "https://push.example.com/xyz"}, headers=auth_headers)
    assert res.status_code == 200
    assert db.query(PushSubscription).filter(PushSubscription.endpoint == "https://push.example.com/xyz").count() == 0


def test_resubscribe_with_same_endpoint_updates_not_duplicates(client, auth_headers, db):
    payload = {"endpoint": "https://push.example.com/dup", "keys": {"p256dh": "key1", "auth": "key2"}}
    client.post("/api/v1/notifications/subscribe", json=payload, headers=auth_headers)
    payload["keys"]["p256dh"] = "newkey"
    client.post("/api/v1/notifications/subscribe", json=payload, headers=auth_headers)

    rows = db.query(PushSubscription).filter(PushSubscription.endpoint == "https://push.example.com/dup").all()
    assert len(rows) == 1
    assert rows[0].p256dh == "newkey"


def test_triggered_alert_sends_email_and_push(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "price", "trigger_condition": {"operator": ">", "value": 1.0}},
        headers=auth_headers,
    )

    with patch("app.services.market_data.market_data_service.get_quote", return_value={"last": 41.0}), \
         patch("app.services.market_data.market_data_service.get_candles", return_value=None), \
         patch("app.core.email.send_email") as mock_email, \
         patch("app.core.push.send_push") as mock_push:
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.status_code == 200
    assert len(result.json()) == 1
    mock_email.assert_called_once()
    assert mock_email.call_args[0][0] == "pushuser@example.com"
    mock_push.assert_called_once()
