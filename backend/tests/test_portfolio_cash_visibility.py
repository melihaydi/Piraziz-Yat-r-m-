import pytest

from app.models.portfolio import Portfolio


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "cashvisibleuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "cashvisibleuser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_portfolio(client, auth_headers, name="Ana Portföy"):
    return client.post("/api/v1/portfolio/", json={"name": name}, headers=auth_headers).json()["id"]


def test_cash_balance_set_by_admin_is_visible_on_own_portfolio(client, db, auth_headers):
    # Regression test: GET /portfolio/ previously never read
    # Portfolio.cash_balance/viop_margin at all (always defaulted to 0.0
    # via the schema default), so an admin depositing cash/VİOP teminatı
    # via Yönetilen Portföyler was saved to the DB correctly but never
    # showed up for the user on their own Portföyüm page - confirmed live.
    portfolio_id = _create_portfolio(client, auth_headers)
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    portfolio.cash_balance = 5000.0
    portfolio.viop_margin = 1500.0
    db.commit()

    response = client.get("/api/v1/portfolio/", headers=auth_headers)
    body = response.json()[0]
    assert body["cash_balance"] == 5000.0
    assert body["viop_margin"] == 1500.0
    # Both fold 1:1 into total_cost/total_value, same as admin.py's
    # get_managed_portfolio - no assets yet, so both equal the sum and
    # profit stays 0.
    assert body["total_cost"] == 6500.0
    assert body["total_value"] == 6500.0
    assert body["total_profit"] == 0.0
