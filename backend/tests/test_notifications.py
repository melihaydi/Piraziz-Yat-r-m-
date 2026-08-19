from unittest.mock import patch, MagicMock

import pytest

from app.models.push_subscription import PushSubscription


class _SyncExecutor:
    """alert_notifier'ın thread havuzunun yerine geçer: submit edileni
    hemen, aynı thread'de çalıştırır. Böylece testler bildirimin
    tamamlanmasını beklemek zorunda kalmaz (gerçekte gönderim asenkron,
    çünkü websocket geri çağrımını bloklamamalı)."""

    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)


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

    # Bildirim gönderimi bir thread havuzuna devrediliyor (websocket
    # tetikleyicisini bloklamamak için - bkz. alert_notifier). Testte
    # havuzu senkron bir çalıştırıcıyla değiştiriyoruz ki gönderim
    # assert'lerden önce tamamlanmış olsun.
    with patch("app.services.market_data.market_data_service.get_quote", return_value={"last": 41.0}), \
         patch("app.services.market_data.market_data_service.get_candles", return_value=None), \
         patch("app.services.alert_notifier._executor", _SyncExecutor()), \
         patch("app.core.email.send_email") as mock_email, \
         patch("app.core.push.send_push_to_subscriptions") as mock_push:
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.status_code == 200
    assert len(result.json()) == 1
    mock_email.assert_called_once()
    assert mock_email.call_args[0][0] == "pushuser@example.com"
    mock_push.assert_called_once()


def test_alert_notification_is_sent_exactly_once_when_both_paths_race(client, auth_headers, db):
    """Alarmı websocket tetikleyicisi ve /alert/check aynı anda yakalarsa
    kullanıcı ÇİFT bildirim almamalı - geçiş atomik olduğu için ikinciden
    hiçbir şey gitmez. (Asıl bug bunun tersiydi: websocket alarmı sessizce
    tüketiyor, hiç bildirim gitmiyordu.)"""
    from app.models.alert import Alert
    from app.services.alert_notifier import mark_triggered_and_notify

    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "price", "trigger_condition": {"operator": ">", "value": 1.0}},
        headers=auth_headers,
    )
    alert = db.query(Alert).filter(Alert.ticker == "EREGL").one()

    with patch("app.services.alert_notifier._executor", _SyncExecutor()), \
         patch("app.core.email.send_email") as mock_email, \
         patch("app.core.push.send_push"):
        first = mark_triggered_and_notify(db, alert, body="ilk")
        second = mark_triggered_and_notify(db, alert, body="ikinci")

    assert first is True
    assert second is False
    mock_email.assert_called_once()


def test_websocket_price_trigger_actually_notifies(client, auth_headers, db):
    """Asıl bug: canlı fiyat akışındaki tetikleyici alarmı tetiklenmiş
    işaretleyip pasife çekiyor ama HİÇBİR bildirim göndermiyordu - sadece
    log yazıyordu. Websocket sürekli çalıştığı için alarmı, kullanıcı
    /alert/check'i yoklayamadan tüketiyordu; sonuçta kurulan fiyat
    alarmları ne e-posta ne push üretiyordu."""
    from app.models.alert import Alert
    from app.services.market_data import market_data_service

    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "price", "trigger_condition": {"operator": ">", "value": 40.0}},
        headers=auth_headers,
    )

    with patch("app.services.alert_notifier._executor", _SyncExecutor()), \
         patch("app.db.session.SessionLocal", return_value=db), \
         patch("app.services.market_data.SessionLocal", return_value=db), \
         patch.object(market_data_service, "_get_alert_tickers", return_value={"EREGL"}), \
         patch("app.core.email.send_email") as mock_email, \
         patch("app.core.push.send_push_to_subscriptions") as mock_push:
        market_data_service._check_alerts_for_symbol("EREGL", {"last": 41.0})

    # Bildirim GİTMELİ - düzeltmeden önce burası 0 çağrıydı.
    mock_email.assert_called_once()
    mock_push.assert_called_once()

    alert = db.query(Alert).filter(Alert.ticker == "EREGL").one()
    assert alert.is_triggered is True


def test_websocket_trigger_ignores_untriggered_condition(client, auth_headers, db):
    from app.services.market_data import market_data_service

    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "price", "trigger_condition": {"operator": ">", "value": 100.0}},
        headers=auth_headers,
    )

    with patch("app.services.alert_notifier._executor", _SyncExecutor()), \
         patch("app.services.market_data.SessionLocal", return_value=db), \
         patch.object(market_data_service, "_get_alert_tickers", return_value={"EREGL"}), \
         patch("app.core.email.send_email") as mock_email:
        market_data_service._check_alerts_for_symbol("EREGL", {"last": 41.0})

    mock_email.assert_not_called()
