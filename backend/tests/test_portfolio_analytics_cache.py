"""_cached_returns / _get_risk_free_rate önbellek katmanının testleri.

Buradaki asıl risk sessiz bir bozulma: getiri serisi Redis'e JSON olarak
yazılıp geri okunurken tarih indeksi ya da değerler bozulursa beta/sharpe
HATA VERMEZ, sadece yanlış hesaplar. O yüzden testler round-trip'in
birebir aynı seriyi verdiğini doğruluyor.
"""
import datetime as dt
from unittest.mock import patch

import pandas as pd
import pytest

from app.services import portfolio_analytics as pa


def _sample_series() -> pd.Series:
    return pd.Series(
        [0.011, -0.0234, 0.0005],
        index=[dt.date(2026, 8, 3), dt.date(2026, 8, 4), dt.date(2026, 8, 5)],
    )


def test_cached_returns_computes_and_stores_on_miss():
    stored = {}

    def fake_set(key, value, expire_seconds=None):
        stored[key] = value
        return True

    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json", side_effect=fake_set):
        result = pa._cached_returns("k", _sample_series)

    pd.testing.assert_series_equal(result, _sample_series())
    assert stored["k"]["dates"] == ["2026-08-03", "2026-08-04", "2026-08-05"]
    assert stored["k"]["values"] == [0.011, -0.0234, 0.0005]


def test_cached_returns_roundtrip_is_identical():
    """Önbellekten okunan seri, hesaplanan seriyle AYNI olmalı - tarih
    indeksi ve değerler dahil. Bozulursa beta/sharpe sessizce yanlışlanır."""
    payload = {
        "dates": ["2026-08-03", "2026-08-04", "2026-08-05"],
        "values": [0.011, -0.0234, 0.0005],
    }

    def _should_not_run():
        raise AssertionError("önbellek dolu iken hesaplama yapılmamalı")

    with patch("app.core.redis.cache_service.get_json", return_value=payload):
        result = pa._cached_returns("k", _should_not_run)

    pd.testing.assert_series_equal(result, _sample_series())


def test_cached_returns_recomputes_on_corrupt_cache():
    """Eski/bozuk bir önbellek formatı patlamamalı, sessizce yeniden
    hesaplamalı."""
    with patch("app.core.redis.cache_service.get_json", return_value={"unexpected": "shape"}), \
         patch("app.core.redis.cache_service.set_json", return_value=True):
        result = pa._cached_returns("k", _sample_series)

    pd.testing.assert_series_equal(result, _sample_series())


def test_cached_returns_does_not_cache_none():
    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json") as mock_set:
        result = pa._cached_returns("k", lambda: None)

    assert result is None
    mock_set.assert_not_called()


def test_get_risk_free_rate_uses_cache():
    with patch("app.core.redis.cache_service.get_json", return_value={"rate": 0.42}), \
         patch("borsapy.risk_free_rate") as mock_rate:
        assert pa._get_risk_free_rate() == 0.42
        mock_rate.assert_not_called()


def test_get_risk_free_rate_fetches_and_caches_on_miss():
    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json") as mock_set, \
         patch("borsapy.risk_free_rate", return_value=0.375):
        assert pa._get_risk_free_rate() == 0.375
        mock_set.assert_called_once()


def test_get_risk_free_rate_falls_back_when_source_unavailable():
    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json", return_value=True), \
         patch("borsapy.risk_free_rate", side_effect=Exception("network down")):
        assert pa._get_risk_free_rate() == pa.FALLBACK_RISK_FREE_RATE
