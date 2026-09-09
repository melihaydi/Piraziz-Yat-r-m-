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
import time
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

# SEMBOL BAZLI kilit - global DEGIL.
#
# Ilk hali tek bir global kilitti ve tum ucretsiz kotasyon cagrilarini
# siraya sokuyordu: cagiranlar (portfoy/screener) ThreadPoolExecutor ile
# paralel istiyor olsa bile hepsi tek tek bekliyordu. Olculdu: 8 sembol
# "paralel" istendiginde 3.37 saniye - 30 hisselik bir ekranda ~12 saniye,
# yani kullanicinin bildirdigi "veriler asiri gec geliyor".
#
# Sembol basina kilit, ayni sembolu ayni anda iki kez cekmeyi (tek-ucus)
# hala engelliyor ama FARKLI sembollerin paralel gitmesine izin veriyor.
# SUREC ICI onbellek - Redis'in ONUNDE.
#
# prefetch() paralel cekip sonucu Redis'e yaziyor, ardindan cagiran taraf
# dongude tek tek okuyor. Redis erisilemezse (yerel gelistirme ya da prod'da
# gecici bir kesinti) o yazma sessizce basarisiz oluyordu ve dongu her
# sembolu BASTAN cekiyordu - yani on-yukleme isi ikiye katliyor, N ardisik
# ag cagrisi da yerinde duruyordu. Olculdu: 12 sembol seri 41.5sn,
# "on-yuklemeli" 44.4sn (yani hicbir fayda yok).
#
# Surec ici katman bunu Redis'ten BAGIMSIZ hale getiriyor: prefetch burayi
# dolduruyor, dongu buradan okuyor. Redis hala paylasilan/surecler-arasi
# katman olarak duruyor.
_MEM_TTL_SECONDS = 30
_mem: Dict[str, tuple] = {}
_mem_guard = threading.Lock()


def _mem_get(key: str):
    with _mem_guard:
        hit = _mem.get(key)
    if not hit:
        return None
    value, expires_at = hit
    if time.time() >= expires_at:
        with _mem_guard:
            _mem.pop(key, None)
        return None
    return value


def _mem_set(key: str, value) -> None:
    with _mem_guard:
        _mem[key] = (value, time.time() + _MEM_TTL_SECONDS)


_locks_guard = threading.Lock()
_symbol_locks: Dict[str, threading.Lock] = {}


def _lock_for(symbol: str) -> threading.Lock:
    with _locks_guard:
        lock = _symbol_locks.get(symbol)
        if lock is None:
            lock = threading.Lock()
            _symbol_locks[symbol] = lock
        return lock


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
    key = _cache_key(symbol)

    mem = _mem_get(key)
    if mem:
        return mem
    cached = cache_service.get_json(key)
    if cached:
        _mem_set(key, cached)
        return cached

    raw = None
    try:
        from borsapy._providers.isyatirim import get_isyatirim_provider
        # Sağlayıcı bir singleton ve içinde paylaşılan bir HTTP istemcisi
        # tutuyor; eşzamanlı kullanımda sıraya alıyoruz.
        with _lock_for(symbol):
            # Kilidi bekleyen ikinci bir cagri, ilki onbellegi doldurmus
            # olabilir - tekrar bakip gereksiz istegi atliyoruz (tek-ucus).
            again = _mem_get(key) or cache_service.get_json(key)
            if again:
                return again
            raw = get_isyatirim_provider().get_realtime_quote(symbol)
    except Exception as e:
        logger.warning(f"Ucretsiz kotasyon alinamadi ({symbol}): {e}")

    quote = _normalize(symbol, raw, delay_minutes) if raw else None
    if quote is None:
        # Kaynak erişilemiyor - son bilinen değere düş. TradingView'a
        # DÜŞMÜYORUZ; bu modülün varlık sebebi tam olarak o.
        return cache_service.get_json(_stale_key(symbol))

    _mem_set(key, quote)
    cache_service.set_json(key, quote, expire_seconds=_CACHE_TTL_SECONDS)
    cache_service.set_json(_stale_key(symbol), quote, expire_seconds=_STALE_TTL_SECONDS)
    return quote


# Gunluk seri gun icinde yalnizca son bar kadar degisiyor; 15 dakika
# bayatlik gorunmez ve yukariya giden istek sayisini kullanici sayisindan
# tamamen bagimsiz kiliyor.
_CANDLES_TTL_SECONDS = 15 * 60
_CANDLES_STALE_TTL_SECONDS = 24 * 60 * 60


