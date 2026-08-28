from unittest.mock import patch

import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "lookthroughuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "lookthroughuser@example.com", "password": "mypassword"}
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


def test_empty_portfolio_returns_no_exposure(client, auth_headers):
    response = client.get("/api/v1/portfolio/look-through", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"total_value": 0.0, "resolved_value_pct": 0.0, "holdings": []}


def test_look_through_requires_auth(client):
    response = client.get("/api/v1/portfolio/look-through")
    assert response.status_code == 401


def test_direct_stock_only_has_no_indirect_exposure(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0):
        response = client.get("/api/v1/portfolio/look-through", headers=auth_headers)

    data = response.json()
    assert data["total_value"] == pytest.approx(3200.0)
    holding = data["holdings"][0]
    assert holding["ticker"] == "THYAO"
    assert holding["value"] == pytest.approx(3200.0)
    assert holding["direct_value"] == pytest.approx(3200.0)
    assert holding["indirect_value"] == pytest.approx(0.0)
    assert holding["concentration_flag"] is False


def test_fund_holdings_combine_with_direct_position_and_flag_concentration(client, auth_headers):
    # THYAO: 10 shares @ 320 -> 3200 direct
    # PHE (fund): 100 shares @ 4.0 -> 400, %50 THYAO + %30 GARAN (%20 nakit/diğer, çözülemez)
    # ABC (fund): 100 shares @ 10.0 -> 1000, %80 THYAO
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)
    _add_asset(client, auth_headers, portfolio_id, "ABC", 100.0, 9.0)

    def fake_fetch_live_price(ticker, delay_minutes=0):
        return {"THYAO": 320.0, "PHE": 4.0, "ABC": 10.0}[ticker.upper()]

    def fake_get_live_estimated_return(code, _visited=None, delay_minutes=0):
        code = code.upper()
        if code == "PHE":
            return {
                "code": "PHE", "estimated_change_pct": 1.0, "resolved_weight_pct": 80.0,
                "holdings": [
                    {"ticker": "THYAO", "weight": 50.0, "change_pct": 1.0, "type": "stock"},
                    {"ticker": "GARAN", "weight": 30.0, "change_pct": 0.5, "type": "stock"},
                ],
            }
        if code == "ABC":
            return {
                "code": "ABC", "estimated_change_pct": 1.0, "resolved_weight_pct": 80.0,
                "holdings": [
                    {"ticker": "THYAO", "weight": 80.0, "change_pct": 1.0, "type": "stock"},
                ],
            }
        return None

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", side_effect=fake_fetch_live_price), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", side_effect=fake_get_live_estimated_return):
        response = client.get("/api/v1/portfolio/look-through", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()

    # total_value = 3200 (THYAO) + 400 (PHE) + 1000 (ABC) = 4600
    assert data["total_value"] == pytest.approx(4600.0)

    thyao = next(h for h in data["holdings"] if h["ticker"] == "THYAO")
    garan = next(h for h in data["holdings"] if h["ticker"] == "GARAN")

    # THYAO: direkt 3200 + PHE'den 400*0.5=200 + ABC'den 1000*0.8=800 = 4200 toplam
    assert thyao["direct_value"] == pytest.approx(3200.0)
    assert thyao["indirect_value"] == pytest.approx(1000.0)
    assert thyao["value"] == pytest.approx(4200.0)
    # indirect payı toplamın %15'ini geçiyor (1000/4600 ~= %21.7) -> flaglenmeli
    assert thyao["concentration_flag"] is True

    # GARAN sadece PHE üzerinden geliyor: 400*0.3=120, toplamın ~%2.6'sı -> flaglenmemeli
    assert garan["direct_value"] == pytest.approx(0.0)
    assert garan["indirect_value"] == pytest.approx(120.0)
    assert garan["concentration_flag"] is False

    # Holdings value'ya göre azalan sıralı olmalı
    values = [h["value"] for h in data["holdings"]]
    assert values == sorted(values, reverse=True)


def test_fund_of_fund_is_expanded_recursively(client, auth_headers):
    # PHE: 100 shares @ 4.0 -> 400, %30 THYAO (doğrudan) + %40 XYZ (başka bir fon)
    # XYZ: kendi kompozisyonunda %90 GARAN
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    def fake_get_live_estimated_return(code, _visited=None, delay_minutes=0):
        code = code.upper()
        if code == "PHE":
            return {
                "code": "PHE", "estimated_change_pct": 1.0, "resolved_weight_pct": 70.0,
                "holdings": [
                    {"ticker": "THYAO", "weight": 30.0, "change_pct": 1.0, "type": "stock"},
                    {"ticker": "XYZ", "weight": 40.0, "change_pct": 0.5, "type": "fund"},
                ],
            }
        if code == "XYZ":
            return {
                "code": "XYZ", "estimated_change_pct": 0.5, "resolved_weight_pct": 90.0,
                "holdings": [
                    {"ticker": "GARAN", "weight": 90.0, "change_pct": 0.5, "type": "stock"},
                ],
            }
        return None

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", side_effect=fake_get_live_estimated_return):
        response = client.get("/api/v1/portfolio/look-through", headers=auth_headers)

    data = response.json()
    total = 400.0  # 100 * 4.0

    thyao = next(h for h in data["holdings"] if h["ticker"] == "THYAO")
    garan = next(h for h in data["holdings"] if h["ticker"] == "GARAN")
    assert thyao["value"] == pytest.approx(total * 0.30)
    # GARAN, PHE -> XYZ -> GARAN zincirinden geliyor: 400 * 0.40 * 0.90 = 144
    assert garan["value"] == pytest.approx(total * 0.40 * 0.90)
    assert "XYZ" not in [h["ticker"] for h in data["holdings"]]


def test_fund_with_unresolvable_composition_falls_back_to_own_ticker(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "PHE", 100.0, 3.50)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=4.0), \
         patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=None):
        response = client.get("/api/v1/portfolio/look-through", headers=auth_headers)

    data = response.json()
    assert len(data["holdings"]) == 1
    holding = data["holdings"][0]
    assert holding["ticker"] == "PHE"
    assert holding["value"] == pytest.approx(400.0)
    assert holding["direct_value"] == pytest.approx(0.0)
    assert holding["indirect_value"] == pytest.approx(400.0)
