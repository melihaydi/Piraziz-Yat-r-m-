from datetime import date, timedelta
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.services.fund_estimate_snapshot import FundEstimateSnapshotService, TRACKED_FUND_CODES

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


def test_records_one_snapshot_per_tracked_fund(snap_db):
    service = FundEstimateSnapshotService()
    with patch("app.services.fund_estimate_snapshot.SessionLocal", return_value=snap_db), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_live_estimated_return", side_effect=_fake_estimate), \
         patch("app.services.fund_estimate_snapshot.tefas_service.get_fund", side_effect=_fake_fund):
        service._run_snapshot()

    rows = snap_db.query(FundEstimateSnapshot).all()
    assert {r.fund_code for r in rows} == set(TRACKED_FUND_CODES)
    for r in rows:
        assert r.snapshot_date == date.today()
        assert r.estimated_change_pct == 1.5
        assert r.resolved_weight_pct == 90.0
        assert r.actual_change_pct == 1.2


def test_skips_funds_that_already_have_a_snapshot_today(snap_db):
    snap_db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=date.today(),
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


def test_estimate_history_endpoint_returns_snapshots_with_computed_error(client, db):
    db.add(FundEstimateSnapshot(
        fund_code="PBR", snapshot_date=date.today(),
        estimated_change_pct=1.0, resolved_weight_pct=100.0, actual_change_pct=0.6,
    ))
    db.add(FundEstimateSnapshot(
        fund_code="TMV", snapshot_date=date.today() - timedelta(days=1),
        estimated_change_pct=2.0, resolved_weight_pct=56.7, actual_change_pct=None,
    ))
    db.commit()

    response = client.get("/api/v1/funds/popular/estimate-history")
    assert response.status_code == 200
    snapshots = response.json()["snapshots"]

    pbr_row = next(s for s in snapshots if s["fund_code"] == "PBR")
    assert pbr_row["estimated_change_pct"] == 1.0
    assert pbr_row["actual_change_pct"] == 0.6
    assert pbr_row["error_pct"] == pytest.approx(0.4)

    tmv_row = next(s for s in snapshots if s["fund_code"] == "TMV")
    assert tmv_row["actual_change_pct"] is None
    assert tmv_row["error_pct"] is None  # can't compute error without an actual yet


def test_estimate_history_endpoint_respects_days_cutoff(client, db):
    db.add(FundEstimateSnapshot(
        fund_code="DFI", snapshot_date=date.today() - timedelta(days=60),
        estimated_change_pct=1.0, resolved_weight_pct=100.0, actual_change_pct=1.0,
    ))
    db.commit()

    response = client.get("/api/v1/funds/popular/estimate-history?days=30")
    assert response.status_code == 200
    assert response.json()["snapshots"] == []
