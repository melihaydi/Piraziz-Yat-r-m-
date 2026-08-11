import logging
import pandas as pd
import borsapy
import threading
import time
import datetime
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Dict, List, Any, Optional
from datetime import timedelta

from app.core.redis import cache_service
from app.services.market_data import market_data_service

logger = logging.getLogger(__name__)

# Used by get_live_estimated_return() to tell a real stock ticker apart from
# a fund-composition category label ("Ters Repo", "Nakit", "Hisse Senedi
# (BIST)", etc.) before ever calling get_quote() - see that method for why
# checking the quote's truthiness alone isn't enough.
_KNOWN_STOCK_TICKERS = {t["ticker"] for t in market_data_service.tickers}

# A fund's disclosed composition sometimes includes plain fixed-income
# holdings (a bank deposit, labeled "Mevduat" or, informally, "Sabit"; a
# bond, "Bono") rather than a stock or another fund - each earns a fixed,
# user-confirmed daily rate rather than anything we can look up a live
# quote for.
_FIXED_RATE_HOLDING_DAILY_PCT = {
    "MEVDUAT": 0.12,
    "SABIT": 0.12,
    "SABİT": 0.12,
    "BONO": 0.11,
}
_TR_TZ = datetime.timezone(timedelta(hours=3))


def _deposit_days_for_weekday(weekday: int) -> int:
    """weekday: Monday=0 ... Sunday=6 (Python's datetime.weekday()
    convention). A bank deposit accrues interest every calendar day,
    including weekends, unlike stock prices which only move on trading days
    - so a Monday estimate (vs. Friday's close) must count 3 days of
    deposit interest, not 1, or it understates the deposit holding's
    contribution. Does not account for market holidays (no BIST holiday
    calendar in this codebase yet) - weekends are the dominant case."""
    return 3 if weekday == 0 else 1


def _calendar_days_since_last_bist_session() -> int:
    return _deposit_days_for_weekday(datetime.datetime.now(_TR_TZ).weekday())

# TEFAS's own API (via pytefas) partitions ALL funds into 5 separate "kind"
# buckets: YAT (yatırım fonları), EMK (emeklilik), BYF (borsa yatırım/ETF),
# GYF (gayrimenkul/real estate) and GSYF (girişim sermayesi/venture capital) -
# a fund only exists under exactly one of these, and a query for the wrong
# kind returns nothing for it, silently, with no error. The price/return and
# chart-history fetchers below previously only ever tried YAT and EMK, so any
# tracked fund that happens to actually be filed under BYF/GYF/GSYF (several
# "Serbest"/"Değişken" funds are) NEVER found real data and permanently fell
# back to the hardcoded placeholder numbers/synthetic chart - this is what
# caused PHE/PBR/DFI's returns and charts to be specifically, persistently
# wrong. Every fetch now tries all 5 kinds.
TEFAS_FUND_KINDS = ["YAT", "EMK", "BYF", "GYF", "GSYF"]

# Real fallback prices from TEFAS (July 2026)
BASE_FUNDS = {
    "PHE": {"name": "Pusula Portföy Hisse Senedi Fonu", "category": "Hisse Senedi", "price": 3.8827, "category_tr": "Hisse Senedi"},
    "PBR": {"name": "Pusula Portföy Birinci Değişken Fon", "category": "Değişken", "price": 5.4675, "category_tr": "Değişken"},
    "DFI": {"name": "Atlas Portföy Serbest Fon", "category": "Serbest", "price": 5.0932, "category_tr": "Serbest Fon"},
    "TLY": {"name": "Tera Portföy Birinci Serbest Fon", "category": "Serbest", "price": 7457.48, "category_tr": "Serbest Fon"},
    "TMV": {"name": "Tera Portföy Algoritmik Stratejiler Serbest Fon", "category": "Serbest", "price": 7.7990, "category_tr": "Serbest Fon"},
    "PUK": {"name": "Pusula Portföy Katılım Hisse Senedi Fonu", "category": "Katılım", "price": 1.1661, "category_tr": "Katılım / Hisse Senedi"},
    "PKZ": {"name": "Pusula Portföy İkinci Serbest (Hisse Senedi Yoğun) Fon", "category": "Serbest Yoğun", "price": 13.4416, "category_tr": "Serbest Fon"},
    "PCS": {"name": "Pusula Portföy Para Piyasası Fonu", "category": "Para Piyasası", "price": 8.2528, "category_tr": "Para Piyasası Fonu"},
    "ABG": {"name": "Pusula Portföy ABG Değişken Fon", "category": "Değişken", "price": 10.0000, "category_tr": "Değişken Fon"},
    # Name/price are placeholders only - _fetch_prices_sync() overwrites both
    # from TEFAS's own real per-fund data the moment the first real crawl
    # succeeds (see its `name = series[0][2] or meta.get("name", ...)`), so
    # this doesn't need to be exact, just present so the code starts tracking it.
    "PRY": {"name": "PRY Fonu", "category": "Değişken", "price": 10.0000, "category_tr": "Değişken Fon"},
    # PNU/PGH/PA2/PHN are Pusula Portföy sister funds held inside PBR's own
    # composition (see FUND_DETAILS_MAP["PBR"]) - tracked here so PBR's live
    # estimate can recurse into them / fall back to their real daily_return.
    # Confirmed by the user (2026-08-10): PHN is a fund, not a stock -
    # PBR's composition previously carried it as an unresolvable plain
    # ticker for exactly that reason.
    "PNU": {"name": "Pusula Portföy İkinci Para Piyasası (TL) Fonu", "category": "Para Piyasası", "price": 10.0000, "category_tr": "Para Piyasası Fonu"},
    "PGH": {"name": "Pusula Portföy Güney Hisse Senedi Serbest (TL) Fon", "category": "Serbest Yoğun", "price": 10.0000, "category_tr": "Serbest Fon"},
    "PA2": {"name": "Pusula Portföy Altın Katılım Fonu", "category": "Katılım", "price": 10.0000, "category_tr": "Katılım / Hisse Senedi"},
    "PHN": {"name": "PHN Fonu", "category": "Değişken", "price": 10.0000, "category_tr": "Değişken Fon"},
    # KVR/PFS/PSE/BAC are Atlas Portföy sister funds held inside DFI's own
    # composition (see FUND_DETAILS_MAP["DFI"]), same rationale as
    # PNU/PGH/PA2/PHN above - PSE/BAC confirmed as funds (not stocks) by
    # the user (2026-08-10).
    "KVR": {"name": "Atlas Portföy Kısa Vadeli Katılım Serbest Fon", "category": "Katılım", "price": 10.0000, "category_tr": "Katılım / Hisse Senedi"},
    "PFS": {"name": "Atlas Portföy Fon Sepeti Fonu", "category": "Serbest", "price": 10.0000, "category_tr": "Serbest Fon"},
    "PSE": {"name": "PSE Fonu", "category": "Serbest", "price": 10.0000, "category_tr": "Serbest Fon"},
    "BAC": {"name": "BAC Fonu", "category": "Serbest", "price": 10.0000, "category_tr": "Serbest Fon"},
    # HMV is a real, independent TEFAS fund (Hedef Portföy Yönetimi) that
    # also happens to be one of TLY's own disclosed holdings (see TLY's
    # assets_distribution below) - tracked here both so it's browsable on
    # its own in the fund list/screener, and so TLY's live estimate can
    # resolve this leg via its real daily_return once the TEFAS crawl
    # populates it (same placeholder-overwritten-by-real-data pattern as PRY).
    "HMV": {"name": "Hedef Portföy Mavi Hisse Senedi Serbest (TL) Fon", "category": "Serbest Yoğun", "price": 10.0000, "category_tr": "Serbest Fon"},
}

