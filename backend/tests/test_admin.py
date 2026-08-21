from unittest.mock import patch

import pytest

from app.models.user import User, anonymized_email


@pytest.fixture
def admin_headers(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "mypassword", "terms_accepted": True},
    )
    user = db.query(User).filter(User.email == "admin@example.com").first()
    user.is_superuser = True
    db.commit()

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "admin@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def plain_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "plainuser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "plainuser@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_non_superuser_cannot_list_users(client, plain_headers):
    res = client.get("/api/v1/admin/users", headers=plain_headers)
    assert res.status_code == 403


def test_superuser_can_list_users(client, admin_headers, plain_headers):
    res = client.get("/api/v1/admin/users", headers=admin_headers)
    assert res.status_code == 200
    emails = {u["email"] for u in res.json()}
    assert "admin@example.com" in emails
    assert "plainuser@example.com" in emails


def test_superuser_can_change_a_user_role(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/role",
        headers=admin_headers,
        params={"role": "premium"},
    )
    assert res.status_code == 200
    assert res.json()["role"] == "premium"


def test_invalid_role_is_rejected(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/role",
        headers=admin_headers,
        params={"role": "not_a_real_role"},
    )
    assert res.status_code == 400


def test_non_superuser_cannot_change_roles(client, plain_headers, admin_headers, db):
    target = db.query(User).filter(User.email == "admin@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/role",
        headers=plain_headers,
        params={"role": "premium"},
    )
    assert res.status_code == 403


def test_admin_cannot_deactivate_own_account(client, admin_headers, db):
    admin = db.query(User).filter(User.email == "admin@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{admin.id}/active",
        headers=admin_headers,
        params={"is_active": False},
    )
    assert res.status_code == 400


def test_admin_can_deactivate_another_account(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/active",
        headers=admin_headers,
        params={"is_active": False},
    )
    assert res.status_code == 200
    assert res.json()["is_active"] is False


def test_non_superuser_cannot_trigger_password_reset(client, plain_headers, admin_headers, db):
    target = db.query(User).filter(User.email == "admin@example.com").first()
    res = client.post(f"/api/v1/admin/users/{target.id}/reset-password", headers=plain_headers)
    assert res.status_code == 403


def test_admin_can_trigger_password_reset_email(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    with patch("app.api.v1.endpoints.admin.send_email") as mock_email:
        res = client.post(f"/api/v1/admin/users/{target.id}/reset-password", headers=admin_headers)
    assert res.status_code == 200
    mock_email.assert_called_once()
    assert mock_email.call_args[0][0] == "plainuser@example.com"


def test_password_reset_rejected_for_inactive_account(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    target.is_active = False
    db.commit()
    res = client.post(f"/api/v1/admin/users/{target.id}/reset-password", headers=admin_headers)
    assert res.status_code == 400


def test_non_superuser_cannot_delete_account(client, plain_headers, admin_headers, db):
    target = db.query(User).filter(User.email == "admin@example.com").first()
    res = client.delete(f"/api/v1/admin/users/{target.id}", headers=plain_headers)
    assert res.status_code == 403


def test_admin_cannot_delete_own_account(client, admin_headers, db):
    admin = db.query(User).filter(User.email == "admin@example.com").first()
    res = client.delete(f"/api/v1/admin/users/{admin.id}", headers=admin_headers)
    assert res.status_code == 400


def test_admin_cannot_delete_another_superuser(client, admin_headers, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "secondadmin@example.com", "password": "mypassword", "terms_accepted": True},
    )
    second_admin = db.query(User).filter(User.email == "secondadmin@example.com").first()
    second_admin.is_superuser = True
    db.commit()
    res = client.delete(f"/api/v1/admin/users/{second_admin.id}", headers=admin_headers)
    assert res.status_code == 400


def test_admin_can_delete_a_plain_account(client, admin_headers, plain_headers, db):
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    target_id = target.id
    res = client.delete(f"/api/v1/admin/users/{target_id}", headers=admin_headers)
    assert res.status_code == 200

    db.expire_all()
    deleted = db.query(User).filter(User.id == target_id).first()
    assert deleted.is_active is False
    assert deleted.email == f"deleted-user-{target_id}@bipterminal.local"
    assert deleted.full_name is None
    assert deleted.totp_enabled is False

    # The now-anonymized account's old token must stop working (deps.py's
    # get_current_user rejects an inactive account's token with 400, not
    # 401 - "Inactive user").
    res2 = client.get("/api/v1/auth/me", headers=plain_headers)
    assert res2.status_code == 400


def test_listing_users_still_works_after_a_deletion(client, admin_headers, plain_headers, db):
    """Regression: deletion rewrites the address to an "@...local" placeholder,
    and .local is an IANA special-use TLD that email-validator rejects. While
    UserOut typed email as EmailStr, that row broke response serialization and
    this endpoint returned 500 - so the whole admin panel went dark as soon as
    any one account had ever been deleted. Asserted through include_deleted so
    the row is actually in the payload: what's under test is that it
    serializes at all, not whether it's shown by default."""
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    target_id = target.id
    assert client.delete(f"/api/v1/admin/users/{target_id}", headers=admin_headers).status_code == 200

    res = client.get("/api/v1/admin/users", headers=admin_headers, params={"include_deleted": "true"})
    assert res.status_code == 200
    emails = {u["email"] for u in res.json()}
    assert anonymized_email(target_id) in emails


def test_deleted_accounts_are_hidden_from_the_default_listing(client, admin_headers, plain_headers, db):
    """Soft-deleted rows are kept forever for audit history, so without this
    they pile up and bury the real accounts in the admin table."""
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    target_id = target.id
    assert client.delete(f"/api/v1/admin/users/{target_id}", headers=admin_headers).status_code == 200

    res = client.get("/api/v1/admin/users", headers=admin_headers)
    assert res.status_code == 200
    emails = {u["email"] for u in res.json()}
    assert anonymized_email(target_id) not in emails
    assert "admin@example.com" in emails


def test_deactivated_but_undeleted_accounts_still_appear(client, admin_headers, plain_headers, db):
    """The filter keys on the anonymized address, not on is_active - an
    account an admin merely suspended is inactive too, and hiding it would
    leave no way to find it again and switch it back on."""
    target = db.query(User).filter(User.email == "plainuser@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/active",
        headers=admin_headers,
        params={"is_active": "false"},
    )
    assert res.status_code == 200

    listing = client.get("/api/v1/admin/users", headers=admin_headers)
    assert listing.status_code == 200
    rows = {u["email"]: u for u in listing.json()}
    assert "plainuser@example.com" in rows
    assert rows["plainuser@example.com"]["is_active"] is False
