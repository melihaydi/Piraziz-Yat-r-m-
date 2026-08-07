import logging
from typing import List, Dict, Any, Tuple
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


class KapService:
    """Fetches real KAP (Kamuyu Aydınlatma Platformu) material-event
    disclosures directly from www.kap.org.tr's own internal JSON API - the
    same one the KAP website's own frontend uses, and the one the
    open-source `pykap` library (github.com/cemsinano/pykap) reverse-
    engineered. No API key/auth required.

    This replaces two previously dead paths: KAP's public RSS feed
    (kap.org.tr/tr/api/disclosures/rss) times out completely from every
    network tested, and the old MKK REST API (apigwdev.mkk.com.tr) requires
    an OAuth-style token handshake that only works from within MKK's own
    developer portal session - external callers get a
    'Proxy was not found for client id (null)' error with no documented
    fix, confirmed after extensive live testing 2026-08-08."""

    def __init__(self):
        self.disclosures_url = "https://www.kap.org.tr/tr/api/disclosure/members/byCriteria"

    def fetch_latest_disclosures(self) -> Tuple[List[Dict[str, Any]], bool]:
        """Fetch the latest ODA (Özel Durum Açıklaması / material event)
        disclosures across all companies for the last few days.

        Returns (disclosures, is_sample) - is_sample=True means this is the
        hardcoded placeholder list (get_mock_disclosures), NOT real KAP
        data, used only if the live call fails."""
        try:
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
            response = httpx.post(self.disclosures_url, json=payload, timeout=10.0, headers=_HEADERS)
            response.raise_for_status()
            raw_items = response.json()

            disclosures = []
            for item in raw_items:
                stock_codes = (item.get("stockCodes") or "").strip()
                ticker = stock_codes.split(",")[0].strip() if stock_codes else None
                company = item.get("kapTitle") or ""
                subject = item.get("subject") or item.get("summary") or ""
                title = f"{ticker} [{company}] {subject}" if ticker else f"{company} {subject}"

                try:
                    publish_date = datetime.strptime(item["publishDate"], "%d.%m.%Y %H:%M:%S").replace(tzinfo=_TR_TZ)
                except Exception:
                    publish_date = datetime.now(_TR_TZ)

                disclosure_index = item.get("disclosureIndex")
                disclosures.append({
                    "id": str(disclosure_index),
                    "ticker": ticker,
                    "title": title,
                    "summary": item.get("summary") or subject,
                    "publish_date": publish_date,
                    "link": f"https://www.kap.org.tr/tr/Bildirim/{disclosure_index}",
                })

            disclosures.sort(key=lambda d: d["publish_date"], reverse=True)

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
