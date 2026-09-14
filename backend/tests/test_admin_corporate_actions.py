"""Admin kurumsal işlemler uçları.

Servis katmanı (plan_adjustments / apply_action) zaten
test_corporate_actions_impact.py'de test ediliyor. Burada test edilen şey
ADMIN EKRANININ dayandığı sözleşme: yetki kapısı, önizlemenin hiçbir şeyi
değiştirmediği ve her planın kimin pozisyonu olduğunu söylediği
(_plan_owners). Ekran "portföy #37" yerine e-posta gösterdiği için bu
alanların sessizce kaybolması arayüzü boş isimli satırlara düşürür.
"""
from datetime import date, datetime, timezone

import pytest

from app.models.portfolio import Portfolio, PortfolioAsset
from app.models.user import User
from app.services import corporate_actions


TEST_ACTION = corporate_actions.CorporateAction(
    ticker="ZZTST",
    ratio=2.0,
    ex_date=date(2026, 1, 15),
    description="Test bedelsiz %100",
)


@pytest.fixture
def patched_actions(monkeypatch):
    """Gerçek CORPORATE_ACTIONS listesi (KTLEV) yerine sabit bir test
    işlemi - canlı listeye yeni bir satır eklendiğinde bu testlerin
    kırılmaması için."""
    monkeypatch.setattr(corporate_actions, "CORPORATE_ACTIONS", [TEST_ACTION])
    return TEST_ACTION


def _register(client, email, password="mypassword"):
    client.post("/api/v1/auth/register",
                json={"email": email, "password": password, "terms_accepted": True})
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture
def admin_headers(client, db):
    _register(client, "caadmin@example.com")
    db.query(User).filter(User.email == "caadmin@example.com").update({"is_superuser": True})
    db.commit()
    # Rolü değişti - yeni token al.
    return _register(client, "caadmin@example.com")


@pytest.fixture
def holder(client, db):
    """ZZTST taşıyan bir pozisyona sahip normal kullanıcı."""
    _register(client, "caholder@example.com")
    user = db.query(User).filter(User.email == "caholder@example.com").first()
    portfolio = Portfolio(user_id=user.id, name="Test")
    db.add(portfolio)
    db.commit()
    asset = PortfolioAsset(
        portfolio_id=portfolio.id, ticker="ZZTST", shares=100.0, average_cost=10.0
    )
    db.add(asset)
    db.commit()
    # created_at ex-date'ten ÖNCE olmalı: plan_adjustments, ex-date'ten sonra
    # açılmış bir pozisyona bilinçli olarak dokunmuyor (o lotlar zaten
    # düzeltilmiş fiyattan alınmıştır). server_default=now() bugünü yazdığı
    # için elle geriye çekiliyor.
    db.query(PortfolioAsset).filter(PortfolioAsset.id == asset.id).update(
        {"created_at": datetime(2025, 12, 1, tzinfo=timezone.utc)}
    )
    db.commit()
    return user


def test_list_requires_superuser(client, db, patched_actions):
    plain = _register(client, "caplain@example.com")
    assert client.get("/api/v1/admin/corporate-actions", headers=plain).status_code == 403
    assert client.get("/api/v1/admin/corporate-actions").status_code == 401


def test_list_reports_affected_position_count(client, admin_headers, holder, patched_actions):
    res = client.get("/api/v1/admin/corporate-actions", headers=admin_headers)
    assert res.status_code == 200
    actions = res.json()["actions"]
    assert len(actions) == 1
    assert actions[0]["ticker"] == "ZZTST"
    assert actions[0]["ratio"] == 2.0
    assert actions[0]["total_positions"] == 1
    assert actions[0]["affected_count"] == 1


def test_preview_names_the_owner_and_changes_nothing(client, db, admin_headers, holder, patched_actions):
    res = client.get("/api/v1/admin/corporate-actions/ZZTST/preview", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()

    plan = body["plans"][0]
    # Ekranın "portföy #37" yerine e-posta göstermesini sağlayan alanlar.
    assert plan["user_id"] == holder.id
    assert plan["user_email"] == "caholder@example.com"
    assert plan["current_shares"] == 100.0
    assert plan["new_shares"] == 200.0
    assert plan["new_average_cost"] == 5.0
    assert plan["applicable"] is True

    # Önizleme salt-okunur: pozisyon DEĞİŞMEMELİ.
    db.expire_all()
    asset = db.query(PortfolioAsset).filter(PortfolioAsset.ticker == "ZZTST").first()
    assert asset.shares == 100.0
    assert asset.average_cost == 10.0


def test_preview_404_for_unknown_ticker(client, admin_headers, patched_actions):
    res = client.get("/api/v1/admin/corporate-actions/YOKBOYLE/preview", headers=admin_headers)
    assert res.status_code == 404


def test_apply_updates_position_and_is_idempotent(client, db, admin_headers, holder, patched_actions):
    res = client.post("/api/v1/admin/corporate-actions/ZZTST/apply", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["applied_count"] == 1
    assert body["plans"][0]["user_email"] == "caholder@example.com"

    db.expire_all()
    asset = db.query(PortfolioAsset).filter(PortfolioAsset.ticker == "ZZTST").first()
    assert asset.shares == pytest.approx(200.0)
    assert asset.average_cost == pytest.approx(5.0)

    # Tekrar çalıştırmak güvenli olmalı: aynı bedelsiz iki kez uygulanırsa
    # kullanıcının lotu iki katına çıkar ve bu geri alınamaz.
    res2 = client.post("/api/v1/admin/corporate-actions/ZZTST/apply", headers=admin_headers)
    assert res2.status_code == 200
    assert res2.json()["applied_count"] == 0
    assert res2.json()["skipped_count"] == 1

    db.expire_all()
    asset = db.query(PortfolioAsset).filter(PortfolioAsset.ticker == "ZZTST").first()
    assert asset.shares == pytest.approx(200.0)


def test_apply_requires_superuser(client, patched_actions):
    plain = _register(client, "caplain2@example.com")
    assert client.post("/api/v1/admin/corporate-actions/ZZTST/apply", headers=plain).status_code == 403


def test_kap_candidates_requires_superuser(client, patched_actions):
    plain = _register(client, "caplain3@example.com")
    assert client.get("/api/v1/admin/corporate-actions/kap-candidates", headers=plain).status_code == 403


def test_kap_candidates_route_is_not_shadowed_by_ticker_route(client, admin_headers, patched_actions):
    """`/kap-candidates` literal yolu `/{ticker}/preview`'dan ÖNCE
    tanımlanmalı; aksi halde ticker="kap-candidates" olarak eşleşip 404
    dönerdi."""
    res = client.get("/api/v1/admin/corporate-actions/kap-candidates", headers=admin_headers)
    assert res.status_code == 200
    assert "candidates" in res.json()
