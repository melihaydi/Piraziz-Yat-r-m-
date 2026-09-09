# -*- coding: utf-8 -*-
"""Admin kompozisyon override'i ile koddaki dağılım arasındaki öncelik.

Kural: override, YAZILDIĞI ANDAKİ kod dağılımının parmak izini taşır.
Kodun dağılımı sonradan değiştiyse override tanım gereği bayattır ve kod
kazanır. Değişmediyse admin bilerek mevcut veriyi özelleştirmiştir ve
override kazanır.

Neden bu tasarım - iki başarısız denemeden sonra:
  1. Override KOŞULSUZ kazanıyordu: bir kerelik bir düzenleme sonraki
     TÜM veri güncellemelerini sessizce gömüyordu. Canlıda yaşandı.
  2. Tarih (gün) karşılaştırması: aynı gün yapılan deploy ile admin
     düzenlemesini ayırt edemiyordu. O da canlıda yaşandı.
  3. Zaman damgası: çalışıyordu ama kodda elle güncellenen bir "revizyon"
     sabiti gerektiriyordu - biri unuttuğu anda aynı hata geri gelirdi.
Parmak izi hiçbir elle bakım gerektirmiyor: veri değişirse iz değişir.
"""
from app.services.tefas import (
    TefasService, FUND_DETAILS_MAP, composition_fingerprint,
)

DIST_OLD = [{"name": "AAA", "value": 100.0}]
DIST_NEW = [{"name": "BBB", "value": 100.0}]

CODE_DOH = FUND_DETAILS_MAP["DOH"]["assets_distribution"]


def _svc(override):
    s = TefasService()
    s._composition_overrides = {"DOH": override} if override else {}
    return s


def test_fingerprint_is_order_independent_and_value_sensitive():
    a = [{"name": "AAA", "value": 10.0}, {"name": "BBB", "value": 5.0}]
    assert composition_fingerprint(a) == composition_fingerprint(list(reversed(a)))
    assert composition_fingerprint(a) != composition_fingerprint(
        [{"name": "AAA", "value": 10.1}, {"name": "BBB", "value": 5.0}]
    )


def test_override_wins_while_code_data_unchanged():
    """Admin panelinin amaci bozulmamali: kod verisi degismedigi surece
    duzenleme gecerli kalir."""
    svc = _svc({
        "assets_distribution": DIST_NEW,
        "as_of": "2026-09-09",
        "_base_fingerprint": composition_fingerprint(CODE_DOH),
    })
    assert svc._resolve_composition("DOH")["assets_distribution"] == DIST_NEW


def test_code_wins_once_its_data_changed():
    """Override baska bir veriye dayaniyordu -> bayat -> kod kazanir."""
    svc = _svc({
        "assets_distribution": DIST_OLD,
        "as_of": "2026-09-09",
        "_base_fingerprint": composition_fingerprint(DIST_OLD),  # kodunkiyle ayni degil
    })
    assert svc._resolve_composition("DOH")["assets_distribution"] == CODE_DOH


def test_same_day_edit_no_longer_shadows_new_data():
    """Canlida yasanan hata: ayni gun yapilan deploy ile duzenleme
    ayirt edilemiyordu. Parmak izi gunden bagimsiz."""
    svc = _svc({
        "assets_distribution": DIST_OLD,
        "as_of": "2026-09-09",                     # kodla AYNI gun
        "_updated_at": "2026-09-09T23:59:00+00:00",  # kodla AYNI gun, hatta sonra
        "_base_fingerprint": composition_fingerprint(DIST_OLD),
    })
    assert svc._resolve_composition("DOH")["assets_distribution"] == CODE_DOH


def test_legacy_row_without_fingerprint_defers_to_code():
    """Parmak izi alanindan ONCE yazilmis satirlar: hangi veriye dayandigi
    bilinmiyor, kodda dagilim varsa o tercih ediliyor - aksi halde tarihi
    belirsiz bir kayit yeni verinin onunu suresiz keserdi."""
    svc = _svc({"assets_distribution": DIST_OLD, "as_of": None, "_base_fingerprint": None})
    assert svc._resolve_composition("DOH")["assets_distribution"] == CODE_DOH


def test_override_for_fund_with_no_code_default_is_used():
    svc = TefasService()
    svc._composition_overrides = {
        "ZZZ": {"assets_distribution": DIST_NEW, "as_of": None, "_base_fingerprint": None}
    }
    assert svc._resolve_composition("ZZZ")["assets_distribution"] == DIST_NEW


def test_get_fund_and_live_estimate_use_the_same_composition():
    """Detay sayfasi ile anlik getiri asla farkli dagilim gostermemeli."""
    from unittest.mock import patch
    svc = _svc({
        "assets_distribution": DIST_NEW,
        "as_of": "2026-12-01",
        "_base_fingerprint": composition_fingerprint(CODE_DOH),
    })
    svc._cached_funds["DOH"] = {
        "code": "DOH", "name": "x", "category": "Serbest Fon", "price": 10.0,
        "daily_return": 0.0, "weekly_return": 0.0, "monthly_return": 0.0,
    }
    with patch.object(svc, "_maybe_refresh_prices", lambda: None):
        detail = svc.get_fund("DOH")
    assert detail["assets_distribution"] == svc._resolve_composition("DOH")["assets_distribution"] == DIST_NEW
