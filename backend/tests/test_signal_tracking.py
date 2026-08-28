from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.strategy_signal import StrategySignal
from app.services.signal_tracking import SignalTrackingService
from app.services.strategy_engine import SignalHistoryEntry

# Self-contained in-memory DB, same reasoning as test_fund_estimate_snapshot.py:
# the service opens its own session via SessionLocal() rather than taking one
# as a dependency.
_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def sig_db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=_engine)


def _entry(ticker="THYAO", direction="LONG", entry=300.0, stop=290.0, target=320.0, timestamp=None, confidence="Yüksek"):
    return SignalHistoryEntry(
        ticker=ticker, name=ticker, direction=direction, price=entry, score=80,
        confidence=confidence, entry=entry, stop_loss=stop, take_profit=target,
        timestamp=(timestamp or datetime.now(timezone.utc)).isoformat(),
    )


def test_record_new_signals_writes_complete_entries(sig_db):
    service = SignalTrackingService()
    history = [_entry(ticker="THYAO"), _entry(ticker="GARAN", direction="SHORT", entry=100.0, stop=105.0, target=90.0)]

    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.strategy_engine.get_signal_history", return_value=history):
        service.record_new_signals()

    rows = sig_db.query(StrategySignal).order_by(StrategySignal.ticker).all()
    assert [r.ticker for r in rows] == ["GARAN", "THYAO"]
    thyao = next(r for r in rows if r.ticker == "THYAO")
    assert thyao.direction == "LONG"
    assert thyao.entry_price == 300.0
    assert thyao.stop_price == 290.0
    assert thyao.target_price == 320.0
    assert thyao.outcome is None


def test_record_new_signals_skips_entries_missing_entry_stop_or_target(sig_db):
    service = SignalTrackingService()
    incomplete = _entry(ticker="AKBNK")
    incomplete.take_profit = None
    history = [incomplete]

    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.strategy_engine.get_signal_history", return_value=history):
        service.record_new_signals()

    assert sig_db.query(StrategySignal).count() == 0


def test_record_new_signals_is_idempotent(sig_db):
    service = SignalTrackingService()
    history = [_entry(ticker="THYAO")]

    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.strategy_engine.get_signal_history", return_value=history):
        service.record_new_signals()
        service.record_new_signals()

    assert sig_db.query(StrategySignal).count() == 1


def test_backfill_marks_win_for_long_when_price_hits_target(sig_db):
    sig_db.add(StrategySignal(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 325.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome == "WIN"
    assert row.return_pct == pytest.approx((325.0 - 300.0) / 300.0 * 100, abs=0.01)
    assert row.resolved_at is not None


def test_backfill_marks_loss_for_long_when_price_hits_stop(sig_db):
    sig_db.add(StrategySignal(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 285.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome == "LOSS"
    assert row.return_pct == pytest.approx((285.0 - 300.0) / 300.0 * 100, abs=0.01)


def test_backfill_marks_win_for_short_when_price_hits_target(sig_db):
    sig_db.add(StrategySignal(
        ticker="GARAN", direction="SHORT", entry_price=100.0, stop_price=105.0,
        target_price=90.0, confidence="Orta", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 88.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome == "WIN"
    # SHORT: getiri ters işaretli - fiyat düştükçe pozitif return_pct
    assert row.return_pct == pytest.approx((100.0 - 88.0) / 100.0 * 100, abs=0.01)


def test_backfill_marks_loss_for_short_when_price_hits_stop(sig_db):
    sig_db.add(StrategySignal(
        ticker="GARAN", direction="SHORT", entry_price=100.0, stop_price=105.0,
        target_price=90.0, confidence="Orta", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 108.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome == "LOSS"
    assert row.return_pct == pytest.approx((100.0 - 108.0) / 100.0 * 100, abs=0.01)


def test_backfill_leaves_open_when_neither_touched_and_not_expired(sig_db):
    sig_db.add(StrategySignal(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 305.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome is None
    assert row.resolved_at is None


def test_backfill_expires_stale_open_signal_past_max_open_days(sig_db):
    sig_db.add(StrategySignal(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek", fired_at=datetime.now(timezone.utc) - timedelta(days=11),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value={"last": 305.0}):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome == "EXPIRED"
    assert row.return_pct == pytest.approx((305.0 - 300.0) / 300.0 * 100, abs=0.01)


def test_backfill_skips_when_quote_unavailable(sig_db):
    sig_db.add(StrategySignal(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek", fired_at=datetime.now(timezone.utc) - timedelta(days=1),
    ))
    sig_db.commit()

    service = SignalTrackingService()
    with patch("app.services.signal_tracking.SessionLocal", return_value=sig_db), \
         patch("app.services.signal_tracking.market_data_service.get_quote", return_value=None):
        service.backfill_outcomes()

    row = sig_db.query(StrategySignal).one()
    assert row.outcome is None
