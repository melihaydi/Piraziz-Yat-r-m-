import pytest


@pytest.fixture
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "notesuser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "notesuser@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_create_and_list_note(client, auth_headers):
    res = client.post(
        "/api/v1/notes/",
        json={"title": "THYAO gözlem", "content": "Kâr açıklaması yaklaşıyor", "ticker": "thyao", "category": "hisse", "color": "blue"},
        headers=auth_headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["ticker"] == "THYAO"  # uppercased server-side
    assert body["is_pinned"] is False

    res = client.get("/api/v1/notes/", headers=auth_headers)
    assert res.status_code == 200
    assert len(res.json()) == 1


def test_note_isolated_per_user(client, auth_headers):
    client.post("/api/v1/notes/", json={"title": "Not 1"}, headers=auth_headers)

    client.post("/api/v1/auth/register", json={"email": "other@example.com", "password": "mypassword", "terms_accepted": True})
    other_login = client.post("/api/v1/auth/login", data={"username": "other@example.com", "password": "mypassword"})
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}

    res = client.get("/api/v1/notes/", headers=other_headers)
    assert res.status_code == 200
    assert res.json() == []


def test_update_note(client, auth_headers):
    created = client.post("/api/v1/notes/", json={"title": "Eski başlık"}, headers=auth_headers).json()
    res = client.put(
        f"/api/v1/notes/{created['id']}",
        json={"title": "Yeni başlık", "content": "Güncellendi"},
        headers=auth_headers,
    )
    assert res.status_code == 200
    assert res.json()["title"] == "Yeni başlık"
    assert res.json()["content"] == "Güncellendi"


def test_cannot_update_another_users_note(client, auth_headers):
    created = client.post("/api/v1/notes/", json={"title": "Gizli not"}, headers=auth_headers).json()

    client.post("/api/v1/auth/register", json={"email": "intruder@example.com", "password": "mypassword", "terms_accepted": True})
    intruder_login = client.post("/api/v1/auth/login", data={"username": "intruder@example.com", "password": "mypassword"})
    intruder_headers = {"Authorization": f"Bearer {intruder_login.json()['access_token']}"}

    res = client.put(f"/api/v1/notes/{created['id']}", json={"title": "Ele geçirildi"}, headers=intruder_headers)
    assert res.status_code == 404


def test_pin_toggle_orders_pinned_notes_first(client, auth_headers):
    a = client.post("/api/v1/notes/", json={"title": "A"}, headers=auth_headers).json()
    client.post("/api/v1/notes/", json={"title": "B"}, headers=auth_headers).json()

    res = client.post(f"/api/v1/notes/{a['id']}/pin", headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["is_pinned"] is True

    listed = client.get("/api/v1/notes/", headers=auth_headers).json()
    assert listed[0]["id"] == a["id"]


def test_delete_note(client, auth_headers):
    created = client.post("/api/v1/notes/", json={"title": "Silinecek"}, headers=auth_headers).json()
    res = client.delete(f"/api/v1/notes/{created['id']}", headers=auth_headers)
    assert res.status_code == 204

    listed = client.get("/api/v1/notes/", headers=auth_headers).json()
    assert listed == []


def test_unauthenticated_request_rejected(client):
    res = client.get("/api/v1/notes/")
    assert res.status_code == 401
