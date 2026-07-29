import logging
import redis as redis_lib
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.core.config import settings

logger = logging.getLogger(__name__)


def _redis_reachable() -> bool:
    try:
        client = redis_lib.from_url(settings.get_redis_url(), socket_timeout=1.5)
        return bool(client.ping())
    except Exception:
        return False


# Redis-backed so limits are shared across all backend workers/replicas and
# survive restarts - but slowapi's Redis connection is LAZY (only attempted
# on the first actual rate-limit check, not at Limiter() construction), so
# just wrapping the constructor in try/except doesn't catch a bad Redis
# target - it crashed every single request with an unhandled
# ConnectionError instead (verified locally: this exact failure mode 500'd
# every request when Redis wasn't reachable). Ping first to decide the
# storage backend, and set swallow_errors=True as a second line of defense
# so a Redis hiccup AFTER startup degrades to "rate limiting temporarily
# off" instead of "the whole app is down".
if _redis_reachable():
    limiter = Limiter(key_func=get_remote_address, storage_uri=settings.get_redis_url(), swallow_errors=True)
else:
    logger.warning("Redis unreachable at startup - rate limiting falls back to in-memory (per-process) storage.")
    limiter = Limiter(key_func=get_remote_address, swallow_errors=True)
