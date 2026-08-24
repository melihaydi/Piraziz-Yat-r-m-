import logging
import redis as redis_lib
from fastapi import Request
from jose import jwt, JWTError
from slowapi import Limiter
from slowapi.util import get_remote_address
from app.core.config import settings

logger = logging.getLogger(__name__)


def rate_limit_key(request: Request) -> str:
    """Rate-limit bucket key: the authenticated user when there is one,
    otherwise the client IP.

    Was plain `get_remote_address` (i.e. IP only), which broke badly in
    production for two compounding reasons:

    1. Behind Caddy, uvicorn only honours X-Forwarded-For when the proxy's
       address is in --forwarded-allow-ips (default: 127.0.0.1). Caddy runs
       in its OWN container, so it connects over the Docker bridge from
       172.x.x.x - never trusted - and `request.client.host` was therefore
       the Caddy container's IP for EVERY request from EVERY user. All the
       limits below were effectively global: /auth/me and /auth/refresh
       share 120/minute across the entire userbase, while the dashboard
       alone polls ~48 req/min per open tab (market summary every 2s, index
       ticker every 5s, portfolio every 15s). A handful of simultaneous
       users was enough to 429 everyone. docker-compose.prod.yml now passes
       --forwarded-allow-ips so the real client IP actually arrives.
    2. Even with the real IP, Turkish mobile carriers put many subscribers
       behind one CGNAT address, so IP-keyed limits punish exactly the
       users who reported this ("özellikle mobilde").

    Keying on the JWT subject fixes both: each account gets its own budget
    regardless of how many users share an egress IP. The token signature is
    verified (not just decoded) on purpose - accepting an unverified `sub`
    would let anyone drain another account's budget by forging a claim.
    Anonymous and expired-token requests fall back to the IP, which is what
    the brute-force limits on /auth/login and friends need anyway; note we
    deliberately do NOT parse X-Forwarded-For by hand here, since an
    unvalidated header would let an attacker pick a fresh bucket per
    request and walk straight through those login limits.
    """
    auth = request.headers.get("authorization") or ""
    if auth.lower().startswith("bearer "):
        try:
            payload = jwt.decode(
                auth[7:].strip(), settings.SECRET_KEY, algorithms=[settings.ALGORITHM]
            )
            sub = payload.get("sub")
            if sub:
                return f"user:{sub}"
        except JWTError:
            pass
    return f"ip:{get_remote_address(request)}"


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
    limiter = Limiter(key_func=rate_limit_key, storage_uri=settings.get_redis_url(), swallow_errors=True)
else:
    logger.warning("Redis unreachable at startup - rate limiting falls back to in-memory (per-process) storage.")
    limiter = Limiter(key_func=rate_limit_key, swallow_errors=True)
