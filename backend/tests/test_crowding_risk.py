# -*- coding: utf-8 -*-
"""Çıkış Kapısı - fonların tuttuğu payın kaç günlük hacme denk geldiği.

Korunan kararlar:
  - Büyüklüğü bilinmeyen fon TOPLAMA KATILMAMALI (ağırlık TL'ye
    çevrilemez) ve bu sessizce yutulmamalı, ayrıca raporlanmalı.
  - Hacmi bilinmeyen hisse "sonsuz gün" değil, None dönmeli.
  - Tipik hacim MEDYAN olmalı: tek bir blok işlem günü ortalamayı şişirip
    hisseyi olduğundan likit gösterir.
  - Sıralama çıkış süresine göre - asıl soru "kim çok tutuyor" değil,
    "kim dar kapıda".
"""
from unittest.mock import patch

import pytest

from app.services import crowding_risk


def _fund(size):
    return {"fund_size_try": size}


@pytest.fixture
def one_fund(monkeypatch):
    """Tek fon (AAA), 1 milyar TL, %50 THYAO + %50 ASELS."""
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    patches = [
        patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}),
        patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO", "ASELS"}),
        patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)),
        patch("app.services.portfolio_ledger.expand_fund_leaf_weights",
              return_value={"THYAO": 0.5, "ASELS": 0.5}),
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


def test_held_value_is_fund_size_times_weight(one_fund):
    with patch.object(crowding_risk, "_median_daily_turnover_try", return_value=50_000_000.0):
        out = crowding_risk.compute_exit_door()

    by = {r["ticker"]: r for r in out["rows"]}
    # 1 mlr x %50 = 500 mn TL
    assert by["THYAO"]["fund_held_try"] == 500_000_000.0
    assert by["ASELS"]["fund_held_try"] == 500_000_000.0
    # 500 mn / 50 mn gunluk hacim = 10 gunluk hacim
    assert by["THYAO"]["days_of_volume"] == 10.0
    assert out["covered_fund_count"] == 1


def test_unknown_volume_reports_none_not_infinity(one_fund):
    with patch.object(crowding_risk, "_median_daily_turnover_try", return_value=None):
        out = crowding_risk.compute_exit_door()

    for row in out["rows"]:
        assert row["days_of_volume"] is None
        assert row["median_daily_turnover_try"] is None


def test_fund_without_size_is_excluded_and_reported(monkeypatch):
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}, "BBB": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}), \
         patch("app.services.tefas.tefas_service.get_fund",
               side_effect=lambda c: _fund(1_000_000_000.0) if c == "AAA" else _fund(None)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch.object(crowding_risk, "_median_daily_turnover_try", return_value=10_000_000.0):
        out = crowding_risk.compute_exit_door()

    # Yalnizca AAA sayildi - BBB'nin buyuklugu yok, agirligi TL'ye cevrilemez.
    assert out["covered_fund_count"] == 1
    assert "BBB" in out["funds_without_size"]
    assert out["rows"][0]["fund_held_try"] == 1_000_000_000.0


def test_non_stock_leaves_are_ignored(monkeypatch):
    """VIOP/SABIT gibi kalemlerin ve fon kodlarinin cikis suresi yoktur."""
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}, "TLY": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights",
               return_value={"THYAO": 0.5, "VIOP": 0.3, "TLY": 0.2}), \
         patch.object(crowding_risk, "_median_daily_turnover_try", return_value=10_000_000.0):
        out = crowding_risk.compute_exit_door()

    tickers = {r["ticker"] for r in out["rows"]}
    assert tickers == {"THYAO"}


def test_rows_sorted_by_exit_days_not_by_amount(monkeypatch):
    """Cok tutulan ama likit hisse, az tutulan ama ince hisseden DAHA AZ
    riskli - siralama bunu yansitmali."""
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    turnovers = {"THYAO": 1_000_000_000.0, "ASELS": 1_000_000.0}
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO", "ASELS"}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights",
               return_value={"THYAO": 0.9, "ASELS": 0.1}), \
         patch.object(crowding_risk, "_median_daily_turnover_try",
                      side_effect=lambda t: turnovers[t]):
        out = crowding_risk.compute_exit_door()

    # THYAO'da 900 mn tutuluyor ama gunluk 1 mlr hacim var -> 0.9 gun.
    # ASELS'te 100 mn tutuluyor, gunluk 1 mn hacim -> 100 gun. ASELS once.
    assert [r["ticker"] for r in out["rows"]] == ["ASELS", "THYAO"]
    assert out["rows"][0]["days_of_volume"] == 100.0


def test_small_positions_are_filtered_out():
    """Fonlarin birkac yuz bin TL tuttugu kalem gurultu - listeyi sismemeli."""
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO", "ASELS"}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights",
               return_value={"THYAO": 0.999, "ASELS": 0.001}), \
         patch.object(crowding_risk, "_median_daily_turnover_try", return_value=10_000_000.0):
        out = crowding_risk.compute_exit_door()

    # ASELS: 1 mlr x %0.1 = 1 mn TL, esik 5 mn -> listede olmamali.
    assert [r["ticker"] for r in out["rows"]] == ["THYAO"]


