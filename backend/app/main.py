import logging

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.core.config import settings
from app.core.limiter import limiter
from app.core.notify import send_telegram_alert

# Without this, nothing configures the root logger: Python's default
# "handler of last resort" only ever prints WARNING+ to stderr, with no
# timestamp/module name. Every `logger.info(...)`/`logger.debug(...)` call
# across ~20 services (tefas.py, strategy_engine.py, portfolio_snapshot.py,
# the background schedulers started below, etc.) was silently dropped -
# only real errors/warnings ever reached the container logs, unformatted.
# That made after-the-fact diagnosis of a production issue ("sunucuda
# problem oldu") nearly impossible: there was no INFO-level trail of what
# each background job actually did before something broke.
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(levelname)s %(name)s: %(message)s",
)

logger = logging.getLogger(__name__)

# borsapy's stream parser doesn't recognize a length-prefixed heartbeat frame
# (TradingView sometimes sends the heartbeat as "~m~<n>~m~~h~<counter>"
# instead of the bare "~h~<counter>" its regex expects - see
# borsapy/stream.py's _parse_packets), so it falls through to json.loads()
# on literal text like "~h~191", fails, and logs a WARNING - every ~10s,
# forever, harmlessly (the connection and real quote/chart data are
# unaffected). Confirmed live via a production log pull ("sunucu yavaş"
# investigation): this was the single most frequent log line in the
# container, purely cosmetic noise on a host where log volume itself has a
# real (if small) CPU/disk-I/O cost. Only this one noisy sub-logger is
# silenced - not all of borsapy - so a genuine borsapy.stream error/warning
# (a different message, or WARNING+ from elsewhere in the package) still surfaces.
logging.getLogger("borsapy.stream").setLevel(logging.ERROR)

# Real error tracking - was unset (SENTRY_DSN=None) because no Sentry account
# existed; unhandled_exception_handler below's log+Telegram alert was the
# only fallback (see task list: "lightweight monitoring, no Sentry account").
# Same shape as the SMTP/Telegram/push settings elsewhere in this app: a
# no-op if the DSN isn't configured, so this is always safe to leave in.
# Must run before FastAPI(...) below - sentry_sdk's FastapiIntegration
# instruments the app at construction time, not after.
if settings.SENTRY_DSN:
    import sentry_sdk
    from sentry_sdk.integrations.fastapi import FastApiIntegration
    from sentry_sdk.integrations.starlette import StarletteIntegration

    sentry_sdk.init(
        dsn=settings.SENTRY_DSN,
        environment=settings.ENVIRONMENT,
        integrations=[StarletteIntegration(), FastApiIntegration()],
        traces_sample_rate=settings.SENTRY_TRACES_SAMPLE_RATE,
        # PII (user email/IP on error events) would need explicit product/
        # KVKK sign-off first - default this off rather than send it by
        # accident the moment a DSN gets configured.
        send_default_pii=False,
    )

# The interactive docs enumerate every route, query parameter and response
# schema of this API - including the admin and trade surfaces - which is
# free reconnaissance for anyone probing the public host. Useful in
# development, so they stay on there and are only closed in production.
_docs_enabled = settings.ENVIRONMENT != "production"

