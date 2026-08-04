from unittest.mock import patch

import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "priceadjustuser@example.com", "password": "mypassword"}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "priceadjustuser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_portfolio(client, auth_headers, name="Ana Portföy"):
    return client.post("/api/v1/portfolio/", json={"name": name}, headers=auth_headers).json()["id"]


def _add_asset(client, auth_headers, portfolio_id, ticker, shares, average_cost):
    resp = client.post(
        f"/api/v1/portfolio/{portfolio_id}/assets",
        json={"ticker": ticker, "shares": shares, "average_cost": average_cost},
        headers=auth_headers,
    )
    assert resp.status_code == 201


def test_fund_holding_current_price_always_stays_the_real_nav(client, auth_headers):
    # current_price/total_value must ALWAYS be the real, officially
    # published NAV - the user was explicit that the live estimate must
    # never be mixed into the "official" numbers shown for a holding, even
    # when a trustworthy estimate is available.
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    trusted_estimate = {"estimated_change_pct": 5.0, "resolved_weight_pct": 80.0, "holdings": []}
    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=trusted_estimate):
        response = client.get("/api/v1/portfolio/", headers=auth_headers)

    asset = response.json()[0]["assets"][0]
    assert asset["current_price"] == pytest.approx(4.0)
    assert asset["total_value"] == pytest.approx(100.0 * 4.0)


def test_fund_holding_exposes_estimate_as_a_separate_daily_field(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    trusted_estimate = {"estimated_change_pct": 5.0, "resolved_weight_pct": 80.0, "holdings": []}
    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=trusted_estimate):
        response = client.get("/api/v1/portfolio/", headers=auth_headers)

    asset = response.json()[0]["assets"][0]
    assert asset["daily_change_pct"] == 5.0
    assert asset["daily_change_is_estimate"] is True
    assert asset["daily_gain_value"] == pytest.approx(100.0 * 4.0 * 0.05)


def test_fund_holding_daily_change_is_none_when_estimate_untrusted(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    untrusted_estimate = {"estimated_change_pct": 5.0, "resolved_weight_pct": 5.0, "holdings": []}
    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=untrusted_estimate):
        response = client.get("/api/v1/portfolio/", headers=auth_headers)

    asset = response.json()[0]["assets"][0]
    assert asset["current_price"] == pytest.approx(4.0)
    assert asset["daily_change_pct"] is None
    assert asset["daily_change_is_estimate"] is False
    assert asset["daily_gain_value"] is None


def test_stock_holding_gets_a_real_daily_change_not_an_estimate(client, auth_headers):
    # Stocks get a REAL daily change (from the live quote), not modeled -
    # daily_change_is_estimate must be False even though the field is populated.
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0), \
         patch("app.services.market_data.market_data_service.is_known_ticker", return_value=True), \
         patch("app.services.market_data.market_data_service.get_quote", return_value={"change_percent": 2.5}), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return") as mock_estimate:
        response = client.get("/api/v1/portfolio/", headers=auth_headers)
        mock_estimate.assert_not_called()

    asset = response.json()[0]["assets"][0]
    assert asset["current_price"] == pytest.approx(320.0)
    assert asset["daily_change_pct"] == 2.5
    assert asset["daily_change_is_estimate"] is False
    assert asset["daily_gain_value"] == pytest.approx(10.0 * 320.0 * 0.025)


def test_stock_holding_daily_change_is_none_for_unknown_ticker(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0), \
         patch("app.services.market_data.market_data_service.is_known_ticker", return_value=False):
        response = client.get("/api/v1/portfolio/", headers=auth_headers)

    asset = response.json()[0]["assets"][0]
    assert asset["daily_change_pct"] is None
    assert asset["daily_gain_value"] is None
