from datetime import date, datetime as real_datetime, timedelta
from unittest.mock import patch
from zoneinfo import ZoneInfo

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.services.fund_estimate_snapshot import FundEstimateSnapshotService, TRACKED_FUND_CODES
from app.services.tefas import TefasService


class _FixedDateTime(real_datetime):
    """A datetime subclass whose now() always returns a fixed instant - used
    to deterministically test weekday-dependent behavior (weekend skip)
    regardless of what day the test suite actually happens to run on."""
    _fixed = real_datetime(2026, 1, 1)

    @classmethod
    def now(cls, tz=None):
        return cls._fixed

# Self-contained in-memory DB, same reasoning as test_portfolio_snapshot.py:
# the service opens its own session via SessionLocal() rather than taking
# one as a dependency.
_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def snap_db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=_engine)


def _fake_estimate(code):
    return {"estimated_change_pct": 1.5, "resolved_weight_pct": 90.0, "holdings": []}


def _fake_fund(code):
    return {"code": code, "daily_return": 1.2}


# The service stamps snapshot_date from Turkey-local "today" (see
# fund_estimate_snapshot.py's _TR_TZ), not the CI runner's UTC date - between
# 21:00-23:59 UTC, Turkey (UTC+3) is already the next calendar day, which
# made this comparison flaky against a plain date.today() every run that
# happened to land in that window.
_today_tr = lambda: real_datetime.now(ZoneInfo("Europe/Istanbul")).date()


def test_records_one_snapshot_per_tracked_fund(snap_db):
    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", side_effect=_fake_estimate), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", side_effect=_fake_fund):
        service._run_snapshot()

    rows = snap_db.query(FundEstimateSnapshot).all()
    assert {r.fund_code for r in rows} == set(TRACKED_FUND_CODES)
    for r in rows:
        assert r.snapshot_date == _today_tr()
        assert r.estimated_change_pct == 1.5
        assert r.resolved_weight_pct == 90.0
        assert r.actual_change_pct == 1.2


def test_skips_funds_that_already_have_a_snapshot_today(snap_db):
    snap_db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=_today_tr(),
        estimated_change_pct=9.9, resolved_weight_pct=50.0, actual_change_pct=9.9,
    ))
    snap_db.commit()

    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", side_effect=_fake_estimate), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", side_effect=_fake_fund):
        service._run_snapshot()

    tmv_rows = snap_db.query(FundEstimateSnapshot).filter(FundEstimateSnapshot.fund_code == "TMV").all()
    assert len(tmv_rows) == 1
    assert tmv_rows[0].estimated_change_pct == 9.9  # untouched, not overwritten

    other_rows = snap_db.query(FundEstimateSnapshot).filter(FundEstimateSnapshot.fund_code != "TMV").all()
    assert len(other_rows) == len(TRACKED_FUND_CODES) - 1


def test_handles_unresolvable_fund_gracefully(snap_db):
    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", return_value=None), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", return_value=None):
        service._run_snapshot()

    rows = snap_db.query(FundEstimateSnapshot).all()
    assert len(rows) == len(TRACKED_FUND_CODES)
    for r in rows:
        assert r.estimated_change_pct is None
        assert r.actual_change_pct is None


def _most_recent_weekday(d: date) -> date:
    # The estimate-history endpoint now hides weekend rows on purpose (see
    # test_estimate_history_endpoint_hides_leftover_weekend_rows) - tests
    # that need "some real weekday date" must not land on a Saturday/Sunday
    # by accident depending on what day the suite happens to run on.
    while d.weekday() >= 5:
        d -= timedelta(days=1)
    return d


def test_estimate_history_endpoint_returns_snapshots_with_computed_error(client, db):
    latest = _most_recent_weekday(date.today())
    earlier = _most_recent_weekday(latest - timedelta(days=1))
    db.add(FundEstimateSnapshot(
        fund_code="DOH", snapshot_date=latest,
        estimated_change_pct=1.0, resolved_weight_pct=100.0, actual_change_pct=0.6,
    ))
    db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=earlier,
        estimated_change_pct=2.0, resolved_weight_pct=56.7, actual_change_pct=None,
    ))
    db.commit()

    response = client.get("/api/v1/funds/popular/estimate-history")
    assert response.status_code == 200
    snapshots = response.json()["snapshots"]

    # Must be a code that is currently in POPULAR_LIVE_FUNDS - the endpoint
    # filters on exactly that list, so a snapshot for a fund that has since
    # been rotated out of the spotlight (PBR, DFI) is deliberately not
    # returned here and would make this test vacuous.
    doh_row = next(s for s in snapshots if s["fund_code"] == "DOH")
    assert doh_row["estimated_change_pct"] == 1.0
    assert doh_row["actual_change_pct"] == 0.6
    assert doh_row["error_pct"] == pytest.approx(0.4)

    tmv_row = next(s for s in snapshots if s["fund_code"] == "TMV")
    assert tmv_row["actual_change_pct"] is None
    assert tmv_row["error_pct"] is None  # can't compute error without an actual yet


