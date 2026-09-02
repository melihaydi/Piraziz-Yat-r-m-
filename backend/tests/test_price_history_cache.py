"""price_history.cached_history önbelleğinin testleri.

Buradaki asıl risk sessiz bozulma: borsapy tz-FARKINDALIKLI
(Europe/Istanbul) bir DatetimeIndex döndürüyor ve tefas.py'nin drift
hesabı bu tz'e güveniyor. Round-trip tz'i düşürürse HATA FIRLAMAZ,
tarihler sessizce kayar. Aynı şekilde Volume NaN olabiliyor ve sessizce
0.0'a dönerse hacim verisi yanlışlanır. Testler round-trip'in birebir
aynı DataFrame'i verdiğini doğruluyor.
"""
from unittest.mock import patch

import pandas as pd
import pytest

from app.services import price_history as ph


def _sample_df() -> pd.DataFrame:
    idx = pd.to_datetime(
        ["2026-08-03 18:00:00", "2026-08-04 18:00:00", "2026-08-05 18:00:00"]
    ).tz_localize("Europe/Istanbul")
    return pd.DataFrame(
        {
            "Open": [10.0, 11.5, 12.25],
            "High": [10.9, 11.8, 12.4],
            "Low": [9.8, 11.0, 12.0],
            "Close": [10.5, 11.2, 12.3],
            # Son bar hacmi NaN - borsapy'de gerçekten oluyor, portfolio.py'de
            # bunun için açık bir NaN kontrolü var.
            "Volume": [1000.0, 2500.0, float("nan")],
        },
        index=idx,
    )


def test_roundtrip_preserves_dataframe_exactly():
    df = _sample_df()
    restored = ph._from_payload(ph._to_payload(df))
    pd.testing.assert_frame_equal(restored, df)


def test_roundtrip_preserves_timezone():
    """tz düşerse tefas.py'nin drift tarihleri sessizce kayar."""
    df = _sample_df()
    restored = ph._from_payload(ph._to_payload(df))
    assert restored.index.tz is not None
    assert str(restored.index.tz) == "Europe/Istanbul"
    # Asıl kullanım: .date() karşılaştırması aynı günü vermeli
    assert [d.date() for d in restored.index] == [d.date() for d in df.index]


def test_roundtrip_preserves_nan_volume():
    df = _sample_df()
    restored = ph._from_payload(ph._to_payload(df))
    assert pd.isna(restored["Volume"].iloc[-1])
    assert restored["Volume"].iloc[0] == 1000.0


def test_cache_miss_computes_and_stores():
    stored = {}

    def fake_set(key, value, expire_seconds=None):
        stored[key] = value
        return True

    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json", side_effect=fake_set):
        result = ph.cached_history("k", _sample_df)

    pd.testing.assert_frame_equal(result, _sample_df())
    assert stored["k"]["tz"] == "Europe/Istanbul"
    assert stored["k"]["columns"]["Volume"][-1] is None  # NaN -> None


def test_cache_hit_does_not_refetch():
    payload = ph._to_payload(_sample_df())

    def _should_not_run():
        raise AssertionError("önbellek dolu iken ağa çıkılmamalı")

    with patch("app.core.redis.cache_service.get_json", return_value=payload):
        result = ph.cached_history("k", _should_not_run)

    pd.testing.assert_frame_equal(result, _sample_df())


def test_corrupt_cache_recomputes():
    with patch("app.core.redis.cache_service.get_json", return_value={"beklenmedik": "sekil"}), \
         patch("app.core.redis.cache_service.set_json", return_value=True):
        result = ph.cached_history("k", _sample_df)
    pd.testing.assert_frame_equal(result, _sample_df())


def test_empty_and_none_are_not_cached():
    with patch("app.core.redis.cache_service.get_json", return_value=None), \
         patch("app.core.redis.cache_service.set_json") as mock_set:
        assert ph.cached_history("k", lambda: None) is None
        assert ph.cached_history("k2", lambda: pd.DataFrame()).empty
    mock_set.assert_not_called()


def test_fetch_exception_propagates():
    """tefas.py'nin 429 yeniden deneme döngüsü bu istisnaya güveniyor -
    önbellek katmanı onu yutarsa retry sessizce ölür."""
    with patch("app.core.redis.cache_service.get_json", return_value=None):
        with pytest.raises(RuntimeError, match="429"):
            ph.cached_history("k", lambda: (_ for _ in ()).throw(RuntimeError("429 rate limit")))
