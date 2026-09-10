# -*- coding: utf-8 -*-
"""Fonların günlük nakit giriş/çıkış kaydı.

Neden tablo tutuluyor: TEFAS yalnızca O ANKİ durumu yayınlıyor, geçmiş akış
serisi vermiyor. Uygulama bu değerleri zaten okuyordu ama hiçbir yere
yazmıyordu - "dün ne kadar para girdi" sorusu cevaplanamıyordu.

Korunan asıl karar: net akış PAY SAYISI değişiminden hesaplanıyor, portföy
büyüklüğü farkından DEĞİL. Büyüklük farkı piyasa hareketiyle para girişini
karıştırır ve yükselen bir günde hiç para girmediği hâlde "giriş var"
gösterirdi.
"""
import datetime as dt

import pytest

from app.models.fund_flow_snapshot import FundFlowSnapshot
from app.services.tefas import _tefas_metrics


def _row(date, price, size, shares, investors):
    return (date, price, "Ad", size, shares, investors)


def test_metrics_expose_shares_for_auditability():
    """Pay sayisi da saklaniyor ki rakam tartismali gorunurse hesap
    geriye dogru denetlenebilsin."""
    series = [_row("2026-09-10", 10.0, 5_000_000.0, 500_000.0, 1200.0),
              _row("2026-09-09", 9.0, 4_320_000.0, 480_000.0, 1100.0)]
    m = _tefas_metrics(series)
    assert m["shares_outstanding"] == 500_000.0
    assert m["fund_size_try"] == 5_000_000.0
    # 20.000 yeni pay x 10 TL = 200.000 TL giris.
    # Buyukluk farki alinsaydi 680.000 cikardi - icinde deger artisi da olurdu.
    assert m["net_flow_try"] == 200_000.0


def test_flows_endpoint_returns_newest_first(client, db):
    today = dt.date.today()
    for i, flow in enumerate([100.0, -50.0, 25.0]):
        db.add(FundFlowSnapshot(
            fund_code="DOH", as_of_date=today - dt.timedelta(days=i),
            fund_size_try=1000.0, shares_outstanding=10.0,
            investor_count=5, net_flow_try=flow,
        ))
    db.commit()

    body = client.get("/api/v1/funds/DOH/flows").json()
    assert body["code"] == "DOH"
    assert [f["net_flow_try"] for f in body["flows"]] == [100.0, -50.0, 25.0]
    assert body["net_flow_total_try"] == 75.0


def test_unknown_flow_days_are_not_counted_as_zero(client, db):
    """None = 'hesaplanamadi'. 0 saymak 'o gun akis olmadi' demek olurdu -
    farkli seyler."""
    today = dt.date.today()
    db.add(FundFlowSnapshot(fund_code="TLY", as_of_date=today, net_flow_try=None))
    db.add(FundFlowSnapshot(fund_code="TLY", as_of_date=today - dt.timedelta(days=1), net_flow_try=40.0))
    db.commit()

    body = client.get("/api/v1/funds/TLY/flows").json()
    assert body["net_flow_total_try"] == 40.0
    assert body["flows"][0]["net_flow_try"] is None


def test_empty_history_is_not_an_error(client):
    body = client.get("/api/v1/funds/ZZZ/flows").json()
    assert body["flows"] == []
    assert body["net_flow_total_try"] is None


def test_days_parameter_is_bounded(client, db):
    today = dt.date.today()
    for i in range(5):
        db.add(FundFlowSnapshot(fund_code="TMV", as_of_date=today - dt.timedelta(days=i), net_flow_try=1.0))
    db.commit()
    assert len(client.get("/api/v1/funds/TMV/flows?days=2").json()["flows"]) == 2
    # Ust sinir: 365'i asan istek reddedilmiyor, kirpiliyor.
    assert client.get("/api/v1/funds/TMV/flows?days=99999").status_code == 200
