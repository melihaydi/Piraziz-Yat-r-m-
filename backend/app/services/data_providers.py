import logging
from typing import Any, Dict, Optional
import httpx
from app.core.config import settings

logger = logging.getLogger(__name__)

class ProviderError(Exception):
    """Base exception for data provider errors."""
    pass

class RateLimitError(ProviderError):
    """Raised when provider returns HTTP 429 Too Many Requests."""
    pass

class BaseDataProvider:
    """Abstract base class for financial data providers."""
    name: str = "Base"

    def get_price(self, ticker: str) -> Optional[float]:
        raise NotImplementedError

    def get_profile(self, ticker: str) -> Optional[Dict[str, Any]]:
        raise NotImplementedError

class FMPProvider(BaseDataProvider):
    """Financial Modeling Prep Data Provider."""
    name: str = "FMP"

    def __init__(self):
        self.api_key = settings.FMP_API_KEY
        self.base_url = "https://financialmodelingprep.com/api/v3"

    def _request(self, path: str, params: Dict[str, Any] = None) -> Any:
        if not self.api_key:
            raise ProviderError("FMP API key is not configured")
        
        url = f"{self.base_url}/{path}"
        query_params = params or {}
        query_params["apikey"] = self.api_key

        try:
            response = httpx.get(url, params=query_params, timeout=5.0)
            if response.status_code == 429:
                raise RateLimitError("FMP rate limit exceeded")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise RateLimitError("FMP rate limit exceeded")
            raise ProviderError(f"FMP HTTP error: {e}")
        except Exception as e:
            raise ProviderError(f"FMP connection error: {e}")

    def get_price(self, ticker: str) -> Optional[float]:
        try:
            data = self._request(f"quote/{ticker}")
            if data and isinstance(data, list) and len(data) > 0:
                return float(data[0].get("price", 0.0))
            return None
        except Exception as e:
            logger.warning(f"FMP failed to get price for {ticker}: {e}")
            raise

    def get_profile(self, ticker: str) -> Optional[Dict[str, Any]]:
        try:
            data = self._request(f"profile/{ticker}")
            if data and isinstance(data, list) and len(data) > 0:
                profile = data[0]
                return {
                    "ticker": ticker,
                    "name": profile.get("companyName"),
                    "sector": profile.get("sector"),
                    "industry": profile.get("industry"),
                    "description": profile.get("description"),
                    "logo_url": profile.get("image")
                }
            return None
        except Exception as e:
            logger.warning(f"FMP failed to get profile for {ticker}: {e}")
            raise

class FinnhubProvider(BaseDataProvider):
    """Finnhub Data Provider."""
    name: str = "Finnhub"

    def __init__(self):
        self.api_key = settings.FINNHUB_API_KEY
        self.base_url = "https://finnhub.io/api/v1"

    def _request(self, path: str, params: Dict[str, Any] = None) -> Any:
        if not self.api_key:
            raise ProviderError("Finnhub API key is not configured")

        url = f"{self.base_url}/{path}"
        query_params = params or {}
        query_params["token"] = self.api_key

        try:
            response = httpx.get(url, params=query_params, timeout=5.0)
            if response.status_code == 429:
                raise RateLimitError("Finnhub rate limit exceeded")
            response.raise_for_status()
            return response.json()
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise RateLimitError("Finnhub rate limit exceeded")
            raise ProviderError(f"Finnhub HTTP error: {e}")
        except Exception as e:
            raise ProviderError(f"Finnhub connection error: {e}")

    def get_price(self, ticker: str) -> Optional[float]:
        try:
            data = self._request("quote", {"symbol": ticker})
            if data and "c" in data:
                return float(data["c"])
            return None
        except Exception as e:
            logger.warning(f"Finnhub failed to get price for {ticker}: {e}")
            raise

    def get_profile(self, ticker: str) -> Optional[Dict[str, Any]]:
        try:
            data = self._request("stock/profile2", {"symbol": ticker})
            if data and "name" in data:
                return {
                    "ticker": ticker,
                    "name": data.get("name"),
                    "sector": data.get("finnhubIndustry"),
                    "industry": data.get("finnhubIndustry"),
                    "description": None,
                    "logo_url": data.get("logo")
                }
            return None
        except Exception as e:
            logger.warning(f"Finnhub failed to get profile for {ticker}: {e}")
            raise

class AlphaVantageProvider(BaseDataProvider):
    """Alpha Vantage Data Provider."""
    name: str = "AlphaVantage"

    def __init__(self):
        self.api_key = settings.ALPHA_VANTAGE_API_KEY
        self.base_url = "https://www.alphavantage.co"

    def _request(self, params: Dict[str, Any]) -> Any:
        if not self.api_key:
            raise ProviderError("Alpha Vantage API key is not configured")

        url = f"{self.base_url}/query"
        query_params = params or {}
        query_params["apikey"] = self.api_key

        try:
            response = httpx.get(url, params=query_params, timeout=5.0)
            if response.status_code == 429:
                raise RateLimitError("Alpha Vantage rate limit exceeded")
            response.raise_for_status()
            
            data = response.json()
            # Alpha Vantage returns rate limits in JSON messages rather than 429 status code sometimes
            if "Note" in data and "rate limit" in data["Note"].lower():
                raise RateLimitError("Alpha Vantage rate limit reached via Note")
            
            return data
        except httpx.HTTPStatusError as e:
            if e.response.status_code == 429:
                raise RateLimitError("Alpha Vantage rate limit exceeded")
            raise ProviderError(f"Alpha Vantage HTTP error: {e}")
        except Exception as e:
            raise ProviderError(f"Alpha Vantage connection error: {e}")

    def get_price(self, ticker: str) -> Optional[float]:
        try:
            data = self._request({
                "function": "GLOBAL_QUOTE",
                "symbol": ticker
            })
            quote = data.get("Global Quote", {})
            if quote and "05. price" in quote:
                return float(quote["05. price"])
            return None
        except Exception as e:
            logger.warning(f"Alpha Vantage failed to get price for {ticker}: {e}")
            raise

    def get_profile(self, ticker: str) -> Optional[Dict[str, Any]]:
        try:
            data = self._request({
                "function": "OVERVIEW",
                "symbol": ticker
            })
            if data and "Name" in data:
                return {
                    "ticker": ticker,
                    "name": data.get("Name"),
                    "sector": data.get("Sector"),
                    "industry": data.get("Industry"),
                    "description": data.get("Description"),
                    "logo_url": None
                }
            return None
        except Exception as e:
            logger.warning(f"Alpha Vantage failed to get profile for {ticker}: {e}")
            raise
