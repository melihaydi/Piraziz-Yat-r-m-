from unittest.mock import patch

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


def test_usd_cash_balance_converts_to_tl_at_live_rate_on_own_portfolio(client, db, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    portfolio = db.query(Portfolio).filter(Portfolio.id == portfolio_id).first()
    portfolio.usd_cash_balance = 220.0
    db.commit()

    with patch(
        "app.api.v1.endpoints.portfolio.market_data_service.get_quote",
        return_value={"last": 40.0},
    ):
        response = client.get("/api/v1/portfolio/", headers=auth_headers)

    body = response.json()[0]
    assert body["usd_cash_balance"] == 220.0
    assert body["usd_cash_value_try"] == pytest.approx(8800.0)
    assert body["total_cost"] == pytest.approx(8800.0)
    assert body["total_value"] == pytest.approx(8800.0)
    assert body["total_profit"] == pytest.approx(0.0)


def _mock_usd_rate(rate: float):
    return patch(
        "app.api.v1.endpoints.portfolio.market_data_service.get_quote",
        return_value={"last": rate},
    )


def test_user_can_deposit_usd_cash_into_own_portfolio(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    with _mock_usd_rate(40.0):
        res = client.post(
            f"/api/v1/portfolio/{portfolio_id}/usd-cash",
            json={"amount": 220.0},
            headers=auth_headers,
        )
        assert res.status_code == 200
        assert res.json()["usd_cash_balance"] == 220.0
        assert res.json()["usd_cash_value_try"] == pytest.approx(8800.0)

        fetch = client.get("/api/v1/portfolio/", headers=auth_headers)
    assert fetch.json()[0]["usd_cash_balance"] == 220.0


def test_user_can_withdraw_own_usd_cash(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    with _mock_usd_rate(40.0):
        client.post(f"/api/v1/portfolio/{portfolio_id}/usd-cash", json={"amount": 500.0}, headers=auth_headers)
        res = client.post(f"/api/v1/portfolio/{portfolio_id}/usd-cash", json={"amount": -200.0}, headers=auth_headers)
    assert res.status_code == 200
    assert res.json()["usd_cash_balance"] == 300.0


def test_user_cannot_withdraw_more_usd_cash_than_available(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    with _mock_usd_rate(40.0):
        client.post(f"/api/v1/portfolio/{portfolio_id}/usd-cash", json={"amount": 100.0}, headers=auth_headers)
        res = client.post(f"/api/v1/portfolio/{portfolio_id}/usd-cash", json={"amount": -500.0}, headers=auth_headers)
    assert res.status_code == 400


def test_user_cannot_adjust_usd_cash_on_someone_elses_portfolio(client, auth_headers):
    client.post(
        "/api/v1/auth/register",
        json={"email": "otherusdcashuser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    other_login = client.post(
        "/api/v1/auth/login",
        data={"username": "otherusdcashuser@example.com", "password": "mypassword"},
    )
    other_headers = {"Authorization": f"Bearer {other_login.json()['access_token']}"}
    other_portfolio_id = _create_portfolio(client, other_headers, name="Başkasının Portföyü")

    res = client.post(
        f"/api/v1/portfolio/{other_portfolio_id}/usd-cash",
        json={"amount": 100.0},
        headers=auth_headers,
    )
    assert res.status_code == 404


def test_zero_amount_usd_cash_adjustment_rejected_self_service(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    res = client.post(f"/api/v1/portfolio/{portfolio_id}/usd-cash", json={"amount": 0.0}, headers=auth_headers)
    assert res.status_code == 400
