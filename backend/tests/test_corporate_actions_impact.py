from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest

from app.models.kap import KapNotification
from app.models.portfolio import PortfolioAsset
from app.services import corporate_actions


# --- estimate_position_impact (birim testler) -------------------------------

class _FakeAsset:
    def __init__(self, id=1, portfolio_id=1, ticker="KTLEV", shares=100.0, average_cost=10.0):
        self.id = id
        self.portfolio_id = portfolio_id
        self.ticker = ticker
        self.shares = shares
        self.average_cost = average_cost


def test_estimate_position_impact_known_ratio():
    # %138.16 bedelsiz -> 2.3816x: 100 lot -> 238.16 lot, maliyet /2.3816
    asset = _FakeAsset(shares=100.0, average_cost=10.0)
    impact = corporate_actions.estimate_position_impact(asset, ratio=2.3816)

    assert impact["ticker"] == "KTLEV"
    assert impact["current_shares"] == 100.0
    assert impact["estimated_new_shares"] == pytest.approx(238.16, abs=0.01)
    assert impact["estimated_new_average_cost"] == pytest.approx(10.0 / 2.3816, abs=0.0001)
    assert impact["ratio"] == 2.3816


def test_estimate_position_impact_does_not_mutate_asset():
    # Salt-okunur önizleme - asset'in kendisi DEĞİŞMEMELİ (plan_adjustments/
    # apply_action'dan farklı olarak burada hiçbir DB yazımı yok).
    asset = _FakeAsset(shares=100.0, average_cost=10.0)
    corporate_actions.estimate_position_impact(asset, ratio=2.0)

    assert asset.shares == 100.0
    assert asset.average_cost == 10.0


def test_estimate_position_impact_rejects_non_positive_ratio():
    asset = _FakeAsset()
    with pytest.raises(ValueError):
        corporate_actions.estimate_position_impact(asset, ratio=0)
    with pytest.raises(ValueError):
        corporate_actions.estimate_position_impact(asset, ratio=-1.5)


# --- GET /portfolio/analytics'in kap_position_impacts alanı (entegrasyon) ---

@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "kapimpactuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "kapimpactuser@example.com", "password": "mypassword"}
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


def test_analytics_includes_impact_for_held_ticker_with_bonus_notice(client, auth_headers, db):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "EREGL", 200.0, 40.0)

    db.add(KapNotification(
        id="kap-1", ticker="EREGL", title="EREGL %50 oranında bedelsiz sermaye artırımı",
        publish_date=datetime.now(timezone.utc) - timedelta(days=2),
    ))
    db.commit()

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=45.0):
        response = client.get("/api/v1/portfolio/analytics", headers=auth_headers)

    assert response.status_code == 200
    data = response.json()
    impacts = data["kap_position_impacts"]
    assert len(impacts) == 1
    impact = impacts[0]
    assert impact["ticker"] == "EREGL"
    assert impact["ratio"] == pytest.approx(1.5)
    assert impact["current_shares"] == 200.0
    assert impact["estimated_new_shares"] == pytest.approx(300.0)
    assert impact["estimated_new_average_cost"] == pytest.approx(40.0 / 1.5, abs=0.0001)
    assert impact["title"] == "EREGL %50 oranında bedelsiz sermaye artırımı"


def test_analytics_omits_impact_for_ticker_not_held(client, auth_headers, db):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    # Bedelsiz bildirimi VAR ama kullanıcı bu tickerı TUTMUYOR.
    db.add(KapNotification(
        id="kap-2", ticker="EREGL", title="EREGL %50 oranında bedelsiz sermaye artırımı",
        publish_date=datetime.now(timezone.utc) - timedelta(days=2),
    ))
    db.commit()

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0):
        response = client.get("/api/v1/portfolio/analytics", headers=auth_headers)

    assert response.json()["kap_position_impacts"] == []


def test_analytics_omits_impact_when_no_matching_notice(client, auth_headers):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "THYAO", 10.0, 300.0)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0):
        response = client.get("/api/v1/portfolio/analytics", headers=auth_headers)

    assert response.json()["kap_position_impacts"] == []


def test_analytics_omits_impact_when_ratio_unparseable(client, auth_headers, db):
    portfolio_id = _create_portfolio(client, auth_headers)
    _add_asset(client, auth_headers, portfolio_id, "EREGL", 200.0, 40.0)

    # "bedelsiz" geçiyor ama yakalanabilir bir yüzde yok -> suggested_ratio None.
    db.add(KapNotification(
        id="kap-3", ticker="EREGL", title="EREGL bedelsiz sermaye artırımı görüşülecek",
        publish_date=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    db.commit()

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=45.0):
        response = client.get("/api/v1/portfolio/analytics", headers=auth_headers)

    assert response.json()["kap_position_impacts"] == []
