# -*- coding: utf-8 -*-
"""Fon Akış Radarı - fon akışının hisse bazına dağıtılması.

Korunan kararlar:
  - Hisse OLMAYAN yapraklar (VIOP/SABIT/BONO, kompozisyonu bilinmeyen fon
    kodları) "hangi hisseye para gitti" listesine KARIŞMAMALI; ayrı
    raporlanıyor, yoksa hisseye giden para rakamı şişer.
  - Kompozisyonu bilinmeyen fonun akışı toplama DAHİL EDİLMEMELİ - nereye
    gittiği bilinmiyor, hisselere dağıtmak uydurma olurdu.
  - Negatif akış (para çıkışı) negatif baskı üretmeli; sıralama mutlak
    değere göre, çünkü büyük çıkış da en az giriş kadar dikkat çekici.
"""
import datetime as dt
from unittest.mock import patch

import pytest

from app.models.fund_flow_snapshot import FundFlowSnapshot
from app.services import fund_flow_radar as radar


def _seed(db, code, flow, day_offset=0):
    db.add(FundFlowSnapshot(
        fund_code=code,
        as_of_date=dt.date.today() - dt.timedelta(days=day_offset),
        net_flow_try=flow,
    ))
    db.commit()


def test_flow_is_split_by_holding_weight(db):
    _seed(db, "AAA", 1_000_000.0)
    leaves = {"THYAO": 0.60, "ASELS": 0.40}
    with patch.object(radar, "__name__", radar.__name__), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value=leaves), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO", "ASELS"}):
        out = radar.compute_flow_radar(db, days=2)

    by = {s["ticker"]: s["implied_flow_try"] for s in out["stocks"]}
    assert by["THYAO"] == 600_000.0
    assert by["ASELS"] == 400_000.0
    assert out["net_flow_total_try"] == 1_000_000.0


def test_non_stock_legs_are_reported_separately(db):
    """VIOP bir piyasa segmenti, T3B kompozisyonu acilamamis bir FON -
    ikisi de 'hisseye giden para' listesinde gorunmemeli."""
    _seed(db, "AAA", 1_000_000.0)
    leaves = {"THYAO": 0.50, "VIOP": 0.30, "T3B": 0.20}
    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value=leaves), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}), \
         patch("app.services.tefas.BASE_FUNDS", {"T3B": {}}):
        out = radar.compute_flow_radar(db, days=2)

    assert [s["ticker"] for s in out["stocks"]] == ["THYAO"]
    others = {o["ticker"] for o in out["other"]}
    assert others == {"VIOP", "T3B"}


def test_outflow_produces_negative_pressure(db):
    _seed(db, "AAA", -500_000.0)
    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}):
        out = radar.compute_flow_radar(db, days=2)
    assert out["stocks"][0]["implied_flow_try"] == -500_000.0


def test_ranking_is_by_absolute_value(db):
    """Buyuk cikis, kucuk giristen once gelmeli."""
    _seed(db, "AAA", -1_000_000.0)
    _seed(db, "BBB", 100_000.0)

    def fake(code, _visited=None):
        return {"THYAO": 1.0} if code == "AAA" else {"ASELS": 1.0}

    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", side_effect=fake), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO", "ASELS"}):
        out = radar.compute_flow_radar(db, days=2)
    assert [s["ticker"] for s in out["stocks"]] == ["THYAO", "ASELS"]


def test_fund_with_unknown_composition_is_excluded_from_total(db):
    """Nereye gittigi bilinmeyen para hisselere DAGITILMAMALI ve toplami
    sismemeli."""
    _seed(db, "AAA", 1_000_000.0)
    _seed(db, "BILINMEYEN", 9_000_000.0)

    def fake(code, _visited=None):
        return {"THYAO": 1.0} if code == "AAA" else {}

    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", side_effect=fake), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}):
        out = radar.compute_flow_radar(db, days=2)

    assert out["net_flow_total_try"] == 1_000_000.0     # 10M DEGIL
    assert out["covered_fund_count"] == 1
    assert [f["code"] for f in out["funds"]] == ["AAA"]


def test_multiple_days_are_summed_per_fund(db):
    _seed(db, "AAA", 100.0, day_offset=0)
    _seed(db, "AAA", 200.0, day_offset=1)
    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}):
        out = radar.compute_flow_radar(db, days=5)
    assert out["stocks"][0]["implied_flow_try"] == 300.0


def test_empty_history_is_not_an_error(db):
    out = radar.compute_flow_radar(db, days=1)
    assert out["stocks"] == [] and out["covered_fund_count"] == 0


def _auth_headers(client):
    client.post("/api/v1/auth/register",
                json={"email": "radaruser@example.com", "password": "mypassword", "terms_accepted": True})
    login = client.post("/api/v1/auth/login",
                        data={"username": "radaruser@example.com", "password": "mypassword"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_endpoint_requires_login(client, db):
    # Ilk yayinda bu uc girissiz acikti - veri hesap acmadan cekilebiliyordu.
    assert client.get("/api/v1/funds/flow-radar?days=2").status_code == 401


def test_endpoint_responds(client, db):
    _seed(db, "AAA", 1_000_000.0)
    headers = _auth_headers(client)
    with patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}):
        r = client.get("/api/v1/funds/flow-radar?days=2", headers=headers)
    assert r.status_code == 200, r.text
    assert r.json()["stocks"][0]["ticker"] == "THYAO"
