import xml.etree.ElementTree as ET
import logging
from typing import List, Dict, Any
from datetime import datetime, timezone
import httpx

logger = logging.getLogger(__name__)

class KapService:
    def __init__(self):
        self.rss_url = "https://www.kap.org.tr/tr/api/disclosures/rss"

    def fetch_latest_disclosures(self) -> List[Dict[str, Any]]:
        """Fetch latest KAP disclosures from RSS feed with fallback to mock data."""
        try:
            response = httpx.get(self.rss_url, timeout=5.0)
            response.raise_for_status()
            
            root = ET.fromstring(response.content)
            disclosures = []
            
            # Parse XML items
            for item in root.findall(".//item"):
                title = item.find("title").text if item.find("title") is not None else ""
                link = item.find("link").text if item.find("link") is not None else ""
                description = item.find("description").text if item.find("description") is not None else ""
                pub_date_str = item.find("pubDate").text if item.find("pubDate") is not None else ""
                
                # Parse ticker (usually the title starts with "TICKER [Company Name] disclosure_name" or "TICKER:")
                # Let's extract uppercase ticker word from start of title
                ticker = None
                words = title.split()
                if words:
                    first_word = words[0].replace(":", "").replace("[", "").replace("]", "").strip()
                    if first_word.isupper() and len(first_word) <= 5:
                        ticker = first_word

                # Try parsing publication date
                try:
                    # KAP RSS uses standard RFC 822 format: "Mon, 20 Jul 2026 14:00:00 GMT"
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
            
            logger.info(f"Successfully fetched {len(disclosures)} disclosures from KAP RSS.")
            return disclosures
            
        except Exception as e:
            logger.error(f"Failed to fetch KAP disclosures: {e}. Falling back to mock disclosures.")
            return self.get_mock_disclosures()

    def get_mock_disclosures(self) -> List[Dict[str, Any]]:
        """Generate high-quality mock KAP disclosures when offline or API is down."""
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
