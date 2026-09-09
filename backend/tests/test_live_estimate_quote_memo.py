# -*- coding: utf-8 -*-
"""get_live_estimated_return'ün çağrı-ağacı içi quote hafızası.

2026-09-09 dağılım güncellemesiyle fon-içinde-fon grafiği yoğunlaştı
(DOH -> THF/TLY/TMV, THF -> TMV/TLY). Ölçüldü: DOH ve THF'nin her biri
81 benzersiz sembol için 268 get_quote çağrısı yapıyordu. Bu testler
hem tekrarların geri gelmemesini hem de hafızanın SONUCU değiştirmemesini
garanti ediyor.
"""
import collections
from unittest.mock import patch

import pytest

from app.services.tefas import tefas_service, FUND_DETAILS_MAP


@pytest.mark.parametrize("code", ["DOH", "THF", "TMV", "TLY"])
def test_each_symbol_quoted_at_most_once(code):
    calls = collections.Counter()
    real = None

    def counting(sym, *a, **k):
        calls[sym] += 1
        return {"change_percent": 1.0, "price": 10.0}

    with patch("app.services.tefas.market_data_service.get_quote", side_effect=counting):
        tefas_service.get_live_estimated_return(code)

    dupes = {s: n for s, n in calls.items() if n > 1}
    assert not dupes, f"{code}: aynı sembol birden fazla kez soruldu -> {dupes}"


def test_memo_keeps_result_deterministic():
    """Hafiza yalnizca tekrar eden okumayi kesmeli; sonucu path'e bagimli
    hale GETIRMEMELI. Ayni girdiyle art arda iki cagri birebir ayni
    sonucu vermeli - hafiza bir cagri agacina ozel olup disari sizmamali.

    (Not: tahmin degeri ham agirliklarin duz carpimi DEGIL - agirlik-kaymasi
    duzeltmesi devrede ve HMV/SABIT gibi fon/kategori bacaklari kendi
    yollarindan cozuluyor. Bu yuzden burada aritmetik degil, KARARLILIK
    dogrulaniyor.)"""
    def fixed(sym, *a, **k):
        return {"change_percent": 2.0, "price": 10.0}

    with patch("app.services.tefas.market_data_service.get_quote", side_effect=fixed):
        first = tefas_service.get_live_estimated_return("DOH")
        second = tefas_service.get_live_estimated_return("DOH")

    assert first is not None
    assert first["estimated_change_pct"] == second["estimated_change_pct"]
    assert first["resolved_weight_pct"] == second["resolved_weight_pct"]
    assert [h["ticker"] for h in first["holdings"]] == [h["ticker"] for h in second["holdings"]]


def test_cycle_between_doh_and_thf_terminates():
    """DOH <-> THF karşılıklı döngüsü sonsuza gitmemeli."""
    assert "THF" in [h["name"] for h in FUND_DETAILS_MAP["DOH"]["assets_distribution"]]
    assert "DOH" in [h["name"] for h in FUND_DETAILS_MAP["THF"]["assets_distribution"]]
    r = tefas_service.get_live_estimated_return("DOH")
    assert r is not None and r["estimated_change_pct"] is not None
