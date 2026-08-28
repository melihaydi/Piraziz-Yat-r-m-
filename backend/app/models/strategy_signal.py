from sqlalchemy import Column, Integer, String, Float, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base_class import Base


class StrategySignal(Base):
    """One row per LONG/SHORT call StrategyEngine's scanner ever fired (see
    strategy_engine.py's SignalHistoryEntry - THIS table is that same event,
    just persisted permanently instead of living only in the engine's
    in-memory/Redis intraday log, which resets every trading day).

    Written once when the signal fires (fired_at, entry/stop/target,
    confidence - see signal_tracking.record_new_signals), then resolved
    later once price actually hits the stop or target (resolved_at, outcome,
    return_pct - see signal_tracking.backfill_outcomes). This is the raw
    data behind the public "Sinyal Karnesi" - every call the scanner made is
    recorded here BEFORE its outcome is known, so the scorecard can't
    silently drop the losing calls.
    """
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    direction = Column(String(5), nullable=False)  # "LONG" | "SHORT"
    entry_price = Column(Float, nullable=False)
    stop_price = Column(Float, nullable=False)
    target_price = Column(Float, nullable=False)
    confidence = Column(String(10), nullable=False)  # "Yüksek" | "Orta" | "Düşük"
    fired_at = Column(DateTime(timezone=True), nullable=False, index=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    # None while still open. "WIN" (target hit first), "LOSS" (stop hit
    # first), "EXPIRED" (neither hit within the tracking window - see
    # signal_tracking's MAX_OPEN_DAYS).
    outcome = Column(String(10), nullable=True)
    return_pct = Column(Float, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("ticker", "fired_at", name="uq_strategy_signal_ticker_fired_at"),
    )
