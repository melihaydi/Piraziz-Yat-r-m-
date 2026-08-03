from unittest.mock import patch

from app.core.notify import send_telegram_alert, _last_sent


def test_send_telegram_alert_noop_when_unconfigured():
    # settings.TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are unset in the test
    # env (see conftest.py) - this must never raise or try a real request.
    assert send_telegram_alert("test message") is False


def test_send_telegram_alert_respects_cooldown():
    _last_sent.clear()
    with patch("app.core.notify.settings") as mock_settings, \
         patch("app.core.notify.httpx.post") as mock_post:
        mock_settings.TELEGRAM_BOT_TOKEN = "fake-token"
        mock_settings.TELEGRAM_CHAT_ID = "fake-chat-id"
        mock_post.return_value.raise_for_status.return_value = None

        assert send_telegram_alert("first", key="k") is True
        assert mock_post.call_count == 1

        # Same key within the cooldown window - must not send again.
        assert send_telegram_alert("second", key="k") is False
        assert mock_post.call_count == 1
    _last_sent.clear()


def test_health_check_returns_200_when_db_up(client):
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["database_connected"] is True


def test_health_check_returns_503_when_db_down(client):
    with patch("app.db.session.engine") as mock_engine:
        mock_engine.connect.side_effect = Exception("connection refused")
        response = client.get("/health")
        assert response.status_code == 503
        assert response.json()["database_connected"] is False
