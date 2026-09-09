# -*- coding: utf-8 -*-
"""TEFAS fon büyüklüğü / yatırımcı sayısı / net para akışı metrikleri.

Asıl risk sessiz yanlışlık: net para akışını portföy büyüklüğü farkından
hesaplamak, piyasa hareketiyle para girişini birbirine karıştırır - yükselen
bir günde hiç para girmediği hâlde "giriş var" gösterirdi. Doğrusu tedavüldeki
PAY SAYISI değişimi; pay sayısı yalnızca katılma payı alınıp satıldığında
değişir. Bu testler o ayrımı koruyor.
"""
import pytest

from app.services.tefas import _num, _format_try, _tefas_metrics


def _row(date, price, size, shares, investors):
    return (date, price, "Ad", size, shares, investors)


def test_num_parses_and_rejects_nan():
    assert _num("12.5") == 12.5
    assert _num(3) == 3.0
    assert _num(None) is None
    assert _num("abc") is None
    assert _num(float("nan")) is None, "NaN 0.0'a düşerse net akış sessizce yanlışlanır"


def test_format_try_matches_existing_style():
    assert _format_try(1854200000.0) == "₺1,854,200,000"
    assert _format_try(None) is None


def test_metrics_reads_latest_size_and_investors():
    series = [_row("2026-09-09", 10.0, 5_000_000.0, 500_000.0, 1200.0),
              _row("2026-09-08", 9.0, 4_000_000.0, 480_000.0, 1100.0)]
    m = _tefas_metrics(series)
    assert m["fund_size_try"] == 5_000_000.0
    assert m["investor_count"] == 1200


def test_net_flow_uses_share_count_not_size_delta():
    """Fiyat 9 -> 10 çıkmış ve pay sayısı 480k -> 500k artmış.
    Doğru net giriş = 20.000 pay x 10 TL = 200.000 TL.
    Portföy büyüklüğü farkı alınsaydı 1.000.000 TL çıkardı - içinde
    piyasa değer artışı da olurdu."""
    series = [_row("2026-09-09", 10.0, 5_000_000.0, 500_000.0, 1200.0),
              _row("2026-09-08", 9.0, 4_320_000.0, 480_000.0, 1100.0)]
    m = _tefas_metrics(series)
    assert m["net_flow_try"] == 200_000.0
    assert m["net_flow_date"] == "2026-09-09"


def test_net_flow_negative_on_redemption():
    series = [_row("2026-09-09", 10.0, 4_000_000.0, 400_000.0, 900.0),
              _row("2026-09-08", 10.0, 5_000_000.0, 500_000.0, 1000.0)]
    assert _tefas_metrics(series)["net_flow_try"] == -1_000_000.0


def test_metrics_degrade_gracefully():
    assert _tefas_metrics([])["fund_size_try"] is None
    # Tek gun varsa net akis hesaplanamaz - 0.0 DEGIL None olmali,
    # yoksa "bugun hic para girmedi" gibi okunurdu.
    one = [_row("2026-09-09", 10.0, 5_000_000.0, 500_000.0, 1200.0)]
    assert _tefas_metrics(one)["net_flow_try"] is None
    # Pay sayisi eksikse yine None
    missing = [_row("2026-09-09", 10.0, 5e6, None, 1200.0),
               _row("2026-09-08", 10.0, 5e6, None, 1200.0)]
    assert _tefas_metrics(missing)["net_flow_try"] is None


def test_get_fund_prefers_real_tefas_size_over_static_placeholder():
    """get_fund eskiden {**f, **details} donuyordu - sabit FUND_DETAILS_MAP
    fund_size'i CANLI TEFAS verisinin uzerine yaziyordu. THF/DOH icin bu,
    gercek buyukluk elde varken "₺250,000,000" placeholder'inin
    gosterilmesi demekti."""
    from unittest.mock import patch
    from app.services.tefas import TefasService

    svc = TefasService()
    svc._cached_funds["DOH"] = {
        "code": "DOH", "name": "x", "category": "Serbest Fon", "price": 10.0,
        "daily_return": 0.0, "weekly_return": 0.0, "monthly_return": 0.0,
        "fund_size_try": 1_234_567_890.0, "investor_count": 4242,
        "net_flow_try": -55_000.0, "net_flow_date": "2026-09-09",
    }
    with patch.object(svc, "_maybe_refresh_prices", lambda: None):
        out = svc.get_fund("DOH")

    assert out["fund_size"] == "₺1,234,567,890"
    assert out["fund_size_source"] == "tefas"
    assert out["investor_count"] == 4242
    assert out["net_flow_try"] == -55_000.0
    # Sabit alanlar (manager/risk) hala geliyor
    assert out["manager"] == "Tera Portföy Yönetimi A.Ş."


def test_get_fund_falls_back_to_static_size_when_tefas_has_none():
    from unittest.mock import patch
    from app.services.tefas import TefasService

    svc = TefasService()
    svc._cached_funds["DOH"] = {
        "code": "DOH", "name": "x", "category": "Serbest Fon", "price": 10.0,
        "daily_return": 0.0, "weekly_return": 0.0, "monthly_return": 0.0,
        "fund_size_try": None,
    }
    with patch.object(svc, "_maybe_refresh_prices", lambda: None):
        out = svc.get_fund("DOH")

    assert out["fund_size"] == "₺250,000,000"
    assert out["fund_size_source"] == "static"
