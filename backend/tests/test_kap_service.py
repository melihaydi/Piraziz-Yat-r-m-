from unittest.mock import patch, MagicMock

from app.services.kap_service import KapService

SAMPLE_RSS = """<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0"><channel>
<item>
<title>THYAO: Finansal Rapor Bildirimi</title>
<link>https://www.kap.org.tr/tr/Bildirim/999999</link>
<description>Test disclosure body.</description>
<pubDate>Mon, 03 Aug 2026 09:15:00 GMT</pubDate>
</item>
</channel></rss>"""


def test_get_mock_disclosures_returns_well_formed_sample_items():
    service = KapService()
    disclosures = service.get_mock_disclosures()
    assert len(disclosures) == 3
    for d in disclosures:
        assert d["ticker"]
        assert d["title"]
        assert d["link"].startswith("https://www.kap.org.tr")


def test_fetch_latest_disclosures_falls_back_to_mock_on_network_error():
    service = KapService()
    with patch("app.services.kap_service.httpx.get", side_effect=Exception("timeout")):
        disclosures, is_sample = service.fetch_latest_disclosures()
    assert is_sample is True
    assert len(disclosures) == 3


def test_fetch_latest_disclosures_parses_real_rss_and_extracts_ticker():
    service = KapService()
    mock_response = MagicMock()
    mock_response.content = SAMPLE_RSS.encode("utf-8")
    mock_response.raise_for_status.return_value = None
    with patch("app.services.kap_service.httpx.get", return_value=mock_response):
        disclosures, is_sample = service.fetch_latest_disclosures()

    assert is_sample is False
    assert len(disclosures) == 1
    item = disclosures[0]
    assert item["ticker"] == "THYAO"
    assert item["id"] == "999999"
    assert item["title"].startswith("THYAO")
