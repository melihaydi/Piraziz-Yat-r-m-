# -*- coding: utf-8 -*-
"""Çıkış Kapısı - bir hisseyi kaç fon tutuyor ve çıkmak isterlerse ne olur.

FİKİR: Fon Akış Radarı (fund_flow_radar.py) paranın nereye GİRDİĞİNİ
gösteriyor. Asıl tehlikeli olan bunun tersi. Bir hisseyi izlediğimiz
fonlar topluca tutuyorsa ve o hissenin günlük hacmi inceyse, fonlar
satmaya karar verdiğinde hepsi aynı dar kapıdan çıkmaya çalışır - haftalar
süren tek yönlü satış baskısı demektir bu. Grafikte önceden hiçbir şey
görünmez.

HESAP: (fonların o hissede tuttuğu TL) / (tipik günlük TL hacim)
      = kaç GÜNLÜK hacim ediyor.

Payı biliyoruz çünkü fon büyüklükleri (TEFAS) ve kompozisyonlar (elle
güncel tutuluyor) zaten uygulamada var. Paydayı da biliyoruz çünkü günlük
mum verisi zaten çekiliyor. Yeni bir veri kaynağı gerekmiyor - sahip
olduğumuz iki şeyin bölümü.

İKİ SINIR, İKİSİ DE EKRANDA YAZILMALI:

1) Bu rakam ALT SINIR. TEFAS'ta ~900 fon var, biz kompozisyonunu
   bildiğimiz avuç dolusu fonu sayıyoruz. Gerçekte o hisseyi tutan daha
   çok fon vardır, yani gerçek kalabalık buradan HER ZAMAN daha kötüdür.
   "Fonların elinde" değil, "izlediğimiz fonların elinde" demek doğrusu.

2) "3 günlük hacim" 3 günde çıkabilirler demek DEĞİL. Piyasanın tamamı
   sen olamazsın; günlük hacmin ancak bir kısmını alabilirsin, üstelik
   satış baskısı hacmi de fiyatı da bozar. Gerçek çıkış her zaman daha
   uzun sürer. Rakam bir ORAN, bir takvim değil.
"""
import logging
import statistics
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

# Sonuc SUREC ICINDE de tutuluyor, yalnizca Redis'te degil.
#
# Neden: hesap ~45 hisse icin gecmis veri cekiyor ve sogukken 35 saniye
# suruyor (olculdu). Bunu bir kullanici istegi icinde yapmak, birinin
# sayfayi 35 saniye beklemesi demek. Girdilerin ikisi de (fon buyuklugu,
# gunluk mum) gunde bir degistigi icin sonuc arka planda hazirlanip
# paylasiliyor; istek yalnizca hazir olani okuyor.
#
# Redis'in ONUNDE duruyor ki Redis erisilemedigi anda (yerel gelistirme ya
# da gecici kesinti) uc yeniden 35 saniyeye dusmesin.
_CACHE_TTL_SECONDS = 6 * 60 * 60
_mem_lock = threading.Lock()
_mem: Dict[str, Any] = {"result": None, "at": 0.0}
# Ayni anda iki hesap baslamasin - biri calisirken gelen istek "hazir
# degil" cevabini alir, ikinci bir 35 saniyelik is baslatmaz.
_compute_lock = threading.Lock()
_computing = False

# Hacim aranacak hisse sayısı. Her ticker bir geçmiş-veri çağrısı demek
# (Redis'te 15 dk önbellekli ama soğukken ağ maliyeti var), oysa fonların
# 50 bin TL tuttuğu bir hissenin çıkış süresini hesaplamanın kimseye
# faydası yok. Önce TL'ye göre sıralayıp yalnızca tepedekilere bakıyoruz.
_VOLUME_LOOKUP_LIMIT = 45

# Tipik günlük hacim kaç güne bakılarak bulunacak.
_VOLUME_WINDOW_DAYS = 30

# Bir hisseyi listeye almak için fonların tutması gereken en az TL. Altındaki
# kalemler gürültü: birkaç yüz bin TL'lik bir pozisyonun "çıkış riski" yok.
_MIN_HELD_TRY = 5_000_000.0


def _median_daily_turnover_try(ticker: str) -> Optional[float]:
    """Son ~30 işlem gününün MEDYAN günlük TL hacmi (fiyat x lot).

    Ortalama değil medyan: tek bir blok işlem ya da bir haber günü
    ortalamayı ikiye katlayıp hisseyi olduğundan likit gösterebilir.
    "Sıradan bir günde ne kadar işlem görüyor" sorusunun doğru cevabı
    medyan.
    """
    try:
        import borsapy
        from app.services.price_history import cached_history

        df = cached_history(
            f"history:1d:{_VOLUME_WINDOW_DAYS}d:{ticker.upper()}",
            lambda: borsapy.Ticker(ticker).history(
                period=f"{_VOLUME_WINDOW_DAYS}d", interval="1d"
            ),
        )
        if df is None or df.empty:
            return None

        turnovers: List[float] = []
        for _, row in df.iterrows():
            try:
                close = float(row["Close"])
                volume = float(row.get("Volume", 0.0))
            except (TypeError, ValueError, KeyError):
                continue
            # NaN kontrolü: NaN != NaN
            if close != close or volume != volume:
                continue
            if close > 0 and volume > 0:
                turnovers.append(close * volume)

        if len(turnovers) < 5:
            # Birkaç günlük veriden "tipik gün" çıkarılamaz - hisseyi
            # uydurma bir sayıyla listelemektense listeden düşürmek doğru.
            return None
        return statistics.median(turnovers)
    except Exception as e:
        logger.warning(f"Cikis kapisi: {ticker} hacmi alinamadi: {e}")
        return None


