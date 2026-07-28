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

        # create_all() only creates *missing tables* - it never alters a
        # table that already exists, so a SQLite file created by an older
        # version of this app (e.g. the desktop app's per-user local db,
        # which has no separate migration step a user could run) silently
        # keeps missing any column added to a model afterward. That's a
        # real bug this hit: TradeAccount.locked_cash was added mid-session
        # for the limit-order feature, and every local install that already
        # had a trade_account table from before then got a 500 on every
        # single Trade request ("no such column: trade_account.locked_cash")
        # with zero visible explanation. This adds any columns the current
        # models define but the live SQLite file doesn't have yet, so an
        # existing local db self-heals to match the current schema instead
        # of silently drifting out of sync.
        from sqlalchemy import inspect, text
        inspector = inspect(engine)
        with engine.begin() as conn:
            for table in Base.metadata.sorted_tables:
                if not inspector.has_table(table.name):
                    continue
                existing_columns = {col["name"] for col in inspector.get_columns(table.name)}
                for column in table.columns:
                    if column.name in existing_columns:
                        continue
                    col_type = column.type.compile(dialect=engine.dialect)
                    default_clause = ""
                    if column.default is not None and column.default.is_scalar:
                        default_clause = f" DEFAULT {column.default.arg!r}"
                    elif not column.nullable:
                        default_clause = " DEFAULT 0"
                    conn.execute(text(
                        f"ALTER TABLE {table.name} ADD COLUMN {column.name} {col_type}{default_clause}"
                    ))
                    import logging
                    logging.getLogger(__name__).warning(
                        f"Auto-migrated local SQLite db: added missing column {table.name}.{column.name}"
                    )
    except Exception as e:
        import logging
        logging.getLogger(__name__).error(f"Failed to auto-create/migrate SQLite tables: {e}")
