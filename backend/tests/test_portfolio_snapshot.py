from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot
from app.services.portfolio_snapshot import PortfolioSnapshotService

# Self-contained in-memory DB (separate from conftest's `db` fixture) since
# PortfolioSnapshotService opens its own session via SessionLocal() rather
# than taking one as a dependency - this lets each test control exactly
# what SessionLocal() resolves to without touching the shared test engine.
_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def snap_db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=_engine)


def _seed_portfolio(session, user_id, ticker, shares, average_cost):
    portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
    session.add(portfolio)
    session.flush()
    session.add(PortfolioAsset(portfolio_id=portfolio.id, ticker=ticker, shares=shares, average_cost=average_cost))
    session.commit()


def test_records_one_snapshot_per_user_with_holdings(snap_db):
    _seed_portfolio(snap_db, user_id=1, ticker="THYAO", shares=10, average_cost=300.0)
    _seed_portfolio(snap_db, user_id=2, ticker="AKBNK", shares=5, average_cost=60.0)

    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.api.v1.endpoints.portfolio._fetch_live_price", side_effect=lambda t: {"THYAO": 320.0, "AKBNK": 65.0}[t]):
        service._run_snapshot_for_all_users()

    snapshots = snap_db.query(PortfolioSnapshot).order_by(PortfolioSnapshot.user_id).all()
    assert len(snapshots) == 2
    assert snapshots[0].user_id == 1
    assert snapshots[0].total_value == pytest.approx(10 * 320.0)
    assert snapshots[1].total_value == pytest.approx(5 * 65.0)


def test_falls_back_to_average_cost_when_live_price_unavailable(snap_db):
    _seed_portfolio(snap_db, user_id=1, ticker="THYAO", shares=10, average_cost=300.0)

    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=None):
        service._run_snapshot_for_all_users()

    snapshot = snap_db.query(PortfolioSnapshot).one()
    assert snapshot.total_value == pytest.approx(10 * 300.0)


def test_skips_users_who_already_have_a_snapshot_today(snap_db):
    _seed_portfolio(snap_db, user_id=1, ticker="THYAO", shares=10, average_cost=300.0)
    # The service stamps snapshot_date from Turkey-local "today" (see
    # portfolio_snapshot.py's _TR_TZ), not the test runner's UTC date -
    # between 21:00-23:59 UTC, Turkey (UTC+3) is already the next calendar
    # day, which made a plain date.today() here flaky against the service's
    # dedup query in that window.
    today_tr = datetime.now(ZoneInfo("Europe/Istanbul")).date()
    snap_db.add(PortfolioSnapshot(user_id=1, snapshot_date=today_tr, total_value=999.0))
    snap_db.commit()

    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0):
        service._run_snapshot_for_all_users()

    snapshots = snap_db.query(PortfolioSnapshot).filter(PortfolioSnapshot.user_id == 1).all()
    # Still just the one pre-existing row - not double-written.
    assert len(snapshots) == 1
    assert snapshots[0].total_value == 999.0


def test_no_users_with_holdings_is_a_no_op(snap_db):
    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db):
        service._run_snapshot_for_all_users()
    assert snap_db.query(PortfolioSnapshot).count() == 0


def test_cash_and_viop_margin_fold_into_snapshot_total_value(snap_db):
    _seed_portfolio(snap_db, user_id=1, ticker="THYAO", shares=10, average_cost=300.0)
    portfolio = snap_db.query(Portfolio).filter(Portfolio.user_id == 1).first()
    portfolio.cash_balance = 1000.0
    portfolio.viop_margin = 500.0
    snap_db.commit()

    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.api.v1.endpoints.portfolio._fetch_live_price", return_value=320.0):
        service._run_snapshot_for_all_users()

    snapshot = snap_db.query(PortfolioSnapshot).one()
    assert snapshot.total_value == pytest.approx(10 * 320.0 + 1000.0 + 500.0)


def test_cash_only_portfolio_with_no_assets_still_gets_a_snapshot(snap_db):
    # Previously this whole user was skipped (the old `if p.assets:` guard
    # never added them to assets_by_user at all) - an admin-managed
    # portfolio holding only cash/VİOP teminatı and no priced assets
    # silently never appeared on the equity curve.
    portfolio = Portfolio(user_id=1, name="Ana Portföy", cash_balance=2500.0)
    snap_db.add(portfolio)
    snap_db.commit()

    service = PortfolioSnapshotService()
    with patch("app.services.portfolio_snapshot.SessionLocal", return_value=snap_db):
        service._run_snapshot_for_all_users()

    snapshot = snap_db.query(PortfolioSnapshot).one()
    assert snapshot.user_id == 1
    assert snapshot.total_value == pytest.approx(2500.0)
