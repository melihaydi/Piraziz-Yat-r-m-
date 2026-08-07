import logging
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import List, Dict, Any, Tuple, Optional
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Content-Type": "application/json",
}

_TR_TZ = ZoneInfo("Europe/Istanbul")

_MAX_DISCLOSURES = 10

# KAP OIDs (memberOrFundOid, resolved via /tr/api/search/combined) for the
# specific "serbest fon" the app tracks (Portföyüm/Fonlar pages). Verified
# live 2026-08-08 that none of these have filed a KAP disclosure of any
# known class (ODA/FR/DG/CA) in the last 6 months - serbest fon have much
# lighter KAP obligations than listed companies - so _fetch_fund_disclosures
# will usually contribute nothing to the merged feed. Kept anyway so a fund
# disclosure (e.g. a strategy/izahname update) surfaces automatically if one
# is ever filed, instead of silently being invisible.
_TRACKED_FUND_OIDS: Dict[str, str] = {
    "PKZ": "4028328d95959cc60195fb7fe4370851",
    "PCS": "4028328d8f3f7793018fa5c497fc148c",
    "PGH": "4028328d95959cc60195fb7bab8c081e",
    "TLY": "4028328c7812c9c301781bc5fe843290",
    "TMV": "4028328c812b72a30181903f43933a9b",
    "PHE": "4028328c8e21cef8018e2de1258c2053",
    "PBR": "4028328c8e21cef7018e2ddaeff33aab",
    "DFI": "4028328c819d4b9e0181a3f0a2410236",
}
_FUND_DISCLOSURE_CLASSES = ("ODA", "FR", "DG", "CA")


