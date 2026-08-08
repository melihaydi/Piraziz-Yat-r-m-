from datetime import timedelta
from unittest.mock import patch

from app.core import security
from app.models.user import User


def _register(client, email="reset@example.com", password="originalpassword"):
    return client.post("/api/v1/auth/register", json={"email": email, "password": password})


def test_register_sends_verification_email_and_user_starts_unverified(client, db):
    with patch("app.api.v1.endpoints.auth.send_email") as mock_send:
        _register(client, "verifyme@example.com")

    mock_send.assert_called_once()
    assert mock_send.call_args[0][0] == "verifyme@example.com"

    user = db.query(User).filter(User.email == "verifyme@example.com").first()
    assert user.is_email_verified is False


def test_forgot_password_returns_generic_200_for_existing_and_nonexistent_email(client):
    _register(client, "known@example.com")

    with patch("app.api.v1.endpoints.auth.send_email") as mock_send:
        res_known = client.post("/api/v1/auth/forgot-password", json={"email": "known@example.com"})
        res_unknown = client.post("/api/v1/auth/forgot-password", json={"email": "nobody@example.com"})

    assert res_known.status_code == 200
    assert res_unknown.status_code == 200
    assert res_known.json() == res_unknown.json()
    # Only the real account should have actually triggered an email send.
    mock_send.assert_called_once()
    assert mock_send.call_args[0][0] == "known@example.com"


def test_reset_password_with_valid_token_changes_password_and_old_password_stops_working(client, db):
    _register(client, "changeme@example.com", "oldpassword123")
    user = db.query(User).filter(User.email == "changeme@example.com").first()

    token = security.create_access_token(user.id, expires_delta=timedelta(minutes=15), scope="password_reset")
    res = client.post("/api/v1/auth/reset-password", json={"token": token, "new_password": "newpassword456"})
    assert res.status_code == 200

    old_login = client.post("/api/v1/auth/login", data={"username": "changeme@example.com", "password": "oldpassword123"})
    assert old_login.status_code == 400

    new_login = client.post("/api/v1/auth/login", data={"username": "changeme@example.com", "password": "newpassword456"})
    assert new_login.status_code == 200


def test_reset_password_rejects_token_with_wrong_scope(client, db):
    _register(client, "wrongscope@example.com")
    user = db.query(User).filter(User.email == "wrongscope@example.com").first()

    access_token = security.create_access_token(user.id)  # scope="access", not "password_reset"
    res = client.post("/api/v1/auth/reset-password", json={"token": access_token, "new_password": "irrelevant123"})
    assert res.status_code == 400


def test_reset_password_rejects_garbage_token(client):
    res = client.post("/api/v1/auth/reset-password", json={"token": "not-a-real-token", "new_password": "irrelevant123"})
    assert res.status_code == 400


def test_verify_email_with_valid_token_marks_user_verified(client, db):
    with patch("app.api.v1.endpoints.auth.send_email"):
        _register(client, "toverify@example.com")
    user = db.query(User).filter(User.email == "toverify@example.com").first()
    assert user.is_email_verified is False

    token = security.create_access_token(user.id, expires_delta=timedelta(hours=24), scope="email_verify")
    res = client.post("/api/v1/auth/verify-email", json={"token": token})
    assert res.status_code == 200
    assert res.json()["is_email_verified"] is True

    db.refresh(user)
    assert user.is_email_verified is True


def test_verify_email_rejects_wrong_scope_token(client, db):
    with patch("app.api.v1.endpoints.auth.send_email"):
        _register(client, "badverify@example.com")
    user = db.query(User).filter(User.email == "badverify@example.com").first()

    access_token = security.create_access_token(user.id)
    res = client.post("/api/v1/auth/verify-email", json={"token": access_token})
    assert res.status_code == 400


def test_resend_verification_skips_already_verified_users(client, db):
    with patch("app.api.v1.endpoints.auth.send_email"):
        _register(client, "alreadyverified@example.com")
    user = db.query(User).filter(User.email == "alreadyverified@example.com").first()
    user.is_email_verified = True
    db.commit()

    with patch("app.api.v1.endpoints.auth.send_email") as mock_send:
        res = client.post("/api/v1/auth/resend-verification", json={"email": "alreadyverified@example.com"})

    assert res.status_code == 200
    mock_send.assert_not_called()