def get_daily_candles(symbol: str, count: int = 250) -> Optional[list]:
    """Ucretsiz gunluk fiyat serisi (Is Yatirim). TradingView'a dokunmaz.

    ONEMLI SINIR: bu kaynak yalnizca KAPANIS veriyor - dondugu OHLC'nin
    dordu de ayni ve hacim 0 (canli dogrulandi). Bu yuzden open/high/low
    UYDURULMUYOR, hepsi kapanisa esitleniyor ve cagiran tarafa bunun
    "yalnizca kapanis" oldugu bildiriliyor (bkz. chart ucundaki
    X-Chart-Line-Only basligi) - mum grafigi olarak cizilirse ekranda
    veri yokmus gibi duz doji dizisi gorunur, dogrusu cizgi grafik.

    Gun ici (1m/1h ...) cozunurluk bu kaynakta YOK.
    """
    from app.core.redis import cache_service

    symbol = symbol.upper()
    key = f"freecandles:{symbol}:1d"
    mem = _mem_get(key)
    if mem:
        return mem
    cached = cache_service.get_json(key)
    if cached:
        _mem_set(key, cached)
        return cached

    rows = None
    try:
        import datetime as _dt
        from borsapy._providers.isyatirim import get_isyatirim_provider
        start = _dt.datetime.now() - _dt.timedelta(days=int(count * 1.6) + 10)
        with _lock_for(f"candles:{symbol}"):
            again = cache_service.get_json(key)
            if again:
                return again
            df = get_isyatirim_provider().get_index_history(symbol, start=start)
        if df is not None and not df.empty:
            rows = []
            for idx, r in df.iterrows():
                close = _to_float(r.get("Close"))
                if close is None or close <= 0:
                    continue
                ts = int(idx.timestamp())
                rows.append({
                    "time": ts,
                    # Uydurma YOK: kaynak yalnizca kapanis veriyor.
                    "open": close, "high": close, "low": close, "close": close,
                    "volume": 0.0,
                })
            rows = rows[-count:]
    except Exception as e:
        logger.warning(f"Ucretsiz gunluk seri alinamadi ({symbol}): {e}")

    if not rows:
        return cache_service.get_json(f"freecandles:stale:{symbol}:1d")

    _mem_set(key, rows)
    cache_service.set_json(key, rows, expire_seconds=_CANDLES_TTL_SECONDS)
    cache_service.set_json(f"freecandles:stale:{symbol}:1d", rows,
                           expire_seconds=_CANDLES_STALE_TTL_SECONDS)
    return rows


# Toplu on-yukleme icin is parcacigi sayisi. Is Yatirim'in ucu soguk
# cagrida ~0.5-3.7sn surebiliyor; 12 paralel istek 100+ sembollu bir
# ekrani makul surede dolduruyor, ayni zamanda ucu doverek 429 yemiyoruz.
_PREFETCH_WORKERS = 12


def prefetch(symbols, delay_minutes: int = 15) -> None:
    """Verilen sembollerin kotasyonlarini PARALEL cekip onbellege koyar.

    NEDEN GEREKLI: get_delayed_quote artik bir AG cagrisi (eskiden bellek
    ici bir islemdi). Cagiran taraflarin cogu sembolleri duz bir dongude
    geziyor - orn. /screener/ tum takip listesini tek tek istiyor. Seri
    halde bu 100+ ardisik HTTP istegi demek; olculdu: 8 sembol seri 29.9sn,
    paralel 3.5sn (8.6x). Kullanicinin "veriler asiri gec geliyor"
    bildirimi tam olarak buydu.

    Bu fonksiyon dongunun ONCESINDE cagriliyor; sonrasindaki tek tek
    get_quote cagrilari onbellekten donuyor ve dongu ag beklemesi
    yapmiyor. Hata yutuluyor - on-yukleme bir hizlandirma, dogruluk
    kosulu degil.
    """
    from concurrent.futures import ThreadPoolExecutor

    unique = [s for s in dict.fromkeys(x.upper() for x in symbols if x)]
    if not unique:
        return
    try:
        with ThreadPoolExecutor(max_workers=min(_PREFETCH_WORKERS, len(unique))) as pool:
            list(pool.map(lambda sym: get_quote(sym, delay_minutes), unique))
    except Exception as e:
        logger.warning(f"Ucretsiz kotasyon on-yuklemesi basarisiz: {e}")
