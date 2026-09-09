# -*- coding: utf-8 -*-
"""Free tier veri kaynağı - TradingView'dan tam ayrışma.

Kullanıcının açık talebi: "free hesaplar benim TradingView verilerimi
kullanmasın, BIST 15 dk gecikmeli veri zaten her yerde var."

Eskiden `get_delayed_quote` canlı TradingView kotasyonunu alıp geriye
kaydırıyordu; yani her ücretsiz kullanıcı hesap sahibinin kişisel
TradingView oturumundan besleniyordu. Free kayıtlar internete açılınca bu
ne ölçeklenir ne de doğrudur.

Bu testlerin koruduğu asıl davranış: NORMAL İŞLEMEDE free yol TradingView'a
HİÇ dokunmamalı.
"""
from unittest.mock import patch

import pytest

from app.services import free_market_data
from app.services.market_data import market_data_service

# Bu dosya free yolun KENDISINI test ediyor - conftest'teki genel muhafizdan
# muaf (saglayici yine taklit ediliyor, aga cikilmiyor).
pytestmark = pytest.mark.free_quote


RAW = {
    "symbol": "THYAO", "last": 301.0, "open": 302.5, "high": 306.75,
    "low": 300.75, "close": 305.0, "volume": 17798872853,
    "bid": 300.75, "ask": 301.0, "change": -4.0, "change_percent": -1.31,
}


class _Cache:
    def __init__(self): self.d = {}
    def get_json(self, k): return self.d.get(k)
    def set_json(self, k, v, expire_seconds=None): self.d[k] = v; return True


@pytest.fixture
def cache():
    c = _Cache()
    with patch("app.core.redis.cache_service", c):
        yield c


def _provider(raw=RAW, side_effect=None):
    class P:
        def get_realtime_quote(self, symbol):
            if side_effect:
                raise side_effect
            return raw
    return patch("borsapy._providers.isyatirim.get_isyatirim_provider", return_value=P())


def test_delayed_quote_never_touches_tradingview(cache):
    """EN KRITIK TEST: free yol paylasilan TradingView akisina hic
    dokunmamali - ne get_quote ne get_candles."""
    with _provider(), \
         patch.object(market_data_service, "get_quote") as tv_quote, \
         patch.object(market_data_service, "get_candles") as tv_candles:
        q = market_data_service.get_delayed_quote("THYAO", 15)

    assert q["source"] == "isyatirim"
    tv_quote.assert_not_called()
    tv_candles.assert_not_called()


def test_premium_still_uses_live_tradingview(cache):
    """delay_minutes == 0 (premium) eski yolda kalmali."""
    with patch.object(market_data_service, "get_quote", return_value={"last": 1.0}) as tv:
        market_data_service.get_delayed_quote("THYAO", 0)
    tv.assert_called_once()


def test_previous_close_is_not_mistaken_for_current_price(cache):
    """Is Yatirim'in `close` alani ONCEKI kapanis (last=301, close=305,
    change=-4 -> 305-4=301). Guncel fiyat sanilirsa degisim yuzdesi
    sessizce ters doner."""
    with _provider():
        q = free_market_data.get_quote("THYAO", 15)
    assert q["last"] == 301.0
    assert q["prev_close"] == 305.0
    assert q["change_percent"] == -1.31


def test_missing_change_is_derived_not_invented(cache):
    raw = dict(RAW); raw.pop("change"); raw.pop("change_percent")
    with _provider(raw):
        q = free_market_data.get_quote("THYAO", 15)
    assert q["change"] == -4.0
    assert q["change_percent"] == -1.31


def test_absent_fields_are_none_not_zero(cache):
    """eps/pe/market_cap Is Yatirim kotasyonunda yok. 0 verilseydi ekranda
    'F/K = 0' gibi UYDURMA bir rakam gorunurdu."""
    with _provider():
        q = free_market_data.get_quote("THYAO", 15)
    assert q["eps"] is None and q["pe_ratio"] is None and q["market_cap"] is None


def test_second_call_is_served_from_shared_cache(cache):
    """N ucretsiz kullanici -> yukariya TEK istek. Onbelleksiz halde
    cozdugumuz yuku sadece adres degistirerek tekrarlardik."""
    calls = {"n": 0}

    class P:
        def get_realtime_quote(self, symbol):
            calls["n"] += 1
            return RAW

    with patch("borsapy._providers.isyatirim.get_isyatirim_provider", return_value=P()):
        free_market_data.get_quote("THYAO", 15)
        free_market_data.get_quote("THYAO", 15)
    assert calls["n"] == 1


def test_source_outage_serves_last_known_not_tradingview(cache):
    """Kaynak duserse SON BILINEN deger sunuluyor - TradingView'a
    dusulmuyor, bu modulun varlik sebebi tam olarak o."""
    with _provider():
        free_market_data.get_quote("THYAO", 15)          # onbellegi doldur
    cache.d.pop("freequote:THYAO")                        # taze onbellek suresi doldu

    with _provider(side_effect=RuntimeError("kaynak kapali")), \
         patch.object(market_data_service, "get_quote") as tv:
        q = free_market_data.get_quote("THYAO", 15)

    assert q is not None and q["last"] == 301.0
    tv.assert_not_called()


def test_unknown_symbol_with_no_history_returns_none(cache):
    with _provider(side_effect=RuntimeError("yok")):
        assert free_market_data.get_quote("YOKBOYLE", 15) is None


def test_bad_payload_is_rejected(cache):
    with _provider({"symbol": "X", "last": 0}):
        assert free_market_data.get_quote("X", 15) is None
