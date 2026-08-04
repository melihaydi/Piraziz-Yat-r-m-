from sqlalchemy import Column, Integer, String, Float, Date, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base_class import Base


class FundEstimateSnapshot(Base):
    """One row per (fund_code, day): the live intraday estimate
    (estimated_change_pct, from tefas_service.get_live_estimated_return)
    captured alongside TEFAS's real published daily_return for that SAME
    day (actual_change_pct) - both captured in the same daily run, timed
    after TefasService's own 19:30 daily refresh so `daily_return` is
    already that day's final settled figure (see
    FundEstimateSnapshotService), not a cross-day backfill. Lets the
    estimator's accuracy be checked later: "what did we predict for
    2026-08-03 vs. what actually happened."
    """
    id = Column(Integer, primary_key=True, index=True)
    fund_code = Column(String(10), nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    estimated_change_pct = Column(Float, nullable=True)
    resolved_weight_pct = Column(Float, nullable=True)
    actual_change_pct = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("fund_code", "snapshot_date", name="uq_fund_estimate_snapshot_code_date"),
    )