# Baseline fallback values (exact prices & returns from July 20, 2026)
# These are used as instant fallbacks before first crawl completes (Request 3!)
FALLBACKS = {
    "PHE": {"price": 3.8827, "daily": -1.65, "weekly": 1.25, "monthly": 4.82},
    "PBR": {"price": 5.4675, "daily": -1.25, "weekly": 0.88, "monthly": 3.42},
    "DFI": {"price": 5.0932, "daily": -0.45, "weekly": 1.95, "monthly": 6.84},
    "TLY": {"price": 7457.4882, "daily": 0.05, "weekly": 0.38, "monthly": 1.52},
    "TMV": {"price": 7.7990, "daily": 0.66, "weekly": 3.12, "monthly": 9.45},
    "PUK": {"price": 1.1661, "daily": -0.64, "weekly": 1.05, "monthly": 3.88},
    "PKZ": {"price": 13.4416, "daily": -4.6673, "weekly": -2.15, "monthly": 5.85},
    "PCS": {"price": 8.2528, "daily": -3.7028, "weekly": -1.82, "monthly": 3.12},
    "ABG": {"price": 10.0000, "daily": 0.15, "weekly": 0.55, "monthly": 2.45},
    "PRY": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PNU": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PGH": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PA2": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PHN": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "KVR": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PFS": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "PSE": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "BAC": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0},
    "HMV": {"price": 10.0000, "daily": 0.0, "weekly": 0.0, "monthly": 0.0}
}

# Module-level (not just get_fund()-local) so get_live_estimated_return()
# below can also walk it - a fund's assets_distribution entry can itself be
# another tracked fund's code (e.g. PBR holds PKZ/PCS/PRY, DFI holds ABG),
# which the live intraday estimator resolves recursively instead of trying
# to look up a nonexistent stock quote for it.
FUND_DETAILS_MAP: Dict[str, Dict[str, Any]] = {
    "PHE": {
        "fund_size": "₺1,854,200,000",
        "risk_level": 6,
        "manager": "Ömer Faruk Kar / Pusula Portföy",
        "assets_distribution": [
            {"name": "KTLEV", "value": 9.60},
            {"name": "ODINE", "value": 9.48},
            {"name": "GUNDG", "value": 8.91},
            {"name": "PKZ", "value": 8.13},
            {"name": "PCS", "value": 8.07},
            {"name": "PASEU", "value": 6.64},
            {"name": "HEDEF", "value": 5.11},
            {"name": "THYAO", "value": 4.75},
            {"name": "AKBNK", "value": 4.05},
            {"name": "TRALT", "value": 3.87},
            {"name": "YKBNK", "value": 3.62},
            {"name": "BALSU", "value": 2.88},
            {"name": "DSTKF", "value": 2.77},
            {"name": "ISCTR", "value": 2.64},
            {"name": "ANELE", "value": 2.20},
            {"name": "TATEN", "value": 1.86},
            {"name": "MGROS", "value": 1.76},
            {"name": "SAHOL", "value": 1.74},
            {"name": "BIMAS", "value": 1.59},
            {"name": "TCELL", "value": 1.51},
            {"name": "KCHOL", "value": 1.40},
            {"name": "TTKOM", "value": 1.36}
        ]
    },
    "PBR": {
        "fund_size": "₺29,530,000,000",
        "risk_level": 4,
        "manager": "Ali Rıza / Pusula Portföy",
        # Refreshed 2026-08-10 per the user's updated TEFAS breakdown -
        # replaces the prior (stale) composition wholesale rather than
        # diffing entry-by-entry. "as_of" is the date these weights were
        # confirmed accurate - get_live_estimated_return() uses it as the
        # reference point for weight-drift adjustment (see
        # _build_drift_factors_sync): a holding that has quietly
        # outperformed/underperformed its peers since this date has, in
        # reality, grown/shrunk as a share of the fund even though TEFAS
        # hasn't published a new official composition yet.
        "as_of": "2026-08-10",
        "assets_distribution": [
            {"name": "ODINE", "value": 16.8},
            {"name": "HEDEF", "value": 11.2},
            {"name": "GUNDG", "value": 11.1},
            {"name": "PASEU", "value": 10.7},
            {"name": "KTLEV", "value": 8.9},
            {"name": "PCS", "value": 8.6},
            {"name": "BALSU", "value": 6.2},
            {"name": "ANELE", "value": 6.0},
            {"name": "DSTKF", "value": 5.3},
            {"name": "PKZ", "value": 4.5},
            {"name": "AKSEN", "value": 3.4},
            {"name": "TMPOL", "value": 2.0},
            {"name": "IZFAS", "value": 1.8},
            {"name": "TATEN", "value": 1.4},
            # PRY/PHN/PA2 - Pusula Portföy fund codes, confirmed by the user
            # (not stocks). None has its own known composition in
            # FUND_DETAILS_MAP to recurse into, so each resolves via its own
            # real TEFAS daily_return instead (see BASE_FUNDS/FALLBACKS and
            # get_live_estimated_return's BASE_FUNDS fallback step).
            {"name": "PRY", "value": 0.9},
            {"name": "DAPGM", "value": 0.5},
            {"name": "PHN", "value": 0.4},
            {"name": "SKBNK", "value": 0.1},
            {"name": "SARAE", "value": 0.1},
            {"name": "PA2", "value": 0.1}
        ]
    },
    "DFI": {
        "fund_size": "₺32,460,000,000",
        "risk_level": 5,
        "manager": "Hakan Ateş / Atlas Portföy",
        # Refreshed 2026-08-10 per the user's updated TEFAS breakdown.
        "as_of": "2026-08-10",
        "assets_distribution": [
            {"name": "IEYHO", "value": 41.2},
            # Bank deposit holding - fixed daily-return path below (0.12%/day, per the user).
            {"name": "MEVDUAT", "value": 25.9},
            {"name": "ABG", "value": 23.0},
            # PSE/BAC - Atlas Portföy fund codes, confirmed by the user (not
            # stocks) - same daily_return fallback resolution as PRY/PHN/PA2
            # in PBR above.
            {"name": "PSE", "value": 5.3},
            {"name": "ISKPL", "value": 3.3},
            {"name": "BAC", "value": 1.1},
            # LDR Turizm A.Ş. (BIST:LIDER, confirmed real ticker) - note the
            # PLAIN ASCII "I", not the Turkish dotted "İ" the user typed:
            # "İ".upper() stays "İ" under Python's default Unicode casing,
            # so a dotted-İ spelling here would never match the ASCII
            # "LIDER" ticker registered in market_data.py's universe.
            {"name": "LIDER", "value": 0.2},
            {"name": "KVR", "value": 0.1}
        ]
    },
    "TLY": {
        "fund_size": "₺3,125,000,000",
        "risk_level": 3,
        "manager": "Gökhan Şen / Tera Portföy",
        # Refreshed 2026-08-10 per the user's updated TEFAS breakdown - this
        # update ADDS a fixed-rate SABIT deposit holding (16.5%) that TLY
        # never carried before (unlike TMV, which already had one - see that
        # entry's history). Same fixed daily-return path as TMV's, 0.12%/day.
        "as_of": "2026-08-10",
        "assets_distribution": [
            {"name": "OZATD", "value": 32.9},
            {"name": "SABIT", "value": 16.5},
            {"name": "DSTKF", "value": 10.8},
            {"name": "TEHOL", "value": 9.1},
            {"name": "PEKGY", "value": 8.7},
            # HMV is itself a tracked fund (see BASE_FUNDS/FALLBACKS above),
            # not a stock - resolved via its own daily_return, not a quote.
            {"name": "HMV", "value": 4.8},
            {"name": "TERA", "value": 4.4},
            {"name": "TRHOL", "value": 3.9},
            {"name": "ANELE", "value": 1.9},
            {"name": "ALKLC", "value": 1.7},
            {"name": "BIGEN", "value": 1.6},
            {"name": "SELEC", "value": 1.5},
            {"name": "HEDEF", "value": 0.7},
            {"name": "SVGYO", "value": 0.5},
            {"name": "SARAE", "value": 0.3},
            {"name": "EUPWR", "value": 0.3},
            {"name": "MANAS", "value": 0.3},
            {"name": "TMPOL", "value": 0.1},
            {"name": "DAPGM", "value": 0.1},
            {"name": "GESAN", "value": 0.0},
            {"name": "YKBNK", "value": 0.0},
            {"name": "EFOR", "value": 0.0},
            {"name": "METEN", "value": 0.0}
        ]
    },
    "TMV": {
        "fund_size": "₺26,000,000,000",
        "risk_level": 6,
        "manager": "Yapay Zekâ Algoritması / Tera Portföy",
        # Refreshed 2026-08-10 per the user's updated TEFAS breakdown.
        "as_of": "2026-08-10",
        "assets_distribution": [
            # Fixed daily-return deposit path below (0.12%/day, weekend-inclusive).
            {"name": "SABIT", "value": 45.2},
            {"name": "OZATD", "value": 12.3},
            {"name": "TEHOL", "value": 10.3},
            {"name": "TRHOL", "value": 7.0},
            # "VİOP" (Vadeli İşlem ve Opsiyon Piyasası) is a MARKET SEGMENT,
            # not a single tradable ticker - no real BIST quote to resolve
            # this against, left unresolved rather than guessing one.
            {"name": "VIOP", "value": 4.6},
            {"name": "ANELE", "value": 4.3},
            {"name": "SELEC", "value": 3.6},
            {"name": "PEKGY", "value": 2.6},
            {"name": "DSTKF", "value": 1.9},
            {"name": "ALKLC", "value": 1.8},
            {"name": "EUPWR", "value": 1.6},
            {"name": "TERA", "value": 1.1},
            # "VDMK" (Varlığa Dayalı Menkul Kıymet / asset-backed security)
            # is an instrument CATEGORY, not a single ticker - same
            # reasoning as VİOP above, left unresolved.
            {"name": "VDMK", "value": 0.9},
            # Bond holding - fixed daily-return path below (0.11%/day, per the user).
            {"name": "BONO", "value": 0.5},
            {"name": "GESAN", "value": 0.4},
            {"name": "AKSEN", "value": 0.4},
            {"name": "TURSG", "value": 0.3},
            {"name": "HEDEF", "value": 0.3},
            {"name": "YKBNK", "value": 0.3},
            {"name": "KORDS", "value": 0.2},
            {"name": "SVGYO", "value": 0.1},
            {"name": "MANAS", "value": 0.0}
        ]
    },
    "PUK": {
        "fund_size": "₺425,800,000",
        "risk_level": 6,
        "manager": "Melih Aydın / Pusula Portföy",
        "assets_distribution": [{"name": "Katılım Hisse Senedi", "value": 95}, {"name": "Kira Sertifikası (Sukuk)", "value": 5}]
    },
    "PKZ": {
        "fund_size": "₺612,400,000",
        "risk_level": 6,
        "manager": "Ömer Faruk Kar / Pusula Portföy",
        "assets_distribution": [
            {"name": "Hisse Senedi (BIST)", "value": 85.0},
            {"name": "Ters Repo", "value": 10.0},
            {"name": "Nakit", "value": 5.0}
        ]
    },
    "PCS": {
        "fund_size": "₺4,850,200,000",
        "risk_level": 1,
        "manager": "Zeynep Yılmaz / Pusula Portföy",
        "assets_distribution": [
            {"name": "Ters Repo", "value": 60.0},
            {"name": "Finansman Bonosu", "value": 35.0},
            {"name": "Nakit", "value": 5.0}
        ]
    },
    "ABG": {
        "fund_size": "₺742,000,000",
        "risk_level": 4,
        "manager": "Ömer Faruk Kar / Pusula Portföy",
        "assets_distribution": [
            {"name": "Özel Sektör Tahvili", "value": 50.0},
            {"name": "Hisse Senedi", "value": 35.0},
            {"name": "Nakit ve Repo", "value": 15.0}
        ]
    }
}