app = FastAPI(
    title="BIST Intelligence Platform (BIP) API",
    description="AI-powered analysis and tracking platform for Borsa Istanbul (BIST)",
    version="1.0.0",
    docs_url="/docs" if _docs_enabled else None,
    redoc_url="/redoc" if _docs_enabled else None,
    openapi_url="/openapi.json" if _docs_enabled else None,
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Nothing in front of this app compressed anything (Caddy does not enable
# compression unless told to, and the `encode` directive added to the
# Caddyfile alongside this only covers the deploy that actually runs behind
# Caddy). The payloads here are highly repetitive JSON - screener tables,
# chart candle arrays, fund lists - which routinely compress 5-10x, and the
# users are on Turkish mobile connections where that is the difference
# between a chart appearing instantly and visibly waiting for it. The 1 KB
# floor skips small responses, where the CPU cost of compressing outweighs
# the bytes saved.
app.add_middleware(GZipMiddleware, minimum_size=1000)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Without this, an unhandled exception in a route just becomes an
    # opaque 500 with nothing logged anywhere. sentry_sdk's FastApiIntegration
    # (see the init call above) already auto-captures this same exception to
    # Sentry when SENTRY_DSN is set - this handler's log line + Telegram
    # alert stay regardless, since Sentry is opt-in/may not be configured.
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    send_telegram_alert(
        f"[BIP backend] Unhandled exception on {request.method} {request.url.path}: {exc}",
        key=f"{request.url.path}:{type(exc).__name__}",
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# CORS configuration - the localhost entries plus FRONTEND_URL and anything
# in EXTRA_CORS_ORIGINS (see core/config.py), which is how a custom domain
# gets allowed without editing this file.
origins = settings.get_cors_origins()

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # The *.netlify.app wildcard that used to live here (for the pre-custom-
    # domain deploy URL) was removed once bipterminal.com became the sole
    # real frontend - the Netlify subdomain itself can't be disabled (a
    # Netlify-side setting), but this stops it from being able to call the
    # API: it still LOADS (dead login form only), just can't reach /auth/*
    # or anything else, so it stops being a live second copy of the app.
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def add_security_headers(request: Request, call_next):
    """Baseline response security headers on every request. No
    Content-Security-Policy here on purpose - the frontend embeds several
    third-party TradingView widgets (iframes/scripts across multiple
    domains) and a CSP tight enough to matter would need constant upkeep
    against that, or a loose enough one to be nearly meaningless; HSTS is
    Caddy's job (it terminates TLS in front of this), not this app's."""
    response = await call_next(request)
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["X-Frame-Options"] = "DENY"
    response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
    return response

from app.api.v1.api import api_router
app.include_router(api_router, prefix="/api/v1")

@app.on_event("startup")
async def start_background_jobs():
    from app.services.tefas import tefas_service
    tefas_service.start_daily_scheduler()
    from app.services.strategy_engine import strategy_engine, backtest_engine
    strategy_engine.start_background_refresh()
    backtest_engine.start_background_refresh()
    from app.services.portfolio_snapshot import portfolio_snapshot_service
    portfolio_snapshot_service.start_daily_scheduler()
    from app.services.fund_estimate_snapshot import fund_estimate_snapshot_service
    fund_estimate_snapshot_service.start_daily_scheduler()
    from app.services.signal_tracking import signal_tracking_service
    signal_tracking_service.start_background_scheduler()
    from app.services.subscription_expiry import subscription_expiry_service
    subscription_expiry_service.start_daily_scheduler()
    from app.services.news import NewsService
    NewsService.start_background_scheduler()
    from app.services.seed_data import seed_companies
    seed_companies()

@app.get("/")
async def root():
    body = {"message": "Welcome to BIST Intelligence Platform (BIP) API"}
    # Advertising these in production would point straight at endpoints
    # that no longer exist there (see _docs_enabled above).
    if _docs_enabled:
        body["docs_url"] = "/docs"
        body["redoc_url"] = "/redoc"
    return body

@app.get("/health")
async def health_check(response: Response):
    from sqlalchemy import text
    from app.db.session import engine
    from app.core.redis import cache_service

    db_connected = False
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        db_connected = True
    except Exception:
        pass

    redis_connected = cache_service.is_connected()

    # A degraded dependency (DB down especially) means the API can't
    # actually serve requests, so this must not return 200 - otherwise
    # Docker's HEALTHCHECK and any uptime check hitting this endpoint will
    # report "healthy" right through an outage.
    if not db_connected:
        response.status_code = 503

    return {
        "status": "healthy" if (db_connected and redis_connected) else "degraded",
        "environment": settings.ENVIRONMENT,
        "database_connected": db_connected,
        "redis_connected": redis_connected
    }
