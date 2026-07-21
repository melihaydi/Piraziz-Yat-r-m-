import socket
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from app.core.config import settings

DATABASE_URL = settings.get_database_url()

# Fallback to local SQLite if Postgres host 'db' is unreachable (running local development)
if "db:" in DATABASE_URL or "@db" in DATABASE_URL:
    try:
        socket.gethostbyname("db")
    except socket.gaierror:
        DATABASE_URL = "sqlite:///./bip_dev.db"

# For SQLite (if used in tests), connect_args={"check_same_thread": False} is required.
# For PostgreSQL it is ignored.
connect_args = {}
if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(
    DATABASE_URL,
    pool_pre_ping=True,
    connect_args=connect_args
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

# Auto-create tables in development / SQLite mode
if DATABASE_URL.startswith("sqlite"):
    try:
        from app.db.base_class import Base
        from app.models.user import User
        from app.models.portfolio import Portfolio, PortfolioAsset
        from app.models.alert import Alert
        from app.models.trade import TradeAccount, TradePosition, TradeOrder, TradeDailySnapshot
        Base.metadata.create_all(bind=engine)
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to auto-create SQLite tables: {e}")
