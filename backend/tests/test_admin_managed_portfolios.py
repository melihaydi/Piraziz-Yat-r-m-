import pytest

from app.models.user import User


@pytest.fixture
def admin_headers(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "portfolioadmin@example.com", "password": "mypassword", "terms_accepted": True},
    )
    user = db.query(User).filter(User.email == "portfolioadmin@example.com").first()
    user.is_superuser = True
    db.commit()

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "portfolioadmin@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def target_user(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "managedfriend@example.com", "password": "mypassword", "terms_accepted": True},
    )
    return db.query(User).filter(User.email == "managedfriend@example.com").first()


@pytest.fixture
def plain_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "plainuser2@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "plainuser2@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_non_superuser_cannot_access_managed_portfolios(client, plain_headers, target_user):
    res = client.get(f"/api/v1/admin/managed-portfolios/{target_user.id}", headers=plain_headers)
    assert res.status_code == 403


def test_get_managed_portfolio_auto_creates_default_portfolio(client, admin_headers, target_user):
    res = client.get(f"/api/v1/admin/managed-portfolios/{target_user.id}", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["user_email"] == "managedfriend@example.com"
    assert body["portfolio_name"] == "Ana Portföy"
    assert body["assets"] == []


def test_admin_can_add_asset_to_another_users_portfolio(client, admin_headers, target_user):
    res = client.post(
        f"/api/v1/admin/managed-portfolios/{target_user.id}/assets",
        json={"ticker": "thyao", "shares": 10, "average_cost": 300.0},
        headers=admin_headers,
    )
    assert res.status_code == 201
    asset = res.json()
    assert asset["ticker"] == "THYAO"
    assert asset["shares"] == 10

    # It shows up for the target user's own portfolio too - same
    # Portfolio/PortfolioAsset rows, no separate storage.
    fetch = client.get(f"/api/v1/admin/managed-portfolios/{target_user.id}", headers=admin_headers)
    assert len(fetch.json()["assets"]) == 1


def test_adding_same_ticker_twice_averages_cost(client, admin_headers, target_user):
    client.post(
        f"/api/v1/admin/managed-portfolios/{target_user.id}/assets",
        json={"ticker": "THYAO", "shares": 10, "average_cost": 300.0},
        headers=admin_headers,
    )
    res = client.post(
        f"/api/v1/admin/managed-portfolios/{target_user.id}/assets",
        json={"ticker": "THYAO", "shares": 10, "average_cost": 320.0},
        headers=admin_headers,
    )
    asset = res.json()
    assert asset["shares"] == 20
    assert asset["average_cost"] == pytest.approx(310.0)


def test_admin_can_update_and_delete_managed_asset(client, admin_headers, target_user):
    add_res = client.post(
        f"/api/v1/admin/managed-portfolios/{target_user.id}/assets",
        json={"ticker": "THYAO", "shares": 10, "average_cost": 300.0},
        headers=admin_headers,
    )
    asset_id = add_res.json()["id"]

    update_res = client.put(
        f"/api/v1/admin/managed-portfolios/assets/{asset_id}",
        json={"ticker": "THYAO", "shares": 5, "average_cost": 280.0},
        headers=admin_headers,
    )
    assert update_res.status_code == 200
    assert update_res.json()["shares"] == 5
    assert update_res.json()["average_cost"] == 280.0

    delete_res = client.delete(f"/api/v1/admin/managed-portfolios/assets/{asset_id}", headers=admin_headers)
    assert delete_res.status_code == 204

    fetch = client.get(f"/api/v1/admin/managed-portfolios/{target_user.id}", headers=admin_headers)
    assert fetch.json()["assets"] == []


def test_non_superuser_cannot_add_managed_asset(client, plain_headers, target_user):
    res = client.post(
        f"/api/v1/admin/managed-portfolios/{target_user.id}/assets",
        json={"ticker": "THYAO", "shares": 10, "average_cost": 300.0},
        headers=plain_headers,
    )
    assert res.status_code == 403
