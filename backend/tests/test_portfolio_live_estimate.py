from unittest.mock import patch

import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "liveestimateuser@example.com", "password": "mypassword"}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "liveestimateuser@example.com", "password": "mypassword"}
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


def test_empty_portfolio_returns_no_estimate(client, auth_headers):
    response = client.get("/api/v1/portfolio/live-estimate", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {
        "estimated_change_pct": None, "estimated_daily_gain_value": None,
        "resolved_value_pct": 0.0, "total_value": 0.0, "holdings": []
    }


def test_stock_and_fund_holdings_weighted_by_current_value(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    # THYAO: 10 shares @ 300 cost, live price 320 -> value 3200
    # PHE (a tracked fund with a known composition): 100 shares @ 3.50 cost
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    def fake_fetch_live_price(ticker):
        return {"THYAO": 320.0, "PHE": 4.0}[ticker.upper()]

    fake_estimate = {"estimated_change_pct": 2.0, "resolved_weight_pct": 80.0, "holdings": []}

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", side_effect=fake_fetch_live_price), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=fake_estimate):
        response = client.get("/api/v1/portfolio/live-estimate", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()

    thyao_value = 10.0 * 320.0  # 3200
    phe_value = 100.0 * 4.0  # 400
    total = thyao_value + phe_value  # 3600

    assert data["total_value"] == pytest.approx(total)
    thyao_holding = next(h for h in data["holdings"] if h["ticker"] == "THYAO")
    phe_holding = next(h for h in data["holdings"] if h["ticker"] == "PHE")
    assert phe_holding["type"] == "fund_live"
    assert phe_holding["change_pct"] == 2.0
    assert thyao_holding["type"] == "stock"

    # estimated_change_pct is the VALUE-weighted average, not a simple mean
    expected = (thyao_holding["change_pct"] * thyao_value + 2.0 * phe_value) / total
    assert data["estimated_change_pct"] == pytest.approx(round(expected, 2), abs=0.01)

    # estimated_daily_gain_value is the actual TL amount the estimate
    # implies today - derived from the raw weighted sum, not a re-multiply
    # of the already-rounded % above (avoids compounding rounding error).
    expected_tl = (thyao_holding["change_pct"] * thyao_value + 2.0 * phe_value) / 100
    assert data["estimated_daily_gain_value"] == pytest.approx(round(expected_tl, 2), abs=0.01)


def test_estimated_daily_gain_value_is_none_when_nothing_resolved(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0), \
         patch("app.services.market_data.market_data_service.is_known_ticker", return_value=False):
        response = client.get("/api/v1/portfolio/live-estimate", headers=auth_headers)

    data = response.json()
    assert data["estimated_daily_gain_value"] is None


def test_fund_without_trusted_recursive_estimate_falls_back_to_daily_return(client, auth_headers):
    # A fund whose own composition isn't resolvable enough to trust (below
    # the 20% threshold) must fall back to its last real TEFAS daily_return
    # rather than a near-empty recursive estimate - same rule the funds
    # live-estimate endpoint and tefas.py's own recursion use.
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    untrusted_estimate = {"estimated_change_pct": 0.0, "resolved_weight_pct": 5.0, "holdings": []}
    fake_fund = {"code": "PHE", "daily_return": -1.65}

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=untrusted_estimate), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=fake_fund):
        response = client.get("/api/v1/portfolio/live-estimate", headers=auth_headers)

    data = response.json()
    phe_holding = next(h for h in data["holdings"] if h["ticker"] == "PHE")
    assert phe_holding["type"] == "fund_daily"
    assert phe_holding["change_pct"] == -1.65
    assert data["estimated_change_pct"] == pytest.approx(-1.65)


def test_unresolvable_holding_excluded_from_resolved_value_pct(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0), \
         patch("app.services.market_data.market_data_service.is_known_ticker", return_value=False):
        response = client.get("/api/v1/portfolio/live-estimate", headers=auth_headers)

    data = response.json()
    assert data["resolved_value_pct"] == 0.0
    assert data["estimated_change_pct"] is None
    holding = data["holdings"][0]
    assert holding["type"] == "unresolved"
    assert holding["change_pct"] is None
