import pytest

from app.models.user import User


@pytest.fixture
def free_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "freeuser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login = client.post("/api/v1/auth/login", data={"username": "freeuser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def premium_headers(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "premiumuser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    db.query(User).filter(User.email == "premiumuser@example.com").update({"role": "premium"})
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "premiumuser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("path", [
    "/api/v1/trade/accounts",
    "/api/v1/trade/account",
    "/api/v1/trade/watchlist",
    "/api/v1/trade/viop-contracts",
    "/api/v1/trade/positions",
])
def test_free_tier_cannot_access_trade(client, free_headers, path):
    res = client.get(path, headers=free_headers)
    assert res.status_code == 403


@pytest.mark.parametrize("path", [
    "/api/v1/strategy/scan",
    "/api/v1/strategy/history",
    "/api/v1/strategy/backtest",
])
def test_free_tier_cannot_access_strategy(client, free_headers, path):
    res = client.get(path, headers=free_headers)
    assert res.status_code == 403


def test_premium_tier_can_access_trade(client, premium_headers):
    res = client.get("/api/v1/trade/accounts", headers=premium_headers)
    assert res.status_code == 200


def test_starter_tier_can_still_access_trade(client, db):
    # The gate is deliberately "free"-only (get_current_premium_user, the
    # same dependency already used elsewhere) - "standart ücretsiz üyeler"
    # (the free tier specifically) is what must be blocked, not every
    # non-premium paid tier, so starter/pro must still get through.
    client.post(
        "/api/v1/auth/register",
        json={"email": "starteruser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    db.query(User).filter(User.email == "starteruser@example.com").update({"role": "starter"})
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "starteruser@example.com", "password": "mypassword"})
    headers = {"Authorization": f"Bearer {login.json()['access_token']}"}

    res = client.get("/api/v1/trade/accounts", headers=headers)
    assert res.status_code == 200