class KapService:
    """Fetches real KAP (Kamuyu Aydınlatma Platformu) disclosures directly
    from www.kap.org.tr's own internal JSON API - the same one the KAP
    website's own frontend uses, and the one the open-source `pykap`
    library (github.com/cemsinano/pykap) reverse-engineered. No API
    key/auth required.

    This replaces two previously dead paths: KAP's public RSS feed
    (kap.org.tr/tr/api/disclosures/rss) times out completely from every
    network tested, and the old MKK REST API (apigwdev.mkk.com.tr) requires
    an OAuth-style token handshake that only works from within MKK's own
    developer portal session - external callers get a
    'Proxy was not found for client id (null)' error with no documented
    fix, confirmed after extensive live testing 2026-08-08.

    Serves two merged feeds: general material-event (ODA) disclosures
    across all BIST companies, plus disclosures scoped to
    _TRACKED_FUND_OIDS (the specific funds this app tracks elsewhere)."""

    def __init__(self):
        self.disclosures_url = "https://www.kap.org.tr/tr/api/disclosure/members/byCriteria"

    def _post_disclosures(self, payload: Dict[str, Any]) -> List[Dict[str, Any]]:
        response = httpx.post(self.disclosures_url, json=payload, timeout=10.0, headers=_HEADERS)
        response.raise_for_status()
        return response.json()

    def _build_item(self, item: Dict[str, Any], fallback_ticker: Optional[str] = None) -> Dict[str, Any]:
        stock_codes = (item.get("stockCodes") or "").strip()
        ticker = (stock_codes.split(",")[0].strip() if stock_codes else None) or fallback_ticker
        company = item.get("kapTitle") or ""
        subject = item.get("subject") or item.get("summary") or ""
        title = f"{ticker} [{company}] {subject}" if ticker else f"{company} {subject}"

        try:
            publish_date = datetime.strptime(item["publishDate"], "%d.%m.%Y %H:%M:%S").replace(tzinfo=_TR_TZ)
        except Exception:
            publish_date = datetime.now(_TR_TZ)

        disclosure_index = item.get("disclosureIndex")
        return {
            "id": str(disclosure_index),
            "ticker": ticker,
            "title": title,
            "summary": item.get("summary") or subject,
            "publish_date": publish_date,
            "link": f"https://www.kap.org.tr/tr/Bildirim/{disclosure_index}",
        }

    def _fetch_company_disclosures(self) -> List[Dict[str, Any]]:
        """General ODA (Özel Durum Açıklaması / material event) disclosures
        across all companies for the last few days."""
        today = datetime.now(_TR_TZ).date()
        payload = {
            "fromDate": (today - timedelta(days=3)).isoformat(),
            "toDate": today.isoformat(),
            "disclosureClass": "ODA",
            "subjectList": [],
            "mkkMemberOidList": [],
            "inactiveMkkMemberOidList": [],
            "bdkMemberOidList": [],
            "fromSrc": False,
            "disclosureIndexList": [],
        }
        return [self._build_item(item) for item in self._post_disclosures(payload)]

    def _fetch_one_fund_class(self, ticker: str, oid: str, disclosure_class: str) -> List[Dict[str, Any]]:
        """One (fund, disclosure_class) query. Scoped to a single fund's oid
        so the ticker attribution is exact - the response doesn't echo back
        which mkkMemberOid a result matched (stockCodes/fundCode come back
        null for fund disclosures), so batching multiple funds into one
        request would make ticker attribution a guess."""
        today = datetime.now(_TR_TZ).date()
        payload = {
            "fromDate": (today - timedelta(days=180)).isoformat(),
            "toDate": today.isoformat(),
            "disclosureClass": disclosure_class,
            "subjectList": [],
            "mkkMemberOidList": [oid],
            "inactiveMkkMemberOidList": [],
            "bdkMemberOidList": [],
            "fromSrc": False,
            "disclosureIndexList": [],
        }
        try:
            raw_items = self._post_disclosures(payload)
        except Exception as e:
            logger.warning(f"KAP fund disclosure fetch failed for {ticker}/{disclosure_class}: {e}")
            return []
        return [self._build_item(raw, fallback_ticker=ticker) for raw in raw_items]

    def _fetch_fund_disclosures(self) -> List[Dict[str, Any]]:
        """Disclosures scoped to _TRACKED_FUND_OIDS, tried across every
        known disclosure class since funds don't consistently use ODA.
        Usually returns nothing (see _TRACKED_FUND_OIDS's docstring). Runs
        all (fund, class) combinations concurrently - sequentially this
        would be 8 funds x 4 classes = 32 requests on every cache miss."""
        tasks = [
            (ticker, oid, cls)
            for ticker, oid in _TRACKED_FUND_OIDS.items()
            for cls in _FUND_DISCLOSURE_CLASSES
        ]
        results: Dict[str, Dict[str, Any]] = {}
        with ThreadPoolExecutor(max_workers=min(len(tasks), 16)) as pool:
            futures = [pool.submit(self._fetch_one_fund_class, ticker, oid, cls) for ticker, oid, cls in tasks]
            for future in as_completed(futures):
                for built in future.result():
                    results[built["id"]] = built

        return list(results.values())

    def fetch_latest_disclosures(self) -> Tuple[List[Dict[str, Any]], bool]:
        """Fetch and merge the latest company + tracked-fund disclosures,
        newest first.

        Returns (disclosures, is_sample) - is_sample=True means this is the
        hardcoded placeholder list (get_mock_disclosures), NOT real KAP
        data, used only if the live call fails entirely."""
        try:
            merged: Dict[str, Dict[str, Any]] = {}
            for item in self._fetch_company_disclosures() + self._fetch_fund_disclosures():
                merged[item["id"]] = item
            disclosures = sorted(merged.values(), key=lambda d: d["publish_date"], reverse=True)

            if disclosures:
                logger.info(f"Successfully fetched {len(disclosures)} disclosures from KAP's disclosure API.")
                return disclosures[:_MAX_DISCLOSURES], False

        except Exception as e:
            logger.error(f"Failed to fetch KAP disclosures: {e}. Falling back to sample disclosures.")

        return self.get_mock_disclosures(), True

    def get_mock_disclosures(self) -> List[Dict[str, Any]]:
        """Sample KAP-shaped disclosures shown (clearly flagged, see
        fetch_latest_disclosures's is_sample) when the real feed is
        unreachable."""
        now = datetime.now(_TR_TZ)
        return [
            {
                "id": "123456",
                "ticker": "THYAO",
                "title": "THYAO [TÜRK HAVA YOLLARI AO] Finansal Rapor Bildirimi",
                "summary": "2026 2. Çeyrek bilançosunda beklentilerin üzerinde net kâr açıklanmıştır.",
                "publish_date": now,
                "link": "https://www.kap.org.tr/tr/Bildirim/123456"
            },
            {
                "id": "123457",
                "ticker": "EREGL",
                "title": "EREGL [EREĞLİ DEMİR VE ÇELİK FABRİKALARI TAŞ] Özel Durum Açıklaması",
                "summary": "Karbon nötr hedefleri kapsamında yeni bir güneş enerjisi santrali kurulmasına karar verilmiştir.",
                "publish_date": now,
                "link": "https://www.kap.org.tr/tr/Bildirim/123457"
            },
            {
                "id": "123458",
                "ticker": "TUPRS",
                "title": "TUPRS [TÜPRAŞ TÜRKİYE PETROL RAFİNERİLERİ AŞ] Özel Durum Açıklaması",
                "summary": "Bakım çalışmaları nedeniyle İzmir rafinerisinde üretime geçici olarak ara verilecektir.",
                "publish_date": now,
                "link": "https://www.kap.org.tr/tr/Bildirim/123458"
            }
        ]

kap_service = KapService()
