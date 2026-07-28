from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.core.config import settings

app = FastAPI(
    title="BIST Intelligence Platform (BIP) API",
    description="AI-powered analysis and tracking platform for Borsa Istanbul (BIST)",
    version="1.0.0",
)

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
async def health_check():
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

    return {
        "status": "healthy" if (db_connected and redis_connected) else "degraded",
        "environment": settings.ENVIRONMENT,
        "database_connected": db_connected,
        "redis_connected": redis_connected
    }
