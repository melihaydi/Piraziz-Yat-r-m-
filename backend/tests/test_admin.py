import pytest

from app.models.user import User


@pytest.fixture
def admin_headers(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "admin@example.com", "password": "mypassword"},
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
        json={"email": "plainuser@example.com", "password": "mypassword"},
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
