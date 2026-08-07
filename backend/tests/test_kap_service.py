from unittest.mock import patch, MagicMock

from app.services.kap_service import KapService

SAMPLE_DISCLOSURES = [
    {
        "publishDate": "08.08.2026 00:59:10",
        "kapTitle": "TÜRK HAVA YOLLARI A.O.",
        "disclosureClass": "ODA",
        "summary": "Finansal Rapor Bildirimi",
        "subject": "Finansal Rapor Bildirimi",
        "disclosureIndex": 999999,
        "stockCodes": "THYAO",
    }
]


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
    with patch("app.services.kap_service.httpx.post", side_effect=Exception("timeout")):
        disclosures, is_sample = service.fetch_latest_disclosures()
    assert is_sample is True
    assert len(disclosures) == 3


def test_fetch_latest_disclosures_parses_real_response_and_extracts_ticker():
    service = KapService()
    mock_response = MagicMock()
    mock_response.json.return_value = SAMPLE_DISCLOSURES
    mock_response.raise_for_status.return_value = None
    with patch("app.services.kap_service.httpx.post", return_value=mock_response):
        disclosures, is_sample = service.fetch_latest_disclosures()

    assert is_sample is False
    assert len(disclosures) == 1
    item = disclosures[0]
    assert item["ticker"] == "THYAO"
    assert item["id"] == "999999"
    assert item["title"].startswith("THYAO")
    assert item["link"] == "https://www.kap.org.tr/tr/Bildirim/999999"


def test_fetch_latest_disclosures_caps_at_ten_and_sorts_newest_first():
    service = KapService()
    many = []
    for i in range(15):
        many.append({
            "publishDate": f"0{1 if i < 9 else 2}.08.2026 {(i % 24):02d}:00:00",
            "kapTitle": f"Company {i}",
            "summary": "Test",
            "subject": "Test",
            "disclosureIndex": i,
            "stockCodes": f"TCK{i}",
        })
    mock_response = MagicMock()
    mock_response.json.return_value = many
    mock_response.raise_for_status.return_value = None
    with patch("app.services.kap_service.httpx.post", return_value=mock_response):
        disclosures, is_sample = service.fetch_latest_disclosures()

    assert is_sample is False
    assert len(disclosures) == 10
    assert disclosures == sorted(disclosures, key=lambda d: d["publish_date"], reverse=True)
