"""TÜFE'ye göre reel getiri ve alternatif varlık karşılaştırması.

Neden elle tutulan bir TÜFE tablosu YOK: borsapy zaten TCMB'nin resmi
enflasyon hesaplayıcı API'sini sarmalıyor (borsapy.Inflation().calculate),
canlı olarak. Doğrulandı (2026-08-25, yerelden): calculate(100000, "2024-01",
"2026-07") -> {'total_change': 112.28, 'start_cpi': 1984.02, 'end_cpi':
4211.58, ...} ve latest() -> {'yearly_inflation': 31.75, 'monthly_inflation':
1.78} - bu ikisi de TÜİK'in Temmuz 2026 resmi bülteniyle (%31,75 yıllık,
%1,78 aylık) birebir eşleşiyor. TCMB'nin kendi hesaplayıcısı, TÜİK'in
2025'te yaptığı baz yılı değişikliğini (2003=100 -> 2025=100) zaten kendi
içinde çözüyor - biz bu rebase'le hiç uğraşmıyoruz.

Aynı şekilde USD/altın karşılaştırması için borsapy.FX(...).history()
kullanılıyor (canlidoviz/dovizcom kaynaklı, gerçek günlük TL bazlı fiyat
serisi) - tefas.py'nin _build_drift_factors_sync'inin borsapy.Ticker
kullandığı REST-çağrısı deseniyle aynı mantık: canlı akış/websocket
oturumunu paylaşmadan ayrı bir REST isteği.
"""
import datetime
import logging
from typing import Optional

import borsapy

from app.core.redis import cache_service

logger = logging.getLogger(__name__)

# Gerçek zamanlı bir mevduat faizi veri kaynağı yok - piyasa ortalamasına
# yakın tek bir sabit kullanılıyor, elle (ayda bir) güncellenmeli.
DEPOSIT_ANNUAL_RATE_PCT = 45.0

# TÜFE ayda bir güncelleniyor, kullanıcı bazlı değil (aynı (start_ym, end_ym)
# çifti herkes için aynı sonucu verir) - 24 saatlik cache TCMB'ye her
# portföy sayfası açılışında gitmeyi önlüyor.
_TUFE_CACHE_TTL_SECONDS = 24 * 60 * 60
# TÜİK'in "en son mevcut ay" bilgisini (latest()) ayrıca, daha kısa TTL'le
# cache'liyoruz - o da ayda bir değişiyor ama calculate() ile farklı bir
# endpoint/anahtar olduğu için ayrı tutuluyor.
_LATEST_MONTH_CACHE_TTL_SECONDS = 6 * 60 * 60


def _to_year_month(d: datetime.date) -> str:
    return f"{d.year:04d}-{d.month:02d}"


def _latest_available_year_month() -> Optional[str]:
    """TÜİK'in TÜFE'yi gerçekten yayınladığı en son ay ("YYYY-MM"). TÜİK her
    ayın 3'ünde bir önceki ayın verisini yayınlıyor - yani "bugünün ayı" çoğu
    zaman henüz mevcut değildir (TCMB'nin calculate() uç noktası bunun için
    500 döner - confirmed live: 2026-08-25'te "2026-08" istenince 500). Bu
    yüzden end_date'i her zaman gerçekte var olan en son aya CLAMP ediyoruz,
    "bugün"e değil."""
    cache_key = "inflation:latest_month"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached.get("year_month")
    try:
        latest = borsapy.Inflation().latest()
        year_month = latest["date"][:7]  # "YYYY-MM-DD" -> "YYYY-MM"
    except Exception as e:
        logger.warning(f"TCMB'den en son TÜFE ayı alınamadı: {e}")
        return None
    cache_service.set_json(cache_key, {"year_month": year_month}, expire_seconds=_LATEST_MONTH_CACHE_TTL_SECONDS)
    return year_month