def _fund_size_try(fund: Optional[Dict[str, Any]]) -> tuple:
    """(buyukluk, kaynak) - once canli TEFAS rakami, olmazsa elle tutulan
    yedek.

    `fund_size_try` TEFAS'in gunluk NAV serisinden geliyor ve o seri
    cekilemediginde None kaliyor. Sadece ona bakip fonu tamamen atlamak,
    gecici bir ag sorununda fonu hesaptan sessizce dusurup kalabaligi
    oldugundan az gostermek demekti - oysa `fund_size` alaninda elle
    guncellenen bir yedek zaten duruyor (bkz. FUND_DETAILS_MAP). Yedek
    daha bayat, o yuzden kaynak ISARETLENIYOR ve ekranda yaziliyor;
    gizlenmiyor.
    """
    if not fund:
        return None, None
    live = fund.get("fund_size_try")
    if live and live > 0:
        return float(live), "tefas"
    raw = fund.get("fund_size")
    if isinstance(raw, str):
        digits = raw.replace("₺", "").replace(",", "").replace(".", "").strip()
        if digits.isdigit():
            value = float(digits)
            if value > 0:
                return value, "static"
    return None, None


def compute_exit_door(limit: int = 25) -> Dict[str, Any]:
    """İzlenen fonların hisse bazında tuttuğu TL ve bunun kaç günlük hacme
    denk geldiği."""
    from app.services.portfolio_ledger import expand_fund_leaf_weights
    from app.services.tefas import tefas_service, BASE_FUNDS, _KNOWN_STOCK_TICKERS

    known_funds = set(BASE_FUNDS.keys())

    held_try: Dict[str, float] = {}
    holders: Dict[str, List[str]] = {}
    covered_funds: List[Dict[str, Any]] = []
    skipped_no_size: List[str] = []

    stale_size_funds: List[str] = []

    for code in sorted(known_funds):
        fund = tefas_service.get_fund(code)
        size, size_source = _fund_size_try(fund)
        if not size:
            # Büyüklüğü bilinmeyen fonun ağırlıkları TL'ye çevrilemez.
            # Sessizce 0 saymak yerine ayrı raporlanıyor: kapsamın nerede
            # eksik olduğunu bilmek, eksik olduğunu gizlemekten iyidir.
            skipped_no_size.append(code)
            continue
        try:
            leaves = expand_fund_leaf_weights(code)
        except Exception as e:
            logger.warning(f"Cikis kapisi: {code} acilamadi: {e}")
            continue
        if not leaves:
            skipped_no_size.append(code)
            continue

        covered_funds.append({
            "code": code,
            "fund_size_try": round(size, 2),
            "size_source": size_source,
        })
        if size_source == "static":
            stale_size_funds.append(code)
        for ticker, frac in leaves.items():
            t = ticker.upper()
            # Yalnızca gerçek hisseler: VIOP/SABIT/BONO gibi kalemlerin ve
            # açılamamış fon kodlarının "çıkış süresi" diye bir şeyi yok.
            if t not in _KNOWN_STOCK_TICKERS or t in known_funds:
                continue
            held_try[t] = held_try.get(t, 0.0) + size * frac
            holders.setdefault(t, []).append(code)

    if not held_try:
        return {
            "rows": [], "covered_fund_count": 0, "covered_funds": [],
            "funds_without_size": skipped_no_size, "funds_with_stale_size": stale_size_funds,
            "volume_window_days": _VOLUME_WINDOW_DAYS,
        }

    ranked = sorted(held_try.items(), key=lambda kv: -kv[1])
    ranked = [(t, v) for t, v in ranked if v >= _MIN_HELD_TRY][:_VOLUME_LOOKUP_LIMIT]

    # Hacimler eşzamanlı çekiliyor - her biri bağımsız bir geçmiş-veri
    # çağrısı, sırayla beklemenin anlamı yok (portfolio.py'deki sinyal
    # ucuyla aynı desen).
    turnovers: Dict[str, Optional[float]] = {}
    if ranked:
        with ThreadPoolExecutor(max_workers=min(len(ranked), 5)) as pool:
            for ticker, turnover in zip(
                [t for t, _ in ranked],
                pool.map(_median_daily_turnover_try, [t for t, _ in ranked]),
            ):
                turnovers[ticker] = turnover

    rows: List[Dict[str, Any]] = []
    for ticker, held in ranked:
        turnover = turnovers.get(ticker)
        rows.append({
            "ticker": ticker,
            "fund_held_try": round(held, 2),
            "median_daily_turnover_try": round(turnover, 2) if turnover else None,
            # Hacmi bilinmeyen hisse için None - 0'a bölüp "sonsuz gün"
            # yazmaktansa "bilinmiyor" demek dürüst olan.
            "days_of_volume": round(held / turnover, 1) if turnover and turnover > 0 else None,
            "fund_count": len(holders.get(ticker, [])),
            "funds": sorted(holders.get(ticker, [])),
        })

    # Sıralama çıkış süresine göre - asıl soru "kim çok tutuyor" değil,
    # "kim dar kapıda". Süresi bilinmeyenler en sona.
    rows.sort(key=lambda r: (r["days_of_volume"] is None, -(r["days_of_volume"] or 0)))

    return {
        "rows": rows[:limit],
        "covered_fund_count": len(covered_funds),
        "covered_funds": covered_funds,
        "funds_without_size": skipped_no_size,
        # Canli TEFAS rakami yerine elle tutulan yedekle sayilanlar - ekran
        # bunu yazmali, yoksa bayat bir buyukluk canli sanilir.
        "funds_with_stale_size": stale_size_funds,
        "volume_window_days": _VOLUME_WINDOW_DAYS,
    }


