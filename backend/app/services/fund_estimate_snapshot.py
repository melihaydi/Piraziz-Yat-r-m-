"""
Daily accuracy tracking for the "Popüler Fonlar - Anlık Getiri" live
estimate (see tefas_service.get_live_estimated_return and
GET /funds/popular/live-estimate). See FundEstimateSnapshot's docstring in
app/models/fund_estimate_snapshot.py for the table shape.
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import List

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.services.tefas import tefas_service

logger = logging.getLogger(__name__)

# Same funds the "Popüler Fonlar" feature tracks (see POPULAR_LIVE_FUNDS in
# app/api/v1/endpoints/funds.py) - kept as a separate constant here rather
# than imported from that endpoint module, since a service pulling from an
# API-layer module would be backwards layering.
TRACKED_FUND_CODES: List[str] = ["TMV", "PBR", "DFI", "TLY"]


class FundEstimateSnapshotService:
    """Same "background-refreshed, own daemon thread" shape as
    PortfolioSnapshotService (see portfolio_snapshot.py) - one daily run,
    timed AFTER TefasService's own 19:30 daily refresh (see
    tefas.py's start_daily_scheduler) so get_fund()'s daily_return is
    already that day's final settled figure, captures both the live
    estimate and the real published return for the SAME day in one row -
    no separate next-day backfill step needed. Skips funds that already
    have a snapshot for today rather than relying only on the timer, so a
    backend restart mid-evening can't double-write (the table also has a
    DB-level unique constraint on (fund_code, snapshot_date) as a second
    line of defense)."""

    def __init__(self):
        self._scheduler_started = False

    def _run_snapshot(self) -> None:
        db: Session = SessionLocal()
        try:
            today = datetime.now().date()

            already_done = {
                row[0] for row in
                db.query(FundEstimateSnapshot.fund_code)
                .filter(FundEstimateSnapshot.snapshot_date == today)
                .filter(FundEstimateSnapshot.fund_code.in_(TRACKED_FUND_CODES))
                .all()
            }
            pending = [code for code in TRACKED_FUND_CODES if code not in already_done]
            if not pending:
                return

            for code in pending:
                estimate = tefas_service.get_live_estimated_return(code)
                fund = tefas_service.get_fund(code)
                db.add(FundEstimateSnapshot(
                    fund_code=code,
                    snapshot_date=today,
                    estimated_change_pct=estimate["estimated_change_pct"] if estimate else None,
                    resolved_weight_pct=estimate["resolved_weight_pct"] if estimate else None,
                    actual_change_pct=fund["daily_return"] if fund else None,
                ))
            db.commit()
            logger.info(f"Fund estimate snapshot: recorded {len(pending)} funds for {today}.")
        except Exception as e:
            db.rollback()
            logger.error(f"Fund estimate snapshot run failed: {e}")
        finally:
            db.close()

    def start_daily_scheduler(self, hour: int = 19, minute: int = 45, startup_delay_seconds: int = 120):
        """Defaults to 19:45 - 15 minutes after TefasService's own 19:30
        daily refresh, so get_fund()'s daily_return has settled to that
        day's real final figure by the time this runs. Longer startup delay
        than PortfolioSnapshotService's (120s vs 90s) since this also needs
        market_data_service's live quotes populated for the estimate leg,
        not just fund NAV prices.

        The startup run only fires if today's target time has ALREADY
        passed (a genuine catch-up - e.g. the backend was down at 19:45 and
        just came back at 22:00) - it must NOT fire unconditionally on every
        restart. TefasService refreshes daily_return hourly all day (see
        tefas.py's price_loop) and it only reaches that day's real FINAL
        figure once TEFAS's own 19:30 daily refresh has run - a restart
        during market hours used to snapshot a still-moving intraday number
        as if it were settled, and the (fund_code, snapshot_date) dedup
        guard then permanently blocked the real 19:45 run from ever
        correcting it. Confirmed live: two consecutive days' actual_change_pct
        came out identical after a same-day restart, which is what exposed
        this."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            now = datetime.now()
            target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if now >= target_today:
                self._run_snapshot()
            while True:
                now = datetime.now()
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._run_snapshot()

        threading.Thread(target=loop, daemon=True).start()


fund_estimate_snapshot_service = FundEstimateSnapshotService()