def test_fund_count_shows_how_many_funds_hold_it(monkeypatch):
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}, "BBB": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(500_000_000.0)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch.object(crowding_risk, "_median_daily_turnover_try", return_value=10_000_000.0):
        out = crowding_risk.compute_exit_door()

    row = out["rows"][0]
    assert row["fund_count"] == 2
    assert row["funds"] == ["AAA", "BBB"]
    assert row["fund_held_try"] == 1_000_000_000.0


def test_empty_when_nothing_resolvable():
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(None)):
        out = crowding_risk.compute_exit_door()
    assert out["rows"] == [] and out["covered_fund_count"] == 0


# --- medyan hacim ----------------------------------------------------------

def test_median_ignores_one_off_block_trade():
    """Tek bir devasa gun ORTALAMAYI ikiye katlar; medyan etkilenmez."""
    import pandas as pd

    rows = [{"Close": 10.0, "Volume": 1_000_000.0} for _ in range(9)]
    rows.append({"Close": 10.0, "Volume": 100_000_000.0})   # blok islem
    df = pd.DataFrame(rows, index=pd.date_range("2026-09-01", periods=10))

    with patch("app.services.price_history.cached_history", return_value=df):
        out = crowding_risk._median_daily_turnover_try("THYAO")

    assert out == 10_000_000.0          # medyan: 10 x 1 mn
    # Ortalama ~19 mn olurdu; hisseyi iki kat likit gosterirdi.


def test_too_few_days_returns_none():
    import pandas as pd
    df = pd.DataFrame(
        [{"Close": 10.0, "Volume": 1_000.0} for _ in range(3)],
        index=pd.date_range("2026-09-01", periods=3),
    )
    with patch("app.services.price_history.cached_history", return_value=df):
        assert crowding_risk._median_daily_turnover_try("THYAO") is None


# --- API ucu ---------------------------------------------------------------

def _auth_headers(client):
    client.post("/api/v1/auth/register",
                json={"email": "exituser@example.com", "password": "mypassword", "terms_accepted": True})
    login = client.post("/api/v1/auth/login",
                        data={"username": "exituser@example.com", "password": "mypassword"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_endpoint_requires_login(client):
    assert client.get("/api/v1/funds/exit-door").status_code == 401


def test_endpoint_is_not_shadowed_by_code_route(client, monkeypatch):
    """`/exit-door` literal yolu `/{code}`dan ONCE tanimli olmali; aksi
    halde code="exit-door" diye bir fon aranir ve 404 donerdi."""
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    headers = _auth_headers(client)
    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}), \
         patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}), \
         patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)), \
         patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}), \
         patch.object(crowding_risk, "_median_daily_turnover_try", return_value=10_000_000.0):
        crowding_risk.refresh(force=True)          # hesabi hazirla
        res = client.get("/api/v1/funds/exit-door", headers=headers)

    assert res.status_code == 200, res.text
    body = res.json()
    assert body["ready"] is True
    assert body["rows"][0]["ticker"] == "THYAO"
    assert body["rows"][0]["days_of_volume"] == 100.0


@pytest.fixture(autouse=True)
def _clear_exit_door_cache():
    """Onbellek ve "hesap suruyor" bayragi modul seviyesinde - testler
    arasinda sizmasin. Bayrak onemli: takili kalirsa sonraki testin
    refresh() cagrisi hic hesaplamadan doner."""
    def reset():
        with crowding_risk._mem_lock:
            crowding_risk._mem["result"], crowding_risk._mem["at"] = None, 0.0
        with crowding_risk._compute_lock:
            crowding_risk._computing = False
    reset()
    yield
    reset()


def test_endpoint_returns_not_ready_instead_of_blocking(client):
    """Hazir sonuc yokken uc 35 saniye hesaplamamali - hemen "hazir degil"
    deyip hesabi arka planda baslatmali."""
    headers = _auth_headers(client)
    # Hesap ici bos donduruluyor: uc'un arka planda baslattigi is
    # parcacigi bu testten sonra onbellege sahte bir sonuc birakmasin.
    with patch.object(crowding_risk, "compute_exit_door",
                      return_value={"rows": [], "covered_fund_count": 0}):
        res = client.get("/api/v1/funds/exit-door", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["ready"] is False
    assert body["rows"] == []


def test_second_call_is_served_from_cache(monkeypatch):
    """Ikinci cagri yeniden HESAPLAMAMALI - girdiler gunde bir degisiyor."""
    monkeypatch.setattr(crowding_risk, "_MIN_HELD_TRY", 0.0)
    calls = {"n": 0}

    def counting_turnover(_t):
        calls["n"] += 1
        return 10_000_000.0

    with patch("app.services.tefas.BASE_FUNDS", {"AAA": {}}),          patch("app.services.tefas._KNOWN_STOCK_TICKERS", {"THYAO"}),          patch("app.services.tefas.tefas_service.get_fund", return_value=_fund(1_000_000_000.0)),          patch("app.services.portfolio_ledger.expand_fund_leaf_weights", return_value={"THYAO": 1.0}),          patch.object(crowding_risk, "_median_daily_turnover_try", side_effect=counting_turnover):
        crowding_risk.refresh(force=True)
        first = calls["n"]
        crowding_risk.refresh()
        crowding_risk.refresh()

    assert first == 1
    assert calls["n"] == first, "onbellekteki sonuc varken yeniden hesaplandi"
