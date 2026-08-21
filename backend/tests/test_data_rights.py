from unittest.mock import patch

from app.models.user import User, DELETED_EMAIL_DOMAIN


def _register_and_login(client, email="datarights@example.com", password="mypassword"):
    with patch("app.api.v1.endpoints.auth.send_email"):
        client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "terms_accepted": True},
        )
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_register_records_terms_accepted_at(client, db):
    with patch("app.api.v1.endpoints.auth.send_email"):
        client.post(
            "/api/v1/auth/register",
            json={"email": "consent@example.com", "password": "mypassword", "terms_accepted": True},
        )
    user = db.query(User).filter(User.email == "consent@example.com").first()
    assert user.terms_accepted_at is not None


def test_export_my_data_returns_profile_and_empty_collections_for_new_user(client):
    headers = _register_and_login(client)
    res = client.get("/api/v1/auth/me/export", headers=headers)
    assert res.status_code == 200
    data = res.json()
    assert data["profile"]["email"] == "datarights@example.com"
    assert data["trade_accounts"] == []
    assert data["portfolios"] == []
    assert data["notes"] == []
    assert data["alerts"] == []


def test_export_my_data_requires_auth(client):
    res = client.get("/api/v1/auth/me/export")
    assert res.status_code == 401


def test_export_my_data_includes_created_note(client):
    headers = _register_and_login(client, "exportnotes@example.com")
    client.post("/api/v1/notes/", json={"title": "Test Not", "content": "içerik"}, headers=headers)

    res = client.get("/api/v1/auth/me/export", headers=headers)
    assert res.status_code == 200
    notes = res.json()["notes"]
    assert len(notes) == 1
    assert notes[0]["title"] == "Test Not"


def test_delete_my_account_requires_correct_password(client):
    headers = _register_and_login(client, "wrongpassdelete@example.com")
    res = client.post("/api/v1/auth/me/delete", json={"password": "notmypassword"}, headers=headers)
    assert res.status_code == 400


def test_delete_my_account_soft_deletes_and_anonymizes(client, db):
    headers = _register_and_login(client, "deleteme@example.com", "correctpassword")
    res = client.post("/api/v1/auth/me/delete", json={"password": "correctpassword"}, headers=headers)
    assert res.status_code == 200

    # Domain comes from the shared constant rather than being spelled out
    # here: this path used to write "@piraziz.local" while the admin delete
    # path wrote "@bipterminal.local", and the admin listing's filter needs
    # all three to agree (see models.user.DELETED_EMAIL_DOMAIN).
    user = db.query(User).filter(User.id != None).filter(
        User.email.like(f"deleted-user-%@{DELETED_EMAIL_DOMAIN}")
    ).first()
    assert user is not None
    assert user.is_active is False
    assert user.full_name is None

    # The old (now-anonymized-away) email can be freely re-registered.
    with patch("app.api.v1.endpoints.auth.send_email"):
        reregister = client.post(
            "/api/v1/auth/register",
            json={"email": "deleteme@example.com", "password": "anotherpassword", "terms_accepted": True},
        )
    assert reregister.status_code == 201


def test_deleted_account_cannot_log_in(client):
    headers = _register_and_login(client, "loginafterdelete@example.com", "correctpassword")
    client.post("/api/v1/auth/me/delete", json={"password": "correctpassword"}, headers=headers)

    login = client.post(
        "/api/v1/auth/login",
        data={"username": "loginafterdelete@example.com", "password": "correctpassword"},
    )
    assert login.status_code == 400