class TefasService:
    def __init__(self):
        self._lock = threading.Lock()
        self._cached_funds = {}
        self._last_refresh = datetime.datetime.min
        self._refresh_interval = timedelta(hours=1)
        self._is_fetching = False
        self._scheduler_started = False

        # Real historical NAV series per fund code, built from actual TEFAS daily
        # snapshots (previously the chart was 100% fabricated - see get_fund_candles).
        self._history_cache: Dict[str, List[Dict[str, Any]]] = {}
        self._history_last_built = datetime.datetime.min
        self._history_refresh_interval = timedelta(hours=6)
        self._is_building_history = False

        # Shared raw-data snapshot cache: price-refresh and history-build need
        # almost the same TEFAS date range, so they reuse one fetch instead of
        # each hitting TEFAS independently (see _get_snapshot).
        self._snapshot_cache: Dict[str, Any] = {}
        self._snapshot_cache_days = 0
        self._snapshot_fetched_at = datetime.datetime.min
        self._snapshot_ttl = timedelta(minutes=10)
        # Separate from self._lock (which only ever guards fast in-memory
        # state updates) - held for the full duration of an actual TEFAS
        # network fetch, so a second caller that also misses the cache
        # blocks here instead of firing its own concurrent request. TEFAS's
        # API does not tolerate concurrent requests well: confirmed live,
        # two threads racing into _get_snapshot() at once (the price
        # refresh and history rebuild loops both doing their initial fetch
        # at startup) made TEFAS drop both connections
        # ("RemoteDisconnected"), silently leaving prices on stale fallback
        # data for the entire run.
        self._snapshot_fetch_lock = threading.Lock()

        # Weight-drift factors: each tracked fund's assets_distribution is a
        # SNAPSHOT as of its "as_of" date (see FUND_DETAILS_MAP) - between
        # TEFAS composition updates, a holding that quietly outperforms/
        # underperforms its peers has, in reality, grown/shrunk as a share
        # of the fund, but the static snapshot weight doesn't reflect that.
        # Keyed by ticker -> cumulative price-return multiplier since that
        # holding's fund's as_of date (e.g. 1.15 = up 15% since then). Built
        # by _build_drift_factors_sync() once at startup and once daily -
        # see get_live_estimated_return() for how it's applied.
        self._drift_factors: Dict[str, float] = {}
        self._drift_factors_built_at = datetime.datetime.min
        self._is_building_drift = False

        for code, info in BASE_FUNDS.items():
            f = FALLBACKS[code]
            self._cached_funds[code] = {
                "code": code,
                "name": info["name"],
                "category": info["category_tr"],
                "price": round(f["price"], 4),
                "daily_return": f["daily"],
                "weekly_return": f["weekly"],
                "monthly_return": f["monthly"]
            }

        # Persisted in Redis (not a local JSON file - see git history for
        # the old on-disk version) so a fresh backend process starts from
        # the last real TEFAS fetch instead of the hardcoded FALLBACKS
        # above. A plain file under the container's CWD doesn't survive a
        # redeploy (docker compose build/up recreates the container's
        # filesystem from scratch, wiping it) - confirmed live: after a
        # routine redeploy, /app/tefas_cache.json was simply gone, so
        # every deploy silently reset live fund prices back to their
        # July-2026 fallback values until the next fetch completed. Redis
        # is a separate, already-persistent container this data survives
        # a backend redeploy in.
        self._cache_key = "tefas:persisted_cache"
        self._load_persisted_cache()

    def _load_persisted_cache(self):
        data = cache_service.get_json(self._cache_key)
        if not data:
            return
        try:
            if data.get("cached_funds"):
                self._cached_funds.update(data["cached_funds"])
            if data.get("history_cache"):
                self._history_cache.update(data["history_cache"])
            if data.get("last_refresh"):
                self._last_refresh = datetime.datetime.fromisoformat(data["last_refresh"])
            if data.get("history_last_built"):
                self._history_last_built = datetime.datetime.fromisoformat(data["history_last_built"])
            if data.get("drift_factors"):
                self._drift_factors.update(data["drift_factors"])
            if data.get("drift_factors_built_at"):
                self._drift_factors_built_at = datetime.datetime.fromisoformat(data["drift_factors_built_at"])
            logger.info(f"Loaded persisted TEFAS cache from Redis (last refresh: {self._last_refresh}).")
        except Exception as e:
            logger.warning(f"Could not load persisted TEFAS cache: {e}")

    def _persist_cache(self):
        try:
            with self._lock:
                data = {
                    "cached_funds": self._cached_funds,
                    "history_cache": self._history_cache,
                    "last_refresh": self._last_refresh.isoformat(),
                    "history_last_built": self._history_last_built.isoformat(),
                    "drift_factors": self._drift_factors,
                    "drift_factors_built_at": self._drift_factors_built_at.isoformat(),
                }
            # Long TTL, not "forever" - if this data ever stops being
            # refreshed (a stuck scheduler, TEFAS down for days), it should
            # eventually expire back to the hardcoded FALLBACKS rather than
            # serve indefinitely-stale "real" numbers.
            cache_service.set_json(self._cache_key, data, expire_seconds=7 * 24 * 60 * 60)
        except Exception as e:
            logger.warning(f"Could not persist TEFAS cache: {e}")

    def _bg_fetch_prices(self):
        """Fetch prices and calculate returns from TEFAS in a background thread."""
        with self._lock:
            if self._is_fetching:
                return
        thread = threading.Thread(target=self._fetch_prices_sync, daemon=True)
        thread.start()

    def _fetch_prices_sync(self):
        """Actual TEFAS price/return fetch. Runs on whatever thread calls it -
        used both by the fire-and-forget _bg_fetch_prices() (request-triggered)
        and by the daily scheduler thread (start_daily_scheduler) so returns get
        refreshed once a day even if nobody opens the funds page."""
        with self._lock:
            if self._is_fetching:
                return
            self._is_fetching = True
        try:
            # Previously this fetched exactly 4 fixed calendar dates (today, -1
            # week, -1 month, each independently snapped to the nearest
            # *weekday*) and assumed each one actually had published TEFAS data.
            # TEFAS frequently hasn't published "today" yet, or publishes a given
            # day for some funds' kind (YAT/EMK) but not others - so different
            # funds ended up comparing mismatched real trading days against each
            # other, producing daily/weekly/monthly returns that looked
            # plausible but were quietly wrong for whichever fund hit that gap.
            # This is the same class of bug already fixed in
            # _bg_build_breakdown() for Popüler Fonlar. Fix: walk back
            # day-by-day collecting REAL per-fund data points (skipping any day
            # with no data for that specific fund, not just skipping weekends),
            # then compute each fund's returns from its own most recent real
            # value vs N real trading days back in ITS OWN series - never
            # assuming any single calendar date has data for every fund.
            #
            # This used to fetch one (day, kind) pair at a time - up to 35*5=175
            # separate TEFAS requests per run. TEFAS caps at 6 requests/minute,
            # so that reliably tripped rate-limiting partway through, leaving
            # returns silently stuck on stale/fallback data - the actual root
            # cause of daily returns never updating. _get_snapshot() now fetches
            # the whole date range per kind in one request (TEFAS/pytefas
            # auto-chunks at 28 days), cutting this to ~15 requests total, and
            # shares the result with _build_history_sync() so a scheduler run
            # doing both doesn't fetch the same range twice.
            lookback_days = 35  # comfortably covers a month of real trading days
            per_day_df = self._get_snapshot(lookback_days)
            business_days = sorted(per_day_df.keys(), reverse=True)
            # business_days[0] is the most recent real trading day, oldest last.

            if not per_day_df:
                logger.warning(f"TEFAS price fetch produced no data for any of the last {lookback_days} business days.")
                return

            any_fund_updated = False
            for code in BASE_FUNDS.keys():
                meta = BASE_FUNDS.get(code, {})
                category = meta.get("category_tr", "Yatırım Fonu")

                # This fund's own real (date, price, name) points, newest first -
                # only days that actually contain a row for this fund code.
                series = []
                for date_str in business_days:
                    df = per_day_df.get(date_str)
                    if df is None:
                        continue
                    row = df[df["fund_code"] == code]
                    if row.empty:
                        continue
                    try:
                        price = float(row.iloc[0]["price"])
                    except Exception:
                        continue
                    if price <= 0:
                        continue
                    series.append((date_str, price, row.iloc[0].get("fund_name")))

                if not series:
                    fb = FALLBACKS.get(code, {"price": 1.0, "daily": 0.0, "weekly": 0.0, "monthly": 0.0})
                    with self._lock:
                        self._cached_funds[code] = {
                            "code": code,
                            "name": meta.get("name", f"{code} Fonu"),
                            "category": category,
                            "price": round(fb["price"], 4),
                            "daily_return": fb["daily"],
                            "weekly_return": fb["weekly"],
                            "monthly_return": fb["monthly"]
                        }
                    continue

                price_latest = series[0][1]
                name = series[0][2] or meta.get("name", f"{code} Fonu")

                def pct_change_back(n_trading_days: int) -> float:
                    if len(series) <= n_trading_days:
                        return 0.0
                    p_prev = series[n_trading_days][1]
                    return ((price_latest - p_prev) / p_prev) * 100 if p_prev > 0 else 0.0

                daily_ret = pct_change_back(1)
                weekly_ret = pct_change_back(5)
                monthly_ret = pct_change_back(21)

                with self._lock:
                    self._cached_funds[code] = {
                        "code": code,
                        "name": name,
                        "category": category,
                        "price": round(price_latest, 4),
                        "daily_return": round(daily_ret, 2),
                        "weekly_return": round(weekly_ret, 2),
                        "monthly_return": round(monthly_ret, 2)
                    }
                any_fund_updated = True

            if any_fund_updated:
                logger.info("TEFAS real prices and returns updated successfully via pytefas fetch.")
                with self._lock:
                    self._last_refresh = datetime.datetime.now()
                self._persist_cache()
        except Exception as e:
            logger.error(f"Error fetching TEFAS prices/returns: {e}")
        finally:
            with self._lock:
                self._is_fetching = False

    def _bg_build_history(self, count: int = 20):
        """
        Build REAL historical NAV series for every tracked fund from actual TEFAS
        daily snapshots (one shared date-range fetch per fund kind via
        _get_snapshot(), not per fund). Runs in a background thread.

        This replaces the old get_fund_candles() behavior, which fabricated the
        entire chart either by scaling XU100's index candles with a made-up "beta"
        or, failing that, generating pure sine-wave noise - meaning the fund price
        shown elsewhere in the app was real, but every chart was fiction.
        """
        with self._lock:
            if self._is_building_history:
                return
        thread = threading.Thread(target=self._build_history_sync, args=(count,), daemon=True)
        thread.start()

    def _build_history_sync(self, count: int = 20):
        """Actual TEFAS history build. Runs on whatever thread calls it - used by
        both the fire-and-forget _bg_build_history() and the daily scheduler."""
        with self._lock:
            if self._is_building_history:
                return
            self._is_building_history = True
        try:
            # Shares the fetch with _fetch_prices_sync() via _get_snapshot() -
            # see the comment there for why this no longer fetches one (day,
            # kind) pair at a time.
            per_day_df = self._get_snapshot(count)
            business_days = sorted(per_day_df.keys())[-count:]

            if not per_day_df:
                logger.warning("TEFAS history build produced no data for any business day.")
                return

            new_history: Dict[str, List[Dict[str, Any]]] = {}
            for code in BASE_FUNDS.keys():
                candles = []
                for date_str in business_days:
                    df = per_day_df.get(date_str)
                    if df is None:
                        continue
                    row = df[df["fund_code"] == code]
                    if row.empty:
                        continue
                    try:
                        price = float(row.iloc[0]["price"])
                    except Exception:
                        continue
                    if price <= 0:
                        continue
                    day = datetime.datetime.strptime(date_str, "%Y-%m-%d")
                    # TEFAS mutual funds only publish one NAV per day (no real
                    # intraday OHLC), so open/high/low/close are honestly all
                    # the same value rather than a fabricated spread.
                    candles.append({
                        "time": int(datetime.datetime(day.year, day.month, day.day, 18, 0).timestamp()),
                        "open": round(price, 4),
                        "high": round(price, 4),
                        "low": round(price, 4),
                        "close": round(price, 4),
                        "volume": 0
                    })
                if candles:
                    new_history[code] = candles

            with self._lock:
                self._history_cache.update(new_history)
                self._history_last_built = datetime.datetime.now()
            self._persist_cache()
            logger.info(f"TEFAS real historical NAV series built for {len(new_history)} funds ({len(business_days)} business days).")
        except Exception as e:
            logger.error(f"Error building TEFAS historical NAV series: {e}")
        finally:
            with self._lock:
                self._is_building_history = False

    def _bg_build_drift_factors(self):
        """Fire-and-forget kickoff for _build_drift_factors_sync(), matching
        the _bg_fetch_prices()/_bg_build_history() pattern above."""
        with self._lock:
            if self._is_building_drift:
                return
        threading.Thread(target=self._build_drift_factors_sync, daemon=True).start()

    def _build_drift_factors_sync(self):
        """Computes each drift-tracked holding's cumulative price-return
        multiplier since its fund's "as_of" date (see FUND_DETAILS_MAP) -
        get_live_estimated_return() uses this to let a fund's weights
        "drift" toward what they'd realistically be today, instead of
        staying frozen at the last disclosed TEFAS composition.

        Uses borsapy.Ticker(...).history() - a plain REST call - NOT
        market_data.py's get_candles(), which rides the single shared live
        TradingView streaming session (see its docstring: "only supports
        ONE active chart series at a time"). Sequentially subscribing that
        session to ~40+ tickers just for this background job would
        serialize and starve real users' live chart requests; a separate
        REST history call per ticker (already the pattern strategy_engine.py
        and portfolio_analytics.py use for the same reason) doesn't share
        that bottleneck.
        """
        with self._lock:
            if self._is_building_drift:
                return
            self._is_building_drift = True
        try:
            tickers_by_as_of: Dict[str, set] = {}
            for details in FUND_DETAILS_MAP.values():
                as_of = details.get("as_of")
                if not as_of or "assets_distribution" not in details:
                    continue
                for item in details["assets_distribution"]:
                    ticker = str(item["name"]).upper()
                    if ticker in _KNOWN_STOCK_TICKERS:
                        tickers_by_as_of.setdefault(as_of, set()).add(ticker)

            def resolve_one(as_of: str, ticker: str) -> Optional[float]:
                try:
                    as_of_date = datetime.date.fromisoformat(as_of)
                except ValueError:
                    return None
                today_tr = datetime.datetime.now(_TR_TZ).date()
                days_back = max((today_tr - as_of_date).days + 10, 30)
                df = None
                last_err: Optional[Exception] = None
                for attempt in range(3):
                    try:
                        df = borsapy.Ticker(ticker).history(period=f"{days_back}d", interval="1d")
                        break
                    except Exception as e:
                        last_err = e
                        if "429" in str(e):
                            time.sleep(1.5 * (attempt + 1))
                            continue
                        return None
                if df is None:
                    if last_err is not None:
                        logger.warning(f"Drift factor fetch failed for {ticker}: {last_err}")
                    return None
                if df.empty:
                    return None
                df = df.sort_index()
                # borsapy returns a tz-AWARE (Europe/Istanbul) DatetimeIndex
                # (confirmed live) - as_of_date/today_tr are already
                # TR-local dates, so drop the tz rather than compare a
                # tz-naive Timestamp against a tz-aware index (pandas raises
                # on that instead of silently coercing).
                naive_index = df.index.tz_localize(None) if df.index.tz is not None else df.index
                as_of_ts = pd.Timestamp(as_of_date)
                on_or_after_as_of = df[naive_index.normalize() >= as_of_ts]
                if on_or_after_as_of.empty:
                    return None
                close_as_of = float(on_or_after_as_of.iloc[0]["Close"])
                if close_as_of <= 0:
                    return None
                # Excludes today - today's own move is applied separately via
                # each holding's live change_percent in
                # get_live_estimated_return(), so folding it in here too
                # would double-count it.
                today_ts = pd.Timestamp(today_tr)
                before_today = df[naive_index.normalize() < today_ts]
                if before_today.empty:
                    return None
                close_latest = float(before_today.iloc[-1]["Close"])
                return close_latest / close_as_of

            jobs = [(as_of, ticker) for as_of, tickers in tickers_by_as_of.items() for ticker in tickers]
            new_factors: Dict[str, float] = {}
            # Small worker pool - borsapy's TradingView connection pool is
            # shared with market_data_service's live subscriber thread and
            # strategy_engine's own scans; too much concurrency here risks
            # 429s app-wide, not just for this job (see
            # _fetch_history_with_retry in strategy_engine.py for the same
            # tradeoff).
            with ThreadPoolExecutor(max_workers=4) as pool:
                future_to_ticker = {pool.submit(resolve_one, as_of, ticker): ticker for as_of, ticker in jobs}
                for future in as_completed(future_to_ticker):
                    ticker = future_to_ticker[future]
                    try:
                        factor = future.result()
                    except Exception as e:
                        logger.warning(f"Drift factor task errored for {ticker}: {e}")
                        factor = None
                    if factor is not None and 0.2 <= factor <= 5.0:
                        # Sanity floor/ceiling - a holding 5x-ing or losing
                        # 80% of its value between two composition updates
                        # is possible but implausible enough (more likely a
                        # bad/adjusted price series) that it shouldn't
                        # silently distort a whole fund's weighted estimate.
                        new_factors[ticker] = factor

            with self._lock:
                self._drift_factors.update(new_factors)
                self._drift_factors_built_at = datetime.datetime.now()
            self._persist_cache()
            logger.info(f"Rebuilt weight-drift factors for {len(new_factors)}/{len(jobs)} tickers.")
        except Exception as e:
            logger.error(f"Error building weight-drift factors: {e}")
        finally:
            with self._lock:
                self._is_building_drift = False

    def _get_snapshot(self, days: int) -> Dict[str, Any]:
        """Returns {date_str: combined_df} covering at least the last `days`
        real trading days, reusing a short-lived shared fetch so a price
        refresh followed by a history build (the daily scheduler does exactly
        this) fetch TEFAS once instead of twice. Reused as long as a fetch for
        at least this many days is still within _snapshot_ttl."""
        now = datetime.datetime.now()
        with self._lock:
            if (self._snapshot_cache and self._snapshot_cache_days >= days
                    and now - self._snapshot_fetched_at < self._snapshot_ttl):
                return self._snapshot_cache

        # Serialize the actual network fetch (see _snapshot_fetch_lock's
        # docstring in __init__) - a second caller that also missed the
        # cache above blocks here instead of racing its own concurrent
        # TEFAS request, then re-checks the (now warm) cache below instead
        # of always fetching again.
        with self._snapshot_fetch_lock:
            now = datetime.datetime.now()
            with self._lock:
                if (self._snapshot_cache and self._snapshot_cache_days >= days
                        and now - self._snapshot_fetched_at < self._snapshot_ttl):
                    return self._snapshot_cache

            snapshot = self._fetch_tefas_snapshot(days)

            with self._lock:
                if snapshot:
                    self._snapshot_cache = snapshot
                    self._snapshot_cache_days = days
                    self._snapshot_fetched_at = datetime.datetime.now()
                return self._snapshot_cache

    def _fetch_tefas_snapshot(self, days: int) -> Dict[str, Any]:
        """Fetch TEFAS 'info' data for all 5 fund kinds across the last `days`
        real trading days, using pytefas's native date-RANGE fetch (one
        request per kind, auto-chunked at 28 days by pytefas) instead of one
        request per (day, kind) pair. TEFAS caps at 6 requests/minute, so the
        old per-day loop (up to 35*5=175 requests) reliably got rate-limited
        partway through and silently left returns/charts on stale data - this
        cuts a typical run to ~10-15 requests total.
        Returns {date_str: combined_df_for_that_date}.
        """
        from pytefas import Crawler
        import datetime as dt
        crawler = Crawler()

        end_date = dt.date.today()
        # Generous calendar-day padding so `days` real trading days are covered
        # even across weekends/holidays.
        start_date = end_date - dt.timedelta(days=int(days * 1.6) + 10)

        per_day_df: Dict[str, Any] = {}
        for kind in TEFAS_FUND_KINDS:
            try:
                df = crawler.fetch(
                    start_date.strftime("%Y-%m-%d"),
                    end_date.strftime("%Y-%m-%d"),
                    columns="info",
                    kind=kind,
                )
            except Exception as e:
                logger.warning(f"TEFAS range fetch failed for kind {kind}: {e}")
                continue
            if df is None or df.empty or "date" not in df.columns or "fund_code" not in df.columns:
                continue
            for date_val, group in df.groupby("date"):
                date_str = pd.Timestamp(date_val).strftime("%Y-%m-%d")
                existing = per_day_df.get(date_str)
                per_day_df[date_str] = group if existing is None else pd.concat([existing, group], ignore_index=True)

        return per_day_df

    def start_daily_scheduler(self, hour: int = 19, minute: int = 30):
        """Guarantee TEFAS prices/returns stay fresh independent of user
        traffic, and rebuild the real NAV history once a day.

        Previously this only ran a fetch once at startup and once daily at
        `hour`:`minute` - in between, get_funds() only refreshed prices
        lazily, when someone happened to open the funds page AND the 1h
        cache had already expired. On a quiet stretch with nobody visiting
        the funds page, that left prices stuck stale for however long -
        confirmed live in production, where last_refresh sat 3+ hours
        behind with nothing re-triggering it. Now runs a lightweight
        price-only refresh every `_refresh_interval` (1h) in its own loop,
        independent of traffic, plus the original once-daily full refresh
        (prices + the more expensive real NAV history rebuild) at
        `hour`:`minute` (TEFAS publishes end-of-day NAVs in the evening, so
        the default targets after that). Two separate daemon threads so a
        slow history rebuild never delays the hourly price refresh.
        """
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def price_loop():
            # Runs the initial fetch too (not just the periodic ones) so
            # this thread - not the FastAPI startup event calling this
            # method - is what blocks on the first real TEFAS network call.
            self._fetch_prices_sync()
            while True:
                time.sleep(max(self._refresh_interval.total_seconds(), 1))
                self._fetch_prices_sync()

        def history_loop():
            self._build_history_sync(count=20)
            while True:
                # TR-aware, not datetime.datetime.now() - the container's
                # system clock runs UTC, so a naive now() compared against a
                # literal hour=19/minute=30 fired this at 19:30 UTC (22:30
                # TR), a full 3 hours after the intended after-close time.
                # Confirmed live: this is why the fund estimate-accuracy
                # backfill (fund_estimate_snapshot.py, timed 15 min after
                # this) and the accuracy numbers it depends on kept showing
                # up hours later than a user checking in the evening expected.
                now = datetime.datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._fetch_prices_sync()
                self._build_history_sync(count=20)

        def drift_loop():
            # Own thread (not folded into history_loop) so ~40 sequential
            # per-ticker REST history fetches (each with its own retry/
            # backoff on rate limiting) can't delay the NAV history rebuild
            # or the next scheduled fund-price refresh. Runs at the same
            # after-close target as history_loop since it also wants that
            # day's just-closed prices, just staggered slightly later so it
            # isn't racing history_loop for the same TEFAS/TradingView
            # connections at the exact same instant.
            self._build_drift_factors_sync()
            while True:
                now = datetime.datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0) + timedelta(minutes=5)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._build_drift_factors_sync()

        threading.Thread(target=price_loop, daemon=True).start()
        threading.Thread(target=history_loop, daemon=True).start()
        threading.Thread(target=drift_loop, daemon=True).start()

    def get_funds(self, index_change_pct: float = 0.64) -> List[Dict[str, Any]]:
        """Get all funds. Refreshes cache asynchronously if expired."""
        time_since_refresh = datetime.datetime.now() - self._last_refresh
        if time_since_refresh > self._refresh_interval and not self._is_fetching:
            self._bg_fetch_prices()
            
        with self._lock:
            return list(self._cached_funds.values())

    def get_fund(self, code: str, index_change_pct: float = 0.64) -> Optional[Dict[str, Any]]:
        """Get a single fund by code with detailed properties (Request 7!)."""
        code = code.upper()
        funds = self.get_funds(index_change_pct)
        
        details_map = FUND_DETAILS_MAP

        for f in funds:
            if f["code"] == code:
                details = details_map.get(code, {
                    "fund_size": "₺250,000,000",
                    "risk_level": 3,
                    "manager": "Pusula Portföy Yönetimi",
                    "assets_distribution": [{"name": "Nakit ve Benzeri", "value": 100}]
                })
                return {**f, **details}
        return None

    def get_live_estimated_return(
        self, code: str, _visited: Optional[set] = None, delay_minutes: int = 0
    ) -> Optional[Dict[str, Any]]:
        """Estimated INTRADAY % change for a fund, computed from its known
        holdings' live prices - TEFAS itself only publishes one NAV per day,
        so this is the only way to show something resembling a live number
        for "Popüler Fonlar - Anlık Getiri" instead of a stale daily figure.

        Walks FUND_DETAILS_MAP[code]["assets_distribution"]: a plain stock
        ticker's contribution is its live change_percent (from the same
        TradingView cache the rest of the app already uses); a holding that
        is itself another tracked fund is resolved RECURSIVELY the same way
        (so DFI's ABG holding, PBR's PKZ/PCS/PRY holdings etc. are estimated
        too, not skipped) - `_visited` guards against a cycle. If a holding
        can't be resolved to a live quote at all (an unlisted category like
        "Ters Repo"/"Nakit", or a sub-fund with no known composition of its
        own), it falls back to that fund's last real TEFAS daily_return, or
        is simply excluded from the weighted sum for a plain unknown ticker.

        This is explicitly an estimate: weights are the last known/disclosed
        composition (not live, and not guaranteed to sum to 100 - the
        remainder is uncounted cash/bonds/other), multiplied by each
        holding's live change - not a real intraday NAV recalculation.
        """
        code = code.upper()
        details = FUND_DETAILS_MAP.get(code)
        if not details:
            return None
        _visited = (_visited or set()) | {code}

        # BIST equities are limited to roughly +-10% per session; a handful
        # of thinly-traded tickers (confirmed live: KTLEV showing -73% due to
        # a bad prev_close in the TradingView feed, pre-existing and unrelated
        # to fund data) can report implausible swings from feed glitches. A
        # generous +-20% sanity ceiling catches those without rejecting real
        # limit-up/down days, so a single bad quote can't corrupt the
        # weighted estimate the user relies on.
        MAX_PLAUSIBLE_CHANGE_PCT = 20.0

        holdings_out = []
        estimated_change = 0.0
        resolved_weight = 0.0

        # Weight-drift adjustment: assets_distribution's weights are frozen
        # as of "as_of" (see FUND_DETAILS_MAP) - a holding that has quietly
        # out/underperformed its fund-mates since then has, in reality,
        # grown/shrunk as a share of the fund even though TEFAS hasn't
        # published a new composition yet. Re-weight using each holding's
        # cumulative price-return multiplier since as_of
        # (self._drift_factors, built daily by _build_drift_factors_sync -
        # 1.0 for anything not resolved, e.g. category labels or fund
        # codes), then rescale so the drifted weights still sum to the same
        # total as the original ones (preserves whatever fraction was cash/
        # bonds/unlisted-other in the original snapshot instead of
        # inflating it away). Funds with no "as_of" set keep the plain
        # static weights (drifted_weights stays empty, .get() below falls
        # through to item["value"]).
        as_of = details.get("as_of")
        drifted_weights: Dict[str, float] = {}
        if as_of:
            raw_total = 0.0
            drifted_total = 0.0
            for item in details["assets_distribution"]:
                t = str(item["name"]).upper()
                w = float(item["value"])
                raw_total += w
                factor = self._drift_factors.get(t, 1.0)
                drifted_weights[t] = w * factor
                drifted_total += w * factor
            scale = (raw_total / drifted_total) if drifted_total > 0 else 1.0
            for t in drifted_weights:
                drifted_weights[t] *= scale

        for item in details["assets_distribution"]:
            name = item["name"]
            ticker = name.upper()
            weight = drifted_weights.get(ticker, float(item["value"]))

            if ticker in _FIXED_RATE_HOLDING_DAILY_PCT:
                change = _FIXED_RATE_HOLDING_DAILY_PCT[ticker] * _calendar_days_since_last_bist_session()
                holdings_out.append({"ticker": ticker, "weight": weight, "change_pct": change, "type": "deposit"})
                estimated_change += weight / 100 * change
                resolved_weight += weight
                continue

            # A holding that's itself a tracked fund - resolve its OWN
            # estimate recursively, but only trust that recursive number if
            # enough of ITS composition was itself resolvable to live quotes
            # (e.g. PKZ/PCS/ABG are only known here as generic category
            # labels like "Ters Repo"/"Nakit" - recursing into those would
            # resolve almost nothing and silently understate the estimate
            # near zero). Below that bar, fall back to the fund's own last
            # real TEFAS daily return instead - a real, if lagging, number
            # beats a mostly-empty recursive one.
            MIN_TRUSTED_RESOLVED_PCT = 20.0
            if ticker in FUND_DETAILS_MAP and ticker not in _visited:
                sub = self.get_live_estimated_return(ticker, _visited, delay_minutes)
                if sub is not None and sub["resolved_weight_pct"] >= MIN_TRUSTED_RESOLVED_PCT:
                    change = sub["estimated_change_pct"]
                    holdings_out.append({"ticker": ticker, "weight": weight, "change_pct": change, "type": "fund"})
                    estimated_change += weight / 100 * change
                    resolved_weight += weight
                    continue

            if ticker in BASE_FUNDS:
                # A tracked fund whose own composition isn't known (or wasn't
                # resolvable enough above) - fall back to its last real
                # TEFAS daily return.
                cached = self._cached_funds.get(ticker)
                if cached is not None and abs(cached["daily_return"]) <= MAX_PLAUSIBLE_CHANGE_PCT:
                    change = cached["daily_return"]
                    holdings_out.append({"ticker": ticker, "weight": weight, "change_pct": change, "type": "fund_daily"})
                    estimated_change += weight / 100 * change
                    resolved_weight += weight
                    continue

            # market_data_service.get_quote() NEVER returns None - for any
            # symbol it doesn't recognize (e.g. a category label like "Ters
            # Repo"/"Nakit") it still returns a synthetic fallback quote
            # (change_percent 0.0) while it tries to subscribe in the
            # background. Checking truthiness on that return value would
            # silently treat every such label as a real "0% today" stock and
            # inflate resolved_weight_pct - the known-ticker universe must be
            # checked first instead.
            is_known_ticker = ticker in _KNOWN_STOCK_TICKERS
            if not is_known_ticker:
                quote = None
            elif delay_minutes > 0:
                quote = market_data_service.get_delayed_quote(ticker, delay_minutes)
            else:
                quote = market_data_service.get_quote(ticker)
            change_pct = quote.get("change_percent") if quote else None
            if change_pct is not None and abs(float(change_pct)) <= MAX_PLAUSIBLE_CHANGE_PCT:
                change = float(change_pct)
                holdings_out.append({"ticker": ticker, "weight": weight, "change_pct": change, "type": "stock"})
                estimated_change += weight / 100 * change
                resolved_weight += weight
            else:
                # Unresolvable (a category label like "Nakit"/"Ters Repo", a
                # ticker with no live quote yet, or a quote that failed the
                # plausibility check above) - excluded from the weighted sum
                # rather than guessed at.
                holdings_out.append({"ticker": ticker, "weight": weight, "change_pct": None, "type": "unresolved"})

        return {
            "code": code,
            "estimated_change_pct": round(estimated_change, 2),
            "resolved_weight_pct": round(resolved_weight, 2),
            "holdings": holdings_out,
        }

    def get_dated_return_pct(self, code: str, target_date: "datetime.date") -> Optional[float]:
        """A fund's REAL day-over-day % return for one specific past trading
        day, computed from the dated historical NAV series (_history_cache -
        each candle keyed to a real calendar date, not "whatever daily_return
        currently says"). Used to backfill FundEstimateSnapshot's
        actual_change_pct a day or two after the fact (see
        fund_estimate_snapshot.py) - unlike get_fund()['daily_return'],
        which is a ROLLING "latest close vs the close before it" figure that
        moves on to represent a LATER day once time passes, a dated lookup
        stays correct for that specific day no matter when it's read.

        This matters most across a weekend: TEFAS's own settlement can lag a
        Friday's NAV past that same evening, so a same-evening snapshot of
        daily_return sometimes captures a not-yet-final figure. By the
        following Monday (or later), the historical series has had time to
        settle, so re-deriving Friday's return from it here is what actually
        fixes that instead of trusting the same-evening figure permanently.

        Returns None if the date (or the trading day immediately before it)
        isn't in the cached history yet - the caller should just retry on a
        later run rather than treat that as a real "unknown return"."""
        code = code.upper()
        with self._lock:
            candles = list(self._history_cache.get(code) or [])
        if not candles:
            return None

        target_ts = int(datetime.datetime(target_date.year, target_date.month, target_date.day, 18, 0).timestamp())
        idx = next((i for i, c in enumerate(candles) if c["time"] == target_ts), None)
        if idx is None or idx == 0:
            return None

        prev_close = candles[idx - 1]["close"]
        target_close = candles[idx]["close"]
        if not prev_close:
            return None
        return round((target_close - prev_close) / prev_close * 100, 2)

    def get_fund_candles(self, code: str, count: int = 30, index_change_pct: float = 0.64) -> tuple[List[Dict[str, Any]], bool]:
        """
        Return (candles, is_simulated) historical NAV data for a mutual fund's chart.

        Prefers the REAL historical series built in _bg_build_history() from actual
        TEFAS daily snapshots. If that hasn't finished building yet (e.g. right after
        a fresh server start), falls back to the old synthetic generator so the chart
        still shows *something* immediately (is_simulated=True), and kicks off a
        background build so the real data replaces it shortly after.
        """
        code = code.upper()

        # Trigger/refresh the real historical build in the background if it's
        # missing or stale. Non-blocking - doesn't delay this response.
        with self._lock:
            is_stale = (datetime.datetime.now() - self._history_last_built) > self._history_refresh_interval
            already_building = self._is_building_history
        if (not self._history_cache or is_stale) and not already_building:
            self._bg_build_history(count=max(count, 20))

        with self._lock:
            cached_history = self._history_cache.get(code)
        if cached_history:
            return (cached_history[-count:] if count else cached_history), False

        return self._generate_synthetic_candles(code, count, index_change_pct), True

    def _generate_synthetic_candles(self, code: str, count: int = 30, index_change_pct: float = 0.64) -> List[Dict[str, Any]]:
        """Temporary placeholder chart (correlated with XU100) shown only until the
        real historical NAV series has finished its first background build."""
        code = code.upper()
        fund = self.get_fund(code, index_change_pct)
        if not fund:
            return []

        base_price = fund["price"]
        candles = []

        # Correlate with XU100 index performance as a placeholder only
        xu100_candles = market_data_service.get_candles("XU100", "1d", count=count, wait=False, subscribe=False)
        
        if xu100_candles and len(xu100_candles) >= 5:
            ref_close = float(xu100_candles[-1]["close"])
            
            # Category beta and drift settings
            beta = 0.8
            drift = 0.0
            if code in ["PHE", "PUK"]:
                beta = 1.15
            elif code in ["PBR", "DFI"]:
                beta = 0.6
            else: # TLY, TMV
                beta = 0.12
                drift = 0.0006 # positive drift
                
            for idx, c in enumerate(xu100_candles):
                c_close = float(c["close"])
                ratio = c_close / ref_close
                scaled_ratio = 1.0 + (ratio - 1.0) * beta + (idx - len(xu100_candles)) * drift
                
                close_p = base_price * scaled_ratio
                high_p = close_p * 1.001
                low_p = close_p * 0.999
                open_p = close_p * 1.0002
                
                candles.append({
                    "time": c["time"],
                    "open": round(open_p, 4),
                    "high": round(high_p, 4),
                    "low": round(low_p, 4),
                    "close": round(close_p, 4),
                    "volume": int(5000 + (c["volume"] % 2000))
                })
        else:
            # Fallback positive drift model
            import math
            import random
            now = datetime.datetime.now()
            daily_drift = 0.0012
            if code in ["TLY", "TMV"]:
                daily_drift = 0.0016
                
            for i in range(count, 0, -1):
                day_offset = i
                date_time = now - datetime.timedelta(days=day_offset)
                timestamp = int(date_time.timestamp())
                
                noise = math.sin(i / 3.0) * 0.008 + (random.uniform(-0.002, 0.002))
                scaled_price = base_price * (1.0 - (daily_drift * i) + noise)
                
                close_price = max(0.001, scaled_price)
                open_price = close_price * 0.999
                high_price = close_price * 1.0005
                low_price = close_price * 0.9985
                
                candles.append({
                    "time": timestamp,
                    "open": round(open_price, 4),
                    "high": round(high_price, 4),
                    "low": round(low_price, 4),
                    "close": round(close_price, 4),
                    "volume": int(15000 + (math.sin(i) * 3000))
                })
                
        if candles:
            candles[-1]["close"] = base_price
            candles[-1]["high"] = max(candles[-1]["open"], base_price)
            candles[-1]["low"] = min(candles[-1]["open"], base_price)
            
        return candles

tefas_service = TefasService()