# --- onbellek ve arka plan hazirligi ---------------------------------------

def _cached() -> Optional[Dict[str, Any]]:
    """Surec ici onbellek, yoksa Redis. Ikisi de bossa None."""
    with _mem_lock:
        if _mem["result"] is not None and (time.time() - _mem["at"]) < _CACHE_TTL_SECONDS:
            return _mem["result"]
    try:
        from app.core.redis import cache_service
        payload = cache_service.get_json("funds:exit-door:v1")
        if payload:
            with _mem_lock:
                _mem["result"], _mem["at"] = payload, time.time()
            return payload
    except Exception:
        pass
    return None


def refresh(force: bool = False) -> Optional[Dict[str, Any]]:
    """Hesabi yapip her iki onbellege de yazar. Ayni anda yalnizca bir
    hesap calisir; ikinci cagri beklemeden None doner."""
    global _computing
    if not force:
        hit = _cached()
        if hit is not None:
            return hit

    with _compute_lock:
        if _computing:
            return None
        _computing = True
    try:
        result = compute_exit_door(limit=50)
        if not result.get("covered_fund_count"):
            # Ici bos sonucu onbellege almiyoruz - gecici bir aksaklik
            # saatlerce bos ekran olarak servis edilmesin (flow-radar ile
            # ayni karar).
            return result
        with _mem_lock:
            _mem["result"], _mem["at"] = result, time.time()
        try:
            from app.core.redis import cache_service
            cache_service.set_json("funds:exit-door:v1", result, expire_seconds=_CACHE_TTL_SECONDS)
        except Exception as e:
            logger.warning(f"Cikis kapisi onbellege yazilamadi: {e}")
        return result
    finally:
        with _compute_lock:
            _computing = False


def get_exit_door(limit: int = 25) -> Dict[str, Any]:
    """Uc noktasinin cagirdigi hali - ASLA uzun sure bloke etmez.

    Hazir sonuc varsa onu doner. Yoksa hesabi arka planda baslatir ve
    `ready: False` doner; arayuz "hazirlaniyor" deyip birazdan tekrar
    sorar. Kullaniciyi 35 saniye bekletmektense hazirlandigini soylemek
    dogru olan.
    """
    hit = _cached()
    if hit is not None:
        return {**hit, "rows": hit.get("rows", [])[:limit], "ready": True}

    threading.Thread(target=refresh, daemon=True, name="exit-door-warm").start()
    return {
        "rows": [], "covered_fund_count": 0, "covered_funds": [],
        "funds_without_size": [], "funds_with_stale_size": [],
        "volume_window_days": _VOLUME_WINDOW_DAYS, "ready": False,
    }


_scheduler_started = False


def start_background_scheduler(interval_seconds: int = _CACHE_TTL_SECONDS) -> None:
    """Acilista ve sonra periyodik olarak hesabi tazeler - boylece ilk
    kullanici 35 saniye beklemez. Diger gunluk isler (tefas, portfolio_
    snapshot, index_tracker) ile ayni desen."""
    global _scheduler_started
    if _scheduler_started:
        return
    _scheduler_started = True

    def loop():
        while True:
            try:
                refresh(force=True)
            except Exception as e:
                logger.warning(f"Cikis kapisi tazelenemedi: {e}")
            time.sleep(max(interval_seconds, 60))

    threading.Thread(target=loop, daemon=True, name="exit-door-scheduler").start()