def test_skips_snapshot_entirely_on_a_weekend(snap_db):
    _FixedDateTime._fixed = real_datetime(2026, 1, 3)  # a Saturday
    service = FundEstimateSnapshotService()
    try:
        with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
             patch("app.services.fund_estimate_snapshot.datetime", _FixedDateTime), \
             patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", side_effect=_fake_estimate), \
             patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", side_effect=_fake_fund):
            service._run_snapshot()
    finally:
        _FixedDateTime._fixed = real_datetime(2026, 1, 6)

    # TEFAS never publishes on a Saturday - no rows should be written at all.
    assert snap_db.query(FundEstimateSnapshot).count() == 0


def test_runs_normally_on_a_weekday(snap_db):
    _FixedDateTime._fixed = real_datetime(2026, 1, 6)  # a Tuesday
    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.services.fund_estimate_snapshot.datetime", _FixedDateTime), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", side_effect=_fake_estimate), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", side_effect=_fake_fund), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_dated_return_pct", return_value=None):
        service._run_snapshot()

    rows = snap_db.query(FundEstimateSnapshot).all()
    assert {r.fund_code for r in rows} == set(TRACKED_FUND_CODES)
    for r in rows:
        assert r.snapshot_date == date(2026, 1, 6)


def _bare_tefas_service() -> TefasService:
    # Avoids TefasService.__init__'s real TEFAS network fetch/background
    # threads - get_dated_return_pct only touches _history_cache and _lock.
    svc = TefasService.__new__(TefasService)
    svc._lock = __import__("threading").Lock()
    svc._history_cache = {}
    return svc


def test_get_dated_return_pct_computes_from_dated_history():
    svc = _bare_tefas_service()
    # Three consecutive real trading days, each candle's time keyed to
    # datetime(y, m, d, 18, 0) per _build_history_sync's convention.
    svc._history_cache["TMV"] = [
        {"time": int(real_datetime(2026, 1, 5, 18, 0).timestamp()), "close": 10.0},
        {"time": int(real_datetime(2026, 1, 6, 18, 0).timestamp()), "close": 10.5},
        {"time": int(real_datetime(2026, 1, 7, 18, 0).timestamp()), "close": 10.2},
    ]
    result = svc.get_dated_return_pct("TMV", date(2026, 1, 6))
    assert result == pytest.approx(5.0)


def test_get_dated_return_pct_returns_none_when_date_not_in_history():
    svc = _bare_tefas_service()
    svc._history_cache["TMV"] = [
        {"time": int(real_datetime(2026, 1, 5, 18, 0).timestamp()), "close": 10.0},
    ]
    assert svc.get_dated_return_pct("TMV", date(2026, 1, 9)) is None


def test_backfill_overwrites_stale_actual_with_settled_dated_value(snap_db):
    snap_db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=date(2026, 1, 2),
        estimated_change_pct=1.0, resolved_weight_pct=90.0, actual_change_pct=0.3,  # provisional, wrong
    ))
    snap_db.commit()

    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.datetime", _FixedDateTime), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_dated_return_pct", return_value=1.8):
        _FixedDateTime._fixed = real_datetime(2026, 1, 6)
        service._backfill_recent_actuals(snap_db)

    row = snap_db.query(FundEstimateSnapshot).filter(FundEstimateSnapshot.fund_code == "TMV").first()
    assert row.actual_change_pct == 1.8


def test_estimate_history_endpoint_respects_days_cutoff(client, db):
    db.add(FundEstimateSnapshot(
        fund_code="DFI", snapshot_date=date.today() - timedelta(days=60),
        estimated_change_pct=1.0, resolved_weight_pct=100.0, actual_change_pct=1.0,
    ))
    db.commit()

    response = client.get("/api/v1/funds/popular/estimate-history?days=30")
    assert response.status_code == 200
    assert response.json()["snapshots"] == []


def test_estimate_history_endpoint_hides_leftover_weekend_rows(client, db):
    # A Saturday row that could only exist from before the weekend-skip fix
    # (or from a manual insert) - must never surface to users, since TEFAS
    # never published anything that day for it to compare against.
    db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=date(2026, 1, 3),  # a Saturday
        estimated_change_pct=1.0, resolved_weight_pct=100.0, actual_change_pct=1.0,
    ))
    db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=date(2026, 1, 6),  # a Tuesday
        estimated_change_pct=2.0, resolved_weight_pct=100.0, actual_change_pct=1.8,
    ))
    db.commit()

    response = client.get("/api/v1/funds/popular/estimate-history?days=0")
    assert response.status_code == 200
    dates = [s["date"] for s in response.json()["snapshots"] if s["fund_code"] == "TMV"]
    assert dates == ["2026-01-06"]
