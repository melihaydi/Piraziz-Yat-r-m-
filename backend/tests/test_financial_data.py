import pytest
from unittest.mock import MagicMock, patch
from app.services.financial_data import FinancialDataService
from app.services.data_providers import RateLimitError, ProviderError
from app.services.kap_service import KapService

# Mock cache service behavior
@patch("app.services.financial_data.cache_service")
def test_get_price_cache_hit(mock_cache):
    # Setup cache hit
    mock_cache.get.return_value = "150.5"
    
    service = FinancialDataService()
    price = service.get_price("THYAO")
    
    assert price == 150.5
    mock_cache.get.assert_called_once_with("bip:price:THYAO")

@patch("app.services.financial_data.cache_service")
def test_get_price_fallback_success(mock_cache):
    # Setup cache miss
    mock_cache.get.return_value = None
    
    service = FinancialDataService()
    
    # Mock providers
    provider_1 = MagicMock()
    provider_1.name = "FMP"
    provider_1.get_price.side_effect = RateLimitError("FMP Limit")
    
    provider_2 = MagicMock()
    provider_2.name = "Finnhub"
    provider_2.get_price.return_value = 160.0
    
    service.providers = [provider_1, provider_2]
    
    price = service.get_price("THYAO")
    
    assert price == 160.0
    # Verifies FMP was blocked in cache
    mock_cache.set.assert_any_call("bip:provider_blocked:FMP", "1", expire_seconds=60)
    # Verifies final price was cached
    mock_cache.set.assert_any_call("bip:price:THYAO", "160.0", expire_seconds=60)

@patch("app.services.financial_data.cache_service")
def test_get_price_blocked_provider_skipped(mock_cache):
    mock_cache.get.side_effect = lambda key: "1" if key == "bip:provider_blocked:FMP" else None
    
    service = FinancialDataService()
    
    provider_1 = MagicMock()
    provider_1.name = "FMP"
    
    provider_2 = MagicMock()
    provider_2.name = "Finnhub"
    provider_2.get_price.return_value = 175.0
    
    service.providers = [provider_1, provider_2]
    
    price = service.get_price("THYAO")
    
    # Provider 1 should be skipped because it is blocked in cache
    assert price == 175.0
    provider_1.get_price.assert_not_called()
    provider_2.get_price.assert_called_once_with("THYAO")

@patch("httpx.get")
def test_kap_service_fallback(mock_get):
    # Simulate network failure
    mock_get.side_effect = Exception("Connection refused")

    service = KapService()
    disclosures, is_sample = service.fetch_latest_disclosures()

    # is_sample=True is the whole point of this fallback path - callers
    # (GET /screener/kap) rely on it to avoid presenting placeholder
    # content as if it were live KAP data.
    assert is_sample is True
    assert len(disclosures) > 0
    assert disclosures[0]["ticker"] == "THYAO"
    assert "mock disclosures" in disclosures[0]["title"].lower() or "thyao" in disclosures[0]["title"].lower()
