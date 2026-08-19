"""İzleme listesi: hesaba bağlı favori hisseler ve localStorage göçü."""
import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "watcher@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "watcher@example.com", "password": "mypassword"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="function")
def other_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "other-watcher@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "other-watcher@example.com", "password": "mypassword"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_requires_auth(client):
    assert client.get("/api/v1/watchlist/").status_code == 401


def test_add_and_list(client, auth_headers):
    res = client.post("/api/v1/watchlist/", json={"ticker": "thyao"}, headers=auth_headers)
    assert res.status_code == 201
    # Kod normalize edilmeli - kullanıcı küçük harf yazabilir.
    assert res.json()["ticker"] == "THYAO"

    items = client.get("/api/v1/watchlist/", headers=auth_headers).json()
    assert [i["ticker"] for i in items] == ["THYAO"]


def test_adding_twice_does_not_duplicate(client, auth_headers):
    client.post("/api/v1/watchlist/", json={"ticker": "THYAO"}, headers=auth_headers)
    res = client.post("/api/v1/watchlist/", json={"ticker": "THYAO"}, headers=auth_headers)
    # Hata değil: yıldıza iki kez basmak ya da iki cihazdan eklemek olağan.
    assert res.status_code == 201

    items = client.get("/api/v1/watchlist/", headers=auth_headers).json()
    assert len(items) == 1


def test_remove(client, auth_headers):
    client.post("/api/v1/watchlist/", json={"ticker": "THYAO"}, headers=auth_headers)
    assert client.delete("/api/v1/watchlist/THYAO", headers=auth_headers).status_code == 204
    assert client.get("/api/v1/watchlist/", headers=auth_headers).json() == []


def test_removing_absent_ticker_is_not_an_error(client, auth_headers):
    """İstenen son durum (listemde olmasın) zaten sağlanmış - hata saymak
    istemcide yıldızı geri açardı."""
    assert client.delete("/api/v1/watchlist/EREGL", headers=auth_headers).status_code == 204


def test_watchlist_is_scoped_per_user(client, auth_headers, other_headers):
    client.post("/api/v1/watchlist/", json={"ticker": "THYAO"}, headers=auth_headers)
    assert client.get("/api/v1/watchlist/", headers=other_headers).json() == []


def test_migrate_merges_without_deleting(client, auth_headers):
    """Göç yalnızca ekler: kullanıcı iki cihazda iki farklı liste
    biriktirmiş olabilir, birini sessizce kaybetmemeliyiz."""
    client.post("/api/v1/watchlist/", json={"ticker": "THYAO"}, headers=auth_headers)

    res = client.post(
        "/api/v1/watchlist/migrate",
        json={"tickers": ["EREGL", "ASELS", "thyao"]},
        headers=auth_headers,
    )
    assert res.status_code == 200
    # THYAO zaten vardı - tekrar eklenmemeli.
    assert res.json()["added"] == 2
    assert res.json()["total"] == 3

    tickers = {i["ticker"] for i in client.get("/api/v1/watchlist/", headers=auth_headers).json()}
    assert tickers == {"THYAO", "EREGL", "ASELS"}


def test_migrate_is_idempotent(client, auth_headers):
    payload = {"tickers": ["THYAO", "EREGL"]}
    client.post("/api/v1/watchlist/migrate", json=payload, headers=auth_headers)
    second = client.post("/api/v1/watchlist/migrate", json=payload, headers=auth_headers)

    assert second.json()["added"] == 0
    assert len(client.get("/api/v1/watchlist/", headers=auth_headers).json()) == 2


def test_migrate_with_empty_list_is_harmless(client, auth_headers):
    res = client.post("/api/v1/watchlist/migrate", json={"tickers": []}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["added"] == 0
