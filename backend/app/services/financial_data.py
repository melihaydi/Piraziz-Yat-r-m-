import logging
import time
from typing import Any, Dict, List, Optional
from app.core.redis import cache_service
from app.services.data_providers import (
    BaseDataProvider,
    FMPProvider,
    FinnhubProvider,
    AlphaVantageProvider,
    ProviderError,
    RateLimitError
)

logger = logging.getLogger(__name__)

class FinancialDataService:
    def __init__(self):
        # Fallback chain order
        self.providers: List[BaseDataProvider] = [
            FMPProvider(),
            FinnhubProvider(),
            AlphaVantageProvider()
        ]

    def _execute_with_retry_and_fallback(self, operation: str, ticker: str) -> Any:
        """Executes a provider operation with retries and falls back to other providers on failure."""
        errors = []
        for provider in self.providers:
            # Check if this provider is temporarily blocked due to rate limits
            block_key = f"bip:provider_blocked:{provider.name}"
            if cache_service.get(block_key):
                logger.info(f"Provider {provider.name} is temporarily blocked, skipping in fallback chain.")
                continue

            logger.info(f"Attempting {operation} for {ticker} using {provider.name}")
            
            # Retry mechanism with backoff
            retries = 3
            backoff = 0.5 # start with 500ms
            for attempt in range(retries):
                try:
                    if operation == "get_price":
                        return provider.get_price(ticker)
                    elif operation == "get_profile":
                        return provider.get_profile(ticker)
                    else:
                        raise ValueError(f"Unknown operation: {operation}")
                except RateLimitError as e:
                    logger.warning(f"Rate limit hit on {provider.name} for {ticker}: {e}")
                    # Block this provider for 60 seconds
                    cache_service.set(block_key, "1", expire_seconds=60)
                    errors.append(f"{provider.name}: Rate limit exceeded")
                    break # Break retry loop to fall back immediately
                except ProviderError as e:
                    logger.warning(f"Error from {provider.name} (attempt {attempt + 1}/{retries}): {e}")
                    if attempt == retries - 1:
                        errors.append(f"{provider.name}: {e}")
                    else:
                        time.sleep(backoff * (2 ** attempt)) # exponential backoff
                except Exception as e:
                    logger.error(f"Unexpected error in provider {provider.name}: {e}")
                    errors.append(f"{provider.name}: {e}")
                    break
        
        # If all providers failed
        raise ProviderError(f"All providers failed to execute {operation} for {ticker}. Errors: {', '.join(errors)}")

    def get_price(self, ticker: str, cache_seconds: int = 60) -> Optional[float]:
        """Gets stock price with cache check, retries, and fallback."""
        cache_key = f"bip:price:{ticker}"
        
        # 1. Try cache
        cached_price = cache_service.get(cache_key)
        if cached_price is not None:
            logger.info(f"Cache hit for price: {ticker} -> {cached_price}")
            return float(cached_price)

        # 2. Execute fallback chain
        try:
            price = self._execute_with_retry_and_fallback("get_price", ticker)
            
            # 3. Set cache
            if price is not None:
                cache_service.set(cache_key, str(price), expire_seconds=cache_seconds)
            return price
        except Exception as e:
            logger.error(f"Failed to get price for {ticker}: {e}")
            return None

    def get_profile(self, ticker: str, cache_seconds: int = 86400) -> Optional[Dict[str, Any]]:
        """Gets company profile with cache check, retries, and fallback (cached for 24h by default)."""
        cache_key = f"bip:profile:{ticker}"

        # 1. Try cache
        cached_profile = cache_service.get_json(cache_key)
        if cached_profile is not None:
            logger.info(f"Cache hit for profile: {ticker}")
            return cached_profile

        # 2. Execute fallback chain
        try:
            profile = self._execute_with_retry_and_fallback("get_profile", ticker)

            # 3. Set cache
            if profile is not None:
                cache_service.set_json(cache_key, profile, expire_seconds=cache_seconds)
            return profile
        except Exception as e:
            logger.error(f"Failed to get profile for {ticker}: {e}")
            return None

financial_data_service = FinancialDataService()
