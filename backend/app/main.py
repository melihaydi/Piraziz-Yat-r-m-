import logging

from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi.errors import RateLimitExceeded
from slowapi import _rate_limit_exceeded_handler
from app.core.config import settings
from app.core.limiter import limiter
from app.core.notify import send_telegram_alert

logger = logging.getLogger(__name__)

app = FastAPI(
    title="BIST Intelligence Platform (BIP) API",
    description="AI-powered analysis and tracking platform for Borsa Istanbul (BIST)",
    version="1.0.0",
)

app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception):
    # Without this, an unhandled exception in a route just becomes an
    # opaque 500 with nothing logged anywhere - there's no Sentry (or
    # equivalent) wired up yet, so this + the Telegram alert below is the
    # only way a crash gets noticed instead of silently failing requests.
    logger.error(f"Unhandled exception on {request.method} {request.url.path}: {exc}", exc_info=True)
    send_telegram_alert(
        f"[BIP backend] Unhandled exception on {request.method} {request.url.path}: {exc}",
        key=f"{request.url.path}:{type(exc).__name__}",
    )
    return JSONResponse(status_code=500, content={"detail": "Internal server error"})

# CORS configuration
origins = [
    "http://localhost:3000",      # Next.js development server
    "http://localhost:3001",
    "http://127.0.0.1:3000",
    "http://localhost",           # Production / Nginx
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    # Netlify assigns a *.netlify.app subdomain per site (and per preview
    # deploy) - allowed by pattern so the frontend doesn't need a backend
    # redeploy every time its exact Netlify URL changes.
    allow_origin_regex=r"https://.*\.netlify\.app",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

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
    from app.services.seed_data import seed_companies
    seed_companies()

@app.get("/")
async def root():
    return {
        "message": "Welcome to BIST Intelligence Platform (BIP) API",
        "docs_url": "/docs",
        "redoc_url": "/redoc"
    }

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