def cumulative_tufe_pct(start_date: datetime.date, end_date: datetime.date) -> Optional[float]:
    """start_date'ten end_date'e kümülatif TÜFE değişimi (%), TCMB'nin
    resmi enflasyon hesaplayıcısından. Ay hassasiyetinde çalışır - end_date
    henüz TÜFE'si yayınlanmamış bir ayın içindeyse, otomatik olarak en son
    yayınlanmış aya geri çekilir. TCMB'ye erişilemezse ya da aralık bir
    aydan kısaysa None döner."""
    start_ym = _to_year_month(start_date)
    end_ym = _to_year_month(end_date)

    latest_ym = _latest_available_year_month()
    if latest_ym and end_ym > latest_ym:
        end_ym = latest_ym

    if start_ym >= end_ym:
        # TCMB'nin hesaplayıcısı ay bazlı çalışıyor - aynı ay içindeki (ya
        # da ters) iki tarih için "Start date must be before end date"
        # hatası veriyor. Yeni açılmış bir portföyde SIK karşılaşılacak,
        # beklenen bir durum - hata değil, sadece "henüz bir tam ay
        # geçmedi" demek, o yüzden WARNING loglamıyoruz.
        return None

    cache_key = f"inflation:tufe:{start_ym}:{end_ym}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached.get("tufe_pct")

    try:
        result = borsapy.Inflation().calculate(100000, start_ym, end_ym)
        tufe_pct = round(float(result["total_change"]), 2)
    except Exception as e:
        logger.warning(f"TCMB enflasyon hesaplayıcısına erişilemedi: {e}")
        return None

    cache_service.set_json(cache_key, {"tufe_pct": tufe_pct}, expire_seconds=_TUFE_CACHE_TTL_SECONDS)
    return tufe_pct


def real_return_summary(nominal_pct: float, start_date: datetime.date, end_date: datetime.date) -> Optional[dict]:
    """{"nominal_pct", "real_pct", "tufe_pct"} - TCMB'nin resmi enflasyon
    hesaplayıcısına göre. TÜFE verisi alınamazsa None döner - yanlış bir
    sayı göstermektense hiç göstermemek tercih edildi."""
    tufe_pct = cumulative_tufe_pct(start_date, end_date)
    if tufe_pct is None:
        return None

    real_pct = round(((1 + nominal_pct / 100) / (1 + tufe_pct / 100) - 1) * 100, 2)
    return {"nominal_pct": round(nominal_pct, 2), "real_pct": real_pct, "tufe_pct": tufe_pct}


def deposit_alt_return_pct(start_date: datetime.date, end_date: datetime.date) -> float:
    """DEPOSIT_ANNUAL_RATE_PCT'i basit (bileşik olmayan) günlük orana bölüp
    aralığa yayar - kesin bir mevduat simülasyonu değil, kabaca bir
    karşılaştırma noktası."""
    days = (end_date - start_date).days
    return round(DEPOSIT_ANNUAL_RATE_PCT * days / 365, 2)


def alt_asset_return_pct(asset: str, start_date: datetime.date) -> Optional[float]:
    """start_date'ten bugüne TL bazlı % değişim. `asset`: "USD" ya da
    "gram-altin" (borsapy.FX'in kabul ettiği semboller). Geçmiş veri
    çekilemezse None - hiçbir sayı uydurulmaz."""
    try:
        # Gunluk cozunurluklu bir karsilastirma metrigi - portfoy sayfasi
        # her acildiginda yeniden cekmesi gereksiz. 1 saat fazlasiyla taze.
        from app.services.price_history import cached_history
        df = cached_history(
            f"history:fx:{asset}:{start_date.isoformat()}",
            lambda: borsapy.FX(asset).history(start=start_date.isoformat()),
            ttl_seconds=60 * 60,
        )
        if df is None or df.empty:
            return None
        start_price = float(df.iloc[0]["Close"])
        end_price = float(df.iloc[-1]["Close"])
        if start_price <= 0:
            return None
        return round((end_price / start_price - 1) * 100, 2)
    except Exception as e:
        logger.warning(f"{asset} geçmiş fiyatına erişilemedi: {e}")
        return None
