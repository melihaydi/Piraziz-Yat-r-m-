import pytest

@pytest.fixture(scope="function")
def auth_headers(client):
    # Register a user
    client.post(
        "/api/v1/auth/register",
        json={"email": "portuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    # Login to get token
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "portuser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}

def test_create_and_get_portfolio(client, auth_headers):
    # Create portfolio
    response_create = client.post(
        "/api/v1/portfolio/",
        json={"name": "Hisse Portföyüm"},
        headers=auth_headers
    )
    assert response_create.status_code == 201
    data_create = response_create.json()
    assert data_create["name"] == "Hisse Portföyüm"
    assert "id" in data_create

    # Get portfolios
    response_get = client.get("/api/v1/portfolio/", headers=auth_headers)
    assert response_get.status_code == 200
    data_get = response_get.json()
    assert len(data_get) == 1
    assert data_get[0]["name"] == "Hisse Portföyüm"
    assert data_get[0]["total_cost"] == 0.0

def test_portfolio_assets_weighted_average(client, auth_headers):
    # Create portfolio
    p_create = client.post(
        "/api/v1/portfolio/",
        json={"name": "Yatırım 2026"},
        headers=auth_headers
    ).json()
    p_id = p_create["id"]

    # Add asset 1: 10 shares of THYAO at 300.00
    asset_1 = client.post(
        f"/api/v1/portfolio/{p_id}/assets",
        json={"ticker": "THYAO", "shares": 10.0, "average_cost": 300.00},
        headers=auth_headers
    )
    assert asset_1.status_code == 201
    data_a1 = asset_1.json()
    assert data_a1["ticker"] == "THYAO"
    assert data_a1["shares"] == 10.0
    assert data_a1["average_cost"] == 300.00

    # Add asset 2 (same ticker): 20 shares of THYAO at 315.00
    # Expected weighted average cost = (10 * 300 + 20 * 315) / 30 = (3000 + 6300) / 30 = 9300 / 30 = 310.00
    asset_2 = client.post(
        f"/api/v1/portfolio/{p_id}/assets",
        json={"ticker": "THYAO", "shares": 20.0, "average_cost": 315.00},
        headers=auth_headers
    )
    assert asset_2.status_code == 201
    data_a2 = asset_2.json()
    assert data_a2["ticker"] == "THYAO"
    assert data_a2["shares"] == 30.0
    assert data_a2["average_cost"] == pytest.approx(310.00)

    # Get portfolios to verify totals are aggregated
    p_list = client.get("/api/v1/portfolio/", headers=auth_headers).json()
    assert p_list[0]["total_cost"] == 30.0 * 310.00

def test_alerts_crud(client, auth_headers):
    # Create alert
    alert_response = client.post(
        "/api/v1/alert/",
        json={
            "ticker": "EREGL",
            "alert_type": "price",
            "trigger_condition": {"operator": ">", "value": 55.50}
        },
        headers=auth_headers
    )
    assert alert_response.status_code == 201
    data_alert = alert_response.json()
    assert data_alert["ticker"] == "EREGL"
    assert data_alert["is_active"] is True
    alert_id = data_alert["id"]

    # Get user alerts
    alerts_get = client.get("/api/v1/alert/", headers=auth_headers)
    assert alerts_get.status_code == 200
    assert len(alerts_get.json()) == 1

    # Toggle alert
    toggle_response = client.post(f"/api/v1/alert/{alert_id}/toggle", headers=auth_headers)
    assert toggle_response.status_code == 200
    assert toggle_response.json()["is_active"] is False

    # Delete alert
    delete_response = client.delete(f"/api/v1/alert/{alert_id}", headers=auth_headers)
    assert delete_response.status_code == 204

    # Verify deleted
    alerts_after = client.get("/api/v1/alert/", headers=auth_headers).json()
    assert len(alerts_after) == 0
