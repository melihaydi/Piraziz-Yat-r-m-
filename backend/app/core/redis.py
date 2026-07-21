import redis
import json
import logging
from typing import Any, Optional
from app.core.config import settings

logger = logging.getLogger(__name__)

class CacheService:
    def __init__(self):
        self.redis_client = None
        try:
            # We initialize lazy or at startup. Here we initialize immediately.
            self.redis_client = redis.from_url(
                settings.get_redis_url(),
                encoding="utf-8",
                decode_responses=True,
                socket_timeout=2.0
            )
        except Exception as e:
            logger.error(f"Failed to initialize Redis client: {e}")

    def is_connected(self) -> bool:
        if not self.redis_client:
            return False
        try:
            return self.redis_client.ping()
        except Exception:
            return False

    def get(self, key: str) -> Optional[str]:
        if not self.redis_client:
            return None
        try:
            return self.redis_client.get(key)
        except Exception as e:
            logger.error(f"Redis GET error for key '{key}': {e}")
            return None

    def set(self, key: str, value: str, expire_seconds: int = 3600) -> bool:
        if not self.redis_client:
            return False
        try:
            return bool(self.redis_client.set(key, value, ex=expire_seconds))
        except Exception as e:
            logger.error(f"Redis SET error for key '{key}': {e}")
            return False

    def get_json(self, key: str) -> Optional[Any]:
        val = self.get(key)
        if val:
            try:
                return json.loads(val)
            except Exception:
                return None
        return None

    def set_json(self, key: str, value: Any, expire_seconds: int = 3600) -> bool:
        try:
            return self.set(key, json.dumps(value), expire_seconds)
        except Exception as e:
            logger.error(f"Redis SET JSON error for key '{key}': {e}")
            return False

    def delete(self, key: str) -> bool:
        if not self.redis_client:
            return False
        try:
            self.redis_client.delete(key)
            return True
        except Exception as e:
            logger.error(f"Redis DELETE error for key '{key}': {e}")
            return False

cache_service = CacheService()
