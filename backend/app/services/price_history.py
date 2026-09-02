"""borsapy geçmiş fiyat çağrıları için paylaşılan Redis önbelleği.

NEDEN: borsapy'nin `Ticker(...).history()` / `FX(...).history()` çağrılarının
her biri KENDİ bağımsız TradingView WebSocket oturumunu açıp kapatıyor
(bkz. portfolio.py'deki `_fetch_candles` notu). Canlı sunucu teşhisinde
(Server Diagnostics #10) son 2000 log satırında 277 WebSocket bağlantısı
sayıldı - bunlar bozuk bir akışın yeniden bağlanmaları DEĞİL, istek başına
açılan tek seferlik oturumlar. 954 MB RAM'li ve zaten swap'e düşmüş bir
makinede bu el sıkışma patlamaları "veriler geç geliyor" olarak hissediliyor;
TradingView de yeterince sık vurulduğunda 429 döndürüyor.

Bu modül GÜNLÜK çözünürlüklü çağrıları önbellekliyor. Günlük barlar gün
içinde yalnızca SON bar kadar değişiyor, yani kısa bir TTL veri tazeliğinden
neredeyse hiçbir şey kaybettirmeden tekrar eden bağlantıların çoğunu siliyor.

Strateji motorunun 1h barları BİLEREK buraya alınmadı: tarama zaten 180
saniyede bir çalışıp sonucu Redis'te tutuyor (STRATEGY_REDIS_TTL_SECONDS),
dolayısıyla 180s'den kısa bir TTL hiçbir şey kazandırmaz, uzun bir TTL ise
sinyallerin ne zaman ateşlendiğini değiştirir - finansal bir üründe sessizce
yapılacak bir değişiklik değil.

SESSİZ BOZULMA RİSKİ: borsapy tz-FARKINDALIKLI (Europe/Istanbul) bir
DatetimeIndex döndürüyor ve tefas.py'nin drift hesabı bu tz'e güveniyor.
Round-trip tz'i düşürürse hiçbir hata fırlamaz - tarihler sessizce kayar.
Aynı şekilde Volume sütunu NaN içerebiliyor (portfolio.py'de açık bir
NaN kontrolü var). Bu yüzden serileştirme tz'i ve NaN'ı açıkça taşıyor ve
testler round-trip'in birebir aynı DataFrame'i verdiğini doğruluyor.
"""
import logging
import math
from typing import Any, Dict, List, Optional

import pandas as pd

logger = logging.getLogger(__name__)

# Gün içinde yalnızca son bar hareket ediyor; 15 dk, tekrar eden
# bağlantıların ezici çoğunluğunu keserken grafiklerde gözle görülür bir
# bayatlık yaratmıyor.
DAILY_TTL_SECONDS = 15 * 60


def _to_payload(df: pd.DataFrame) -> Dict[str, Any]:
    index = [ts.isoformat() for ts in df.index]
    columns: Dict[str, List[Optional[float]]] = {}
    for col in df.columns:
        values: List[Optional[float]] = []
        for v in df[col].tolist():
            try:
                f = float(v)
            except (TypeError, ValueError):
                values.append(None)
                continue
            # NaN JSON'da geçerli değil ve sessizce 0.0'a çevrilirse hacim
            # verisi yanlışlanır - açıkça None olarak taşınıyor.
            values.append(None if math.isnan(f) else f)
        columns[col] = values
    return {
        "tz": str(df.index.tz) if getattr(df.index, "tz", None) is not None else None,
        "index": index,
        "columns": columns,
    }


def _from_payload(payload: Dict[str, Any]) -> pd.DataFrame:
    idx = pd.to_datetime(payload["index"])
    tz = payload.get("tz")
    if tz and getattr(idx, "tz", None) is not None:
        # ISO dizeleri sabit ofsetle geri geliyor; adlandırılmış saat
        # dilimine çevirmek borsapy'nin döndürdüğü hâle birebir eşitliyor.
        idx = idx.tz_convert(tz)
    data = {
        col: [float("nan") if v is None else float(v) for v in values]
        for col, values in payload["columns"].items()
    }
    return pd.DataFrame(data, index=idx)


def cached_history(cache_key: str, fetch, ttl_seconds: int = DAILY_TTL_SECONDS) -> Optional[pd.DataFrame]:
    """`fetch()` sonucunu Redis'te tutar. Redis erişilemezse (yerel
    geliştirme) cache_service zaten sessizce None/False döndüğü için
    davranış eskisiyle birebir aynı kalır - sadece hızlanma olmaz."""
    from app.core.redis import cache_service

    cached = cache_service.get_json(cache_key)
    if cached:
        try:
            return _from_payload(cached)
        except Exception:
            pass  # bozuk/eski format - sessizce yeniden hesapla

    df = fetch()
    if df is not None and not df.empty:
        try:
            cache_service.set_json(cache_key, _to_payload(df), expire_seconds=ttl_seconds)
        except Exception as e:
            logger.warning(f"Geçmiş fiyat önbelleğe yazılamadı ({cache_key}): {e}")
    return df
