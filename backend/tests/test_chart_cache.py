# -*- coding: utf-8 -*-
"""Grafik mumlarının paylaşılan Redis önbelleği.

Neden kritik: TradingView bağlantısında TEK BİR paylaşılan grafik oturumu
var ve her chart isteği global kilidi alıp o oturumu sıfırlıyor (bellek içi
mum önbelleğini de siliyor). Önbelleksiz hâlde neredeyse her istek
TradingView'a gidiyordu.

Tek kullanıcıda görünmüyor; free kayıtlar internete açılınca aynı anda
farklı sembollere bakan N kullanıcı hem o kilitte sıraya girer hem de
birbirinin grafik oturumunu düşürürdü. Bu testler önbelleğin devrede
kaldığını ve kullanıcıya göre sızmadığını garanti ediyor.
"""
from unittest.mock import patch

import pytest


@pytest.fixture
def auth_headers(client):
    client.post("/api/v1/auth/register",
                json={"email": "chart@test.com", "password": "mypassword", "terms_accepted": True})
    r = client.post("/api/v1/auth/login",
                    data={"username": "chart@test.com", "password": "mypassword"})
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


class _Cache:
    def __init__(self): self.d = {}
    def get_json(self, k): return self.d.get(k)
    def set_json(self, k, v, expire_seconds=None): self.d[k] = v; return True


def _candles(n=40):
    return [{"time": 1700000000 + i * 86400, "open": 10.0, "high": 11.0,
             "low": 9.0, "close": 10.5, "volume": 100.0} for i in range(n)]


def test_second_request_does_not_refetch_from_tradingview(client, auth_headers):
    cache = _Cache()
    with patch("app.core.redis.cache_service", cache), \
         patch("app.api.v1.endpoints.screener.market_data_service.get_candles",
               return_value=_candles()) as mock_fetch:
        r1 = client.get("/api/v1/screener/chart/THYAO?interval=1d", headers=auth_headers)
        r2 = client.get("/api/v1/screener/chart/THYAO?interval=1d", headers=auth_headers)

    assert r1.status_code == 200 and r2.status_code == 200
    assert mock_fetch.call_count == 1, (
        "Ikinci istek TradingView'a TEKRAR gitti - paylasilan grafik oturumu "
        "her istekte sifirlandigi icin bu, kullanici sayisiyla dogru orantili "
        "yuk demek olurdu."
    )


def test_different_interval_is_cached_separately(client, auth_headers):
    cache = _Cache()
    with patch("app.core.redis.cache_service", cache), \
         patch("app.api.v1.endpoints.screener.market_data_service.get_candles",
               return_value=_candles()) as mock_fetch:
        client.get("/api/v1/screener/chart/THYAO?interval=1d", headers=auth_headers)
        client.get("/api/v1/screener/chart/THYAO?interval=1h", headers=auth_headers)
    assert mock_fetch.call_count == 2


def test_different_symbol_is_cached_separately(client, auth_headers):
    cache = _Cache()
    with patch("app.core.redis.cache_service", cache), \
         patch("app.api.v1.endpoints.screener.market_data_service.get_candles",
               return_value=_candles()) as mock_fetch:
        client.get("/api/v1/screener/chart/THYAO?interval=1d", headers=auth_headers)
        client.get("/api/v1/screener/chart/ASELS?interval=1d", headers=auth_headers)
    assert mock_fetch.call_count == 2


def test_cache_key_has_no_user_or_delay_in_it(client, auth_headers):
    """Onbellek anahtari kullanicidan BAGIMSIZ olmali; gecikme/kirpma
    onbellekten SONRA uygulaniyor. Aksi halde bir free kullanicinin
    kirpilmis serisi premium kullaniciya servis edilirdi."""
    cache = _Cache()
    with patch("app.core.redis.cache_service", cache), \
         patch("app.api.v1.endpoints.screener.market_data_service.get_candles",
               return_value=_candles()):
        client.get("/api/v1/screener/chart/THYAO?interval=1d", headers=auth_headers)

    keys = list(cache.d.keys())
    assert keys == ["screener:chart:THYAO:1d"], keys
