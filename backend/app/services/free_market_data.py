# -*- coding: utf-8 -*-
"""Ücretsiz (free tier) kullanıcılar için BIST kotasyonu - İş Yatırım.

NEDEN VAR: free hesaplar şimdiye kadar da 15 dakika gecikmeli fiyat
görüyordu ama o fiyat, hesap sahibinin KENDİ TradingView oturumundan
geliyordu; `get_delayed_quote` canlı kotasyonu alıp 1 dakikalık mumlarla
geriye kaydırıyordu. Free kayıtlar internete açılınca bu, gelen her
kullanıcının tek bir kişisel TradingView hesabının üstünden veri çekmesi
demek olurdu - hem ölçeklenmez hem de o hesabın kullanım koşulları
açısından doğru değil.

BIST'in 15 dakika gecikmeli verisi zaten kamuya açık. Bu modül onu İş
Yatırım'ın kendi açık uçlarından (borsapy'nin `isyatirim` sağlayıcısı,
OneEndeks API) alıyor. TradingView bağlantısına HİÇ DOKUNMUYOR: ne
paylaşılan akışa abone oluyor, ne o tek grafik oturumunu sıfırlıyor.

Paylaşılan Redis önbelleği burada asıl mesele: N tane free kullanıcı aynı
sembole baktığında yukarıya TEK bir istek gidiyor. Önbelleksiz hâlde
kullanıcı sayısıyla doğru orantılı bir yük İş Yatırım'a binerdi ve
çözdüğümüz problemi adres değiştirerek tekrarlamış olurduk.
"""
import logging
import threading
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

# Free tier zaten 15 dakika gecikmeli; 60 saniyelik önbellek bunun yanında
# görünmez ama yukarıdaki yükü kullanıcı sayısından bağımsız hale getiriyor.
_CACHE_TTL_SECONDS = 60

# Kaynak geçici olarak erişilemezse SON BİLİNEN değer bu süre boyunca
# sunulmaya devam ediyor. TradingView'a düşmek YOK - bu modülün varlık
# sebebi tam olarak oraya düşmemek. Bayat bir fiyat göstermek, kullanıcının
# özel hesabından veri çekmekten iyidir; hiçbir şey göstermemekten de.
_STALE_TTL_SECONDS = 60 * 60

_lock = threading.Lock()


def _cache_key(symbol: str) -> str:
    return f"freequote:{symbol.upper()}"


def _stale_key(symbol: str) -> str:
    return f"freequote:stale:{symbol.upper()}"


def _to_float(v) -> Optional[float]:
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    return None if f != f else f  # NaN


def _normalize(symbol: str, raw: Dict[str, Any], delay_minutes: int) -> Optional[Dict[str, Any]]:
    """İş Yatırım yanıtını market_data_service.get_quote() ile AYNI şekle
    çevirir - çağıranların hepsi o şekli bekliyor.

    Dikkat: İş Yatırım'ın `close` alanı ÖNCEKİ kapanış (canlı doğrulandı:
    last=301.0, close=305.0, change=-4.0 -> 305-4=301). `close`'u güncel
    fiyat sanmak değişim yüzdesini sessizce ters çevirirdi.
    """
    last = _to_float(raw.get("last"))
    if last is None or last <= 0:
        return None

    prev_close = _to_float(raw.get("close"))
    change = _to_float(raw.get("change"))
    change_pct = _to_float(raw.get("change_percent"))

    # Eksik olanı türet - ama uydurma: ancak gerçek bir çapa varsa.
    if change is None and prev_close is not None:
        change = round(last - prev_close, 4)
    if change_pct is None and prev_close:
        change_pct = round((last - prev_close) / prev_close * 100, 2)

    return {
        "symbol": symbol.upper(),
        "last": last,
        "open": _to_float(raw.get("open")),
        "high": _to_float(raw.get("high")),
        "low": _to_float(raw.get("low")),
        "prev_close": prev_close,
        "change": change,
        "change_percent": change_pct,
        "bid": _to_float(raw.get("bid")),
        "ask": _to_float(raw.get("ask")),
        "volume": _to_float(raw.get("volume")),
        "exchange": "BIST",
        "description": None,
        # Bu alanlar İş Yatırım kotasyonunda yok. 0 DEĞİL None: 0 gerçek bir
        # "F/K sıfır" değeriyle karışır ve ekranda uydurma bir rakam olur.
        "eps": None,
        "pe_ratio": None,
        "market_cap": None,
        "is_delayed": True,
        "delay_minutes": delay_minutes,
        "source": "isyatirim",
    }


def get_quote(symbol: str, delay_minutes: int = 15) -> Optional[Dict[str, Any]]:
    """Ücretsiz gecikmeli kotasyon. TradingView'a hiç dokunmaz.
    Kaynak erişilemezse son bilinen değeri döner, o da yoksa None."""
    from app.core.redis import cache_service

    symbol = symbol.upper()
    cached = cache_service.get_json(_cache_key(symbol))
    if cached:
        return cached

    raw = None
    try:
        from borsapy._providers.isyatirim import get_isyatirim_provider
        # Sağlayıcı bir singleton ve içinde paylaşılan bir HTTP istemcisi
        # tutuyor; eşzamanlı kullanımda sıraya alıyoruz.
        with _lock:
            raw = get_isyatirim_provider().get_realtime_quote(symbol)
    except Exception as e:
        logger.warning(f"Ucretsiz kotasyon alinamadi ({symbol}): {e}")

    quote = _normalize(symbol, raw, delay_minutes) if raw else None
    if quote is None:
        # Kaynak erişilemiyor - son bilinen değere düş. TradingView'a
        # DÜŞMÜYORUZ; bu modülün varlık sebebi tam olarak o.
        return cache_service.get_json(_stale_key(symbol))

    cache_service.set_json(_cache_key(symbol), quote, expire_seconds=_CACHE_TTL_SECONDS)
    cache_service.set_json(_stale_key(symbol), quote, expire_seconds=_STALE_TTL_SECONDS)
    return quote
