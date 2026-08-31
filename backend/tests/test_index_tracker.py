from datetime import datetime as real_datetime, timedelta, date
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.index_membership import IndexMembership, IndexChangeEvent
from app.services import index_tracker


class _FixedDateTime(real_datetime):
    """Aynı fund_estimate_snapshot.py testlerindeki desen - "bugün"ü
    deterministik kılmak için."""
    _fixed = real_datetime(2026, 1, 1)

    @classmethod
    def now(cls, tz=None):
        return cls._fixed


_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def idx_db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=_engine)


def _run_on(day: real_datetime, db, symbols_by_index: dict):
    _FixedDateTime._fixed = day
    with patch("app.services.index_tracker.SessionLocal", return_value=db), \
         patch("app.services.index_tracker.datetime", _FixedDateTime), \
         patch("app.services.index_tracker._fetch_component_symbols", side_effect=lambda code: symbols_by_index[code]):
        index_tracker.run_daily_snapshot()


def test_first_run_writes_membership_but_no_change_events(idx_db):
    day1 = real_datetime(2026, 1, 1)
    _run_on(day1, idx_db, {"XU030": ["THYAO", "GARAN"], "XU100": ["THYAO", "GARAN", "AKBNK"]})

    rows = idx_db.query(IndexMembership).filter(IndexMembership.index_code == "XU030").all()
    assert {r.ticker for r in rows} == {"THYAO", "GARAN"}
    assert idx_db.query(IndexChangeEvent).count() == 0


def test_second_run_with_changed_components_creates_change_events(idx_db):
    day1 = real_datetime(2026, 1, 1)
    day2 = real_datetime(2026, 1, 2)
    _run_on(day1, idx_db, {"XU030": ["THYAO", "GARAN"], "XU100": ["THYAO", "GARAN", "AKBNK"]})
    # GARAN çıktı, ASELS girdi.
    _run_on(day2, idx_db, {"XU030": ["THYAO", "ASELS"], "XU100": ["THYAO", "GARAN", "AKBNK"]})

    events = idx_db.query(IndexChangeEvent).filter(IndexChangeEvent.index_code == "XU030").all()
    by_ticker = {e.ticker: e.change_type for e in events}
    assert by_ticker == {"ASELS": "ADDED", "GARAN": "REMOVED"}
    assert all(e.detected_date == date(2026, 1, 2) for e in events)

    # XU100 değişmedi - hiç event olmamalı.
    xu100_events = idx_db.query(IndexChangeEvent).filter(IndexChangeEvent.index_code == "XU100").all()
    assert xu100_events == []

    # Yeni snapshot da yazılmış olmalı (bugünün gerçek listesi).
    day2_rows = idx_db.query(IndexMembership).filter(
        IndexMembership.index_code == "XU030", IndexMembership.snapshot_date == date(2026, 1, 2)
    ).all()
    assert {r.ticker for r in day2_rows} == {"THYAO", "ASELS"}


def test_rerun_same_day_is_idempotent(idx_db):
    day1 = real_datetime(2026, 1, 1)
    _run_on(day1, idx_db, {"XU030": ["THYAO", "GARAN"], "XU100": ["THYAO"]})
    _run_on(day1, idx_db, {"XU030": ["THYAO", "GARAN", "ASELS"], "XU100": ["THYAO"]})  # aynı gün farklı veri gelse bile

    rows = idx_db.query(IndexMembership).filter(IndexMembership.index_code == "XU030").all()
    # İkinci çağrı atlandığı için hâlâ sadece ilk çağrının 2 satırı olmalı.
    assert {r.ticker for r in rows} == {"THYAO", "GARAN"}
    assert idx_db.query(IndexChangeEvent).count() == 0


def test_get_recent_changes_filters_by_window_and_orders(idx_db):
    today = date(2026, 1, 10)
    idx_db.add(IndexChangeEvent(index_code="XU030", ticker="ASELS", change_type="ADDED", detected_date=today))
    idx_db.add(IndexChangeEvent(index_code="XU030", ticker="OLDTICK", change_type="REMOVED", detected_date=today - timedelta(days=40)))
    idx_db.commit()

    with patch("app.services.index_tracker.datetime", _FixedDateTime):
        _FixedDateTime._fixed = real_datetime(2026, 1, 10)
        events = index_tracker.get_recent_changes(idx_db, days=30)

    tickers = [e.ticker for e in events]
    assert "ASELS" in tickers
    assert "OLDTICK" not in tickers
