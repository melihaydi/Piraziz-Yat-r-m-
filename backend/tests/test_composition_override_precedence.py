# -*- coding: utf-8 -*-
"""Admin kompozisyon override'i ile koddaki dağılım arasındaki öncelik.

Gerçekte yaşandı: 2026-09-09'da dört fonun dağılımı kodda güncellendi ama
canlıda eski veri görünmeye devam etti - çünkü admin panelinden bir kez
kaydedilmiş override satırı FUND_DETAILS_MAP'i sessizce gölgeliyordu.
Üstelik get_fund doğrudan FUND_DETAILS_MAP okuduğu için fon DETAY sayfası
yeni dağılımı, anlık getiri ise eskisini gösteriyordu - ekranda birbiriyle
çelişen iki dağılım, hiçbir hata vermeden.
"""
from app.services.tefas import TefasService, FUND_DETAILS_MAP

DIST_OLD = [{"name": "AAA", "value": 100.0}]
DIST_NEW = [{"name": "BBB", "value": 100.0}]


def _svc(override):
    s = TefasService()
    s._composition_overrides = {"DOH": override} if override else {}
    return s


def test_newer_code_composition_beats_stale_override():
    svc = _svc({"assets_distribution": DIST_OLD, "as_of": "2026-08-20", "_updated_at": "2026-08-20"})
    comp = svc._resolve_composition("DOH")
    assert comp["assets_distribution"] == FUND_DETAILS_MAP["DOH"]["assets_distribution"]
    assert comp["as_of"] == "2026-09-09"


def test_newer_override_still_wins():
    """Admin panelinin amacı bozulmamalı: deploy'dan SONRA yapılan bir
    düzenleme hâlâ kazanmalı."""
    svc = _svc({"assets_distribution": DIST_NEW, "as_of": "2026-12-01", "_updated_at": "2026-12-01"})
    assert svc._resolve_composition("DOH")["assets_distribution"] == DIST_NEW


def test_undated_override_falls_back_to_its_write_date():
    """as_of bilerek null bırakılabiliyor (drift'i atlamak için) - o zaman
    override'ın YAZILDIĞI tarihe bakılır."""
    stale = _svc({"assets_distribution": DIST_OLD, "as_of": None, "_updated_at": "2026-08-01"})
    assert stale._resolve_composition("DOH")["assets_distribution"] != DIST_OLD

    fresh = _svc({"assets_distribution": DIST_NEW, "as_of": None, "_updated_at": "2026-12-01"})
    assert fresh._resolve_composition("DOH")["assets_distribution"] == DIST_NEW


def test_override_for_untracked_fund_still_used():
    svc = TefasService()
    svc._composition_overrides = {"ZZZ": {"assets_distribution": DIST_NEW, "as_of": None, "_updated_at": None}}
    assert svc._resolve_composition("ZZZ")["assets_distribution"] == DIST_NEW


def test_get_fund_and_live_estimate_use_the_same_composition():
    """Detay sayfası ile anlık getiri asla farklı dağılım göstermemeli."""
    from unittest.mock import patch
    svc = _svc({"assets_distribution": DIST_NEW, "as_of": "2026-12-01", "_updated_at": "2026-12-01"})
    svc._cached_funds["DOH"] = {
        "code": "DOH", "name": "x", "category": "Serbest Fon", "price": 10.0,
        "daily_return": 0.0, "weekly_return": 0.0, "monthly_return": 0.0,
    }
    with patch.object(svc, "_maybe_refresh_prices", lambda: None):
        detail = svc.get_fund("DOH")
    assert detail["assets_distribution"] == svc._resolve_composition("DOH")["assets_distribution"] == DIST_NEW
