"""Portfoy seviyesi alarmlar: portfoyun butune bakan tipler."""
import datetime
from unittest.mock import patch

import pytest

from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "palert@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "palert@example.com", "password": "mypassword"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="function")
def seeded_portfolio(client, db, auth_headers):
    """100 lot @ 100 TL maliyetli tek pozisyon, onceki gun degeri 10.000."""
    me = client.get("/api/v1/auth/me", headers=auth_headers).json()
    p = Portfolio(user_id=me["id"], name="Test")
    db.add(p)
    db.commit()
    db.refresh(p)
    db.add(PortfolioAsset(portfolio_id=p.id, ticker="THYAO", shares=100, average_cost=100.0))
    db.add(PortfolioSnapshot(
        user_id=me["id"], snapshot_date=datetime.date(2026, 1, 1), total_value=10000.0,
    ))
    db.commit()
    return p


def _create_alert(client, headers, alert_type, operator, value):
    return client.post(
        "/api/v1/alert/",
        json={"alert_type": alert_type, "trigger_condition": {"operator": operator, "value": value}},
        headers=headers,
    )


def test_portfolio_change_alert_triggers_on_drop(client, auth_headers, seeded_portfolio):
    """Portfoy 10.000'den 9.000'e dustu (-%10); "-%5'ten fazla dustu" alarmi
    tetiklenmeli."""
    _create_alert(client, auth_headers, "portfolio_change", "<", -5)

    # 100 lot * 90 TL = 9.000
    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=90.0), \
         patch("app.services.alert_notifier._executor", _Sync()), \
         patch("app.core.email.send_email"), patch("app.core.push.send_push_to_subscriptions"):
        res = client.post("/api/v1/alert/check", headers=auth_headers)

    assert res.status_code == 200
    assert len(res.json()) == 1


def test_portfolio_change_alert_does_not_trigger_on_small_move(client, auth_headers, seeded_portfolio):
    _create_alert(client, auth_headers, "portfolio_change", "<", -5)

    # 100 lot * 99 TL = 9.900 -> sadece -%1
    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=99.0), \
         patch("app.services.alert_notifier._executor", _Sync()), \
         patch("app.core.email.send_email"):
        res = client.post("/api/v1/alert/check", headers=auth_headers)

    assert res.json() == []


def test_position_loss_alert_triggers(client, auth_headers, seeded_portfolio):
    """Maliyet 100, fiyat 75 -> pozisyon %25 zararda."""
    _create_alert(client, auth_headers, "position_loss", "<", -20)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=75.0), \
         patch("app.services.alert_notifier._executor", _Sync()), \
         patch("app.core.email.send_email"), patch("app.core.push.send_push_to_subscriptions"):
        res = client.post("/api/v1/alert/check", headers=auth_headers)

    assert len(res.json()) == 1


def test_portfolio_alert_is_skipped_without_a_baseline_snapshot(client, db, auth_headers):
    """Karsilastirilacak onceki kayit yoksa alarm tetiklenmemeli - sifir
    kabul edip tetiklemek yanlis olurdu."""
    me = client.get("/api/v1/auth/me", headers=auth_headers).json()
    p = Portfolio(user_id=me["id"], name="Test")
    db.add(p)
    db.commit()
    db.refresh(p)
    db.add(PortfolioAsset(portfolio_id=p.id, ticker="THYAO", shares=100, average_cost=100.0))
    db.commit()

    _create_alert(client, auth_headers, "portfolio_change", "<", -5)

    with patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=10.0), \
         patch("app.core.email.send_email"):
        res = client.post("/api/v1/alert/check", headers=auth_headers)

    assert res.json() == []


def test_portfolio_alert_ignored_when_user_has_no_assets(client, auth_headers):
    _create_alert(client, auth_headers, "portfolio_change", "<", -5)
    with patch("app.core.email.send_email"):
        res = client.post("/api/v1/alert/check", headers=auth_headers)
    assert res.json() == []


class _Sync:
    def submit(self, fn, *args, **kwargs):
        fn(*args, **kwargs)
