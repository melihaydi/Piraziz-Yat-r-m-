from unittest.mock import patch


def _register_and_login(client, email="telegramuser@example.com", password="mypassword"):
    with patch("app.api.v1.endpoints.auth.send_email"):
        client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "terms_accepted": True},
        )
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_get_link_requires_auth(client):
    res = client.get("/api/v1/telegram/link")
    assert res.status_code == 401


def test_get_link_creates_and_returns_unlinked_state(client, db):
    headers = _register_and_login(client)
    with patch("app.api.v1.endpoints.telegram.settings.TELEGRAM_BOT_USERNAME", "BipTerminalBot"):
        res = client.get("/api/v1/telegram/link", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["configured"] is True
    assert body["linked"] is False
    assert body["linked_at"] is None
    assert len(body["link_code"]) == 8
    assert body["deep_link"] == f"https://t.me/BipTerminalBot?start={body['link_code']}"
    assert body["daily_digest_enabled"] is True


def test_get_link_reports_unconfigured_without_bot_username(client, db):
    headers = _register_and_login(client)
    with patch("app.api.v1.endpoints.telegram.settings.TELEGRAM_BOT_USERNAME", None):
        res = client.get("/api/v1/telegram/link", headers=headers)

    body = res.json()
    assert body["configured"] is False
    assert body["deep_link"] is None


def test_get_link_returns_same_code_on_repeat_calls(client, db):
    headers = _register_and_login(client)
    first = client.get("/api/v1/telegram/link", headers=headers).json()
    second = client.get("/api/v1/telegram/link", headers=headers).json()
    assert first["link_code"] == second["link_code"]


def test_regenerate_link_produces_new_code(client, db):
    headers = _register_and_login(client)
    original = client.get("/api/v1/telegram/link", headers=headers).json()

    res = client.post("/api/v1/telegram/link/regenerate", headers=headers)
    assert res.status_code == 200
    regenerated = res.json()
    assert regenerated["link_code"] != original["link_code"]
    assert regenerated["linked"] is False


def test_set_digest_enabled_toggles_flag(client, db):
    headers = _register_and_login(client)
    client.get("/api/v1/telegram/link", headers=headers)

    res = client.patch("/api/v1/telegram/digest-enabled", json={"enabled": False}, headers=headers)
    assert res.status_code == 200
    assert res.json()["daily_digest_enabled"] is False

    res2 = client.patch("/api/v1/telegram/digest-enabled", json={"enabled": True}, headers=headers)
    assert res2.json()["daily_digest_enabled"] is True


def test_telegram_link_is_scoped_per_user(client, db):
    headers_a = _register_and_login(client, "telegrama@example.com")
    headers_b = _register_and_login(client, "telegramb@example.com")

    code_a = client.get("/api/v1/telegram/link", headers=headers_a).json()["link_code"]
    code_b = client.get("/api/v1/telegram/link", headers=headers_b).json()["link_code"]

    assert code_a != code_b
