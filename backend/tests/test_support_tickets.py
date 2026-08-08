from unittest.mock import patch

import pytest

from app.models.user import User


@pytest.fixture
def user_headers(client):
    client.post("/api/v1/auth/register", json={"email": "supportuser@example.com", "password": "mypassword", "terms_accepted": True})
    login = client.post("/api/v1/auth/login", data={"username": "supportuser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def admin_headers(client, db):
    client.post("/api/v1/auth/register", json={"email": "supportadmin@example.com", "password": "mypassword", "terms_accepted": True})
    user = db.query(User).filter(User.email == "supportadmin@example.com").first()
    user.is_superuser = True
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "supportadmin@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_ticket_requires_auth(client):
    res = client.post("/api/v1/support/tickets", json={"subject": "Yardım", "message": "Bir sorun var"})
    assert res.status_code == 401


def test_create_and_list_own_ticket(client, user_headers):
    with patch("app.api.v1.endpoints.support.send_email") as mock_email:
        res = client.post(
            "/api/v1/support/tickets",
            json={"subject": "Giriş sorunu", "message": "Giriş yapamıyorum"},
            headers=user_headers,
        )
    assert res.status_code == 201
    data = res.json()
    assert data["subject"] == "Giriş sorunu"
    assert data["status"] == "open"
    mock_email.assert_called_once()

    res = client.get("/api/v1/support/tickets", headers=user_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_regular_user_cannot_see_admin_ticket_list(client, user_headers):
    res = client.get("/api/v1/admin/support/tickets", headers=user_headers)
    assert res.status_code == 403


def test_admin_can_list_and_reply_to_ticket(client, user_headers, admin_headers):
    with patch("app.api.v1.endpoints.support.send_email"):
        create_res = client.post(
            "/api/v1/support/tickets",
            json={"subject": "Fatura sorusu", "message": "Faturamı bulamıyorum"},
            headers=user_headers,
        )
    ticket_id = create_res.json()["id"]

    list_res = client.get("/api/v1/admin/support/tickets", headers=admin_headers)
    assert list_res.status_code == 200
    tickets = list_res.json()
    assert len(tickets) == 1
    assert tickets[0]["user_email"] == "supportuser@example.com"

    with patch("app.api.v1.endpoints.admin.send_email") as mock_email:
        update_res = client.put(
            f"/api/v1/admin/support/tickets/{ticket_id}",
            json={"status": "closed", "admin_reply": "Faturanız e-postanıza gönderildi."},
            headers=admin_headers,
        )
    assert update_res.status_code == 200
    updated = update_res.json()
    assert updated["status"] == "closed"
    assert updated["admin_reply"] == "Faturanız e-postanıza gönderildi."
    mock_email.assert_called_once()
    assert mock_email.call_args[0][0] == "supportuser@example.com"


def test_updating_ticket_without_reply_does_not_send_email(client, user_headers, admin_headers):
    with patch("app.api.v1.endpoints.support.send_email"):
        create_res = client.post(
            "/api/v1/support/tickets",
            json={"subject": "Test", "message": "test"},
            headers=user_headers,
        )
    ticket_id = create_res.json()["id"]

    with patch("app.api.v1.endpoints.admin.send_email") as mock_email:
        res = client.put(
            f"/api/v1/admin/support/tickets/{ticket_id}",
            json={"status": "closed"},
            headers=admin_headers,
        )
    assert res.status_code == 200
    mock_email.assert_not_called()
