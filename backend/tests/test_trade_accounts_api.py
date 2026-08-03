import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post("/api/v1/auth/register", json={"email": "multiacct@example.com", "password": "mypassword"})
    login = client.post("/api/v1/auth/login", data={"username": "multiacct@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(scope="function")
def other_auth_headers(client):
    client.post("/api/v1/auth/register", json={"email": "otheruser@example.com", "password": "mypassword"})
    login = client.post("/api/v1/auth/login", data={"username": "otheruser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_bootstrap_creates_one_default_account(client, auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    accounts = client.get("/api/v1/trade/accounts", headers=auth_headers).json()
    assert len(accounts) == 1
    assert accounts[0]["name"] == "Portföy 1"


def test_can_create_additional_account(client, auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    resp = client.post(
        "/api/v1/trade/accounts",
        json={"broker": "info_yatirim", "starting_balance": 50000, "name": "Agresif"},
        headers=auth_headers,
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == "Agresif"

    accounts = client.get("/api/v1/trade/accounts", headers=auth_headers).json()
    assert len(accounts) == 2


def test_account_id_query_param_selects_the_right_account(client, auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    second = client.post(
        "/api/v1/trade/accounts", json={"broker": "midas", "starting_balance": 250000, "name": "İkinci"},
        headers=auth_headers,
    ).json()

    accounts = client.get("/api/v1/trade/accounts", headers=auth_headers).json()
    first_id = accounts[0]["id"]
    second_id = second["id"]

    default = client.get("/api/v1/trade/account", headers=auth_headers).json()
    assert default["id"] == first_id
    assert default["starting_balance"] == 100000

    explicit = client.get(f"/api/v1/trade/account?account_id={second_id}", headers=auth_headers).json()
    assert explicit["id"] == second_id
    assert explicit["starting_balance"] == 250000


def test_cannot_access_another_users_account(client, auth_headers, other_auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    other_account = client.post(
        "/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=other_auth_headers
    ).json()

    resp = client.get(f"/api/v1/trade/account?account_id={other_account['id']}", headers=auth_headers)
    assert resp.json() is None

    resp = client.get(f"/api/v1/trade/positions?account_id={other_account['id']}", headers=auth_headers)
    assert resp.status_code == 404


def test_rename_account(client, auth_headers):
    account = client.post(
        "/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers
    ).json()
    resp = client.put(f"/api/v1/trade/accounts/{account['id']}", json={"name": "Yeni İsim"}, headers=auth_headers)
    assert resp.status_code == 200
    assert resp.json()["name"] == "Yeni İsim"


def test_cannot_delete_last_remaining_account(client, auth_headers):
    account = client.post(
        "/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers
    ).json()
    resp = client.delete(f"/api/v1/trade/accounts/{account['id']}", headers=auth_headers)
    assert resp.status_code == 400


def test_can_delete_a_non_last_account(client, auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    second = client.post(
        "/api/v1/trade/accounts", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers
    ).json()

    resp = client.delete(f"/api/v1/trade/accounts/{second['id']}", headers=auth_headers)
    assert resp.status_code == 204
    accounts = client.get("/api/v1/trade/accounts", headers=auth_headers).json()
    assert len(accounts) == 1
