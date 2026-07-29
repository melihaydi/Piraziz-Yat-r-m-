import xml.etree.ElementTree as ET
import logging
from typing import List, Dict, Any, Tuple
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
}


class KapService:
    def __init__(self):
        self.rss_url = "https://www.kap.org.tr/tr/api/disclosures/rss"

    def fetch_latest_disclosures(self) -> Tuple[List[Dict[str, Any]], bool]:
        """Fetch latest KAP disclosures from KAP's own RSS feed.

        Returns (disclosures, is_sample) - is_sample=True means this is the
        hardcoded placeholder list below, NOT real KAP data. Verified on
        2026-07-28 that KAP's RSS endpoint (https://www.kap.org.tr/tr/api/
        disclosures/rss) times out completely (15s+, from multiple different
        networks, with and without a browser User-Agent) - this isn't a
        one-off outage or something specific to this app's server, it's the
        endpoint itself currently being unreachable/blocking automated
        requests. (The previously-tried MKK API path - apiywdev.mkk.com.tr -
        was removed entirely: its hostname doesn't resolve at all anymore,
        confirmed via an authoritative DNS lookup, i.e. that specific
        endpoint no longer exists, not a transient DNS hiccup.)

        Every caller of this MUST surface `is_sample` to the user (see
        GET /screener/kap's `is_sample` field, mirrored from the same
        pattern already used for TEFAS's `is_simulated` fund charts) -
        presenting fallback content as if it were live KAP data would be
        actively misleading for a feature whose whole value is "real
        company disclosures."
        """
        try:
            response = httpx.get(self.rss_url, timeout=8.0, headers=_HEADERS)
            response.raise_for_status()

            root = ET.fromstring(response.content)
            disclosures = []

            for item in root.findall(".//item"):
                title = item.find("title").text if item.find("title") is not None else ""
                link = item.find("link").text if item.find("link") is not None else ""
                description = item.find("description").text if item.find("description") is not None else ""
                pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""

                ticker = None
                words = title.split()
                if words:
                    first_word = words[0].replace(":", "").replace("[", "").replace("]", "").strip()
                    if first_word.isupper() and len(first_word) <= 5:
                        ticker = first_word

                try:
                    publish_date = datetime.strptime(pub_date_str, "%a, %d %b %Y %H:%M:%S %Z")
                except Exception:
                    publish_date = datetime.now(timezone.utc)

                disclosure_id = link.split("/")[-1] if link else f"KAP-{hash(title)}"

                disclosures.append({
                    "id": disclosure_id,
                    "ticker": ticker,
                    "title": title,
                    "summary": description,
                    "publish_date": publish_date,
                    "link": link
                })

            if disclosures:
                logger.info(f"Successfully fetched {len(disclosures)} disclosures from KAP RSS.")
                return disclosures, False

        except Exception as e:
            logger.error(f"Failed to fetch KAP disclosures: {e}. Falling back to sample disclosures.")

        return self.get_mock_disclosures(), True

    def get_mock_disclosures(self) -> List[Dict[str, Any]]:
        """Sample KAP-shaped disclosures shown (clearly flagged, see
        fetch_latest_disclosures's is_sample) when the real feed is
        unreachable."""
        return [
            {
                "id": "123456",
                "ticker": "THYAO",
                "title": "THYAO [TÜRK HAVA YOLLARI AO] Finansal Rapor Bildirimi",
                "summary": "2026 2. Çeyrek bilançosunda beklentilerin üzerinde net kâr açıklanmıştır.",
                "publish_date": datetime.now(timezone.utc),
                "link": "https://www.kap.org.tr/tr/Bildirim/123456"
            },
            {
                "id": "123457",
                "ticker": "EREGL",
                "title": "EREGL [EREĞLİ DEMİR VE ÇELİK FABRİKALARI TAŞ] Özel Durum Açıklaması",
                "summary": "Karbon nötr hedefleri kapsamında yeni bir güneş enerjisi santrali kurulmasına karar verilmiştir.",
                "publish_date": datetime.now(timezone.utc),
                "link": "https://www.kap.org.tr/tr/Bildirim/123457"
            },
            {
                "id": "123458",
                "ticker": "TUPRS",
                "title": "TUPRS [TÜPRAŞ TÜRKİYE PETROL RAFİNERİLERİ AŞ] Özel Durum Açıklaması",
                "summary": "Bakım çalışmaları nedeniyle İzmir rafinerisinde üretime geçici olarak ara verilecektir.",
                "publish_date": datetime.now(timezone.utc),
                "link": "https://www.kap.org.tr/tr/Bildirim/123458"
            }
        ]

kap_service = KapService()
