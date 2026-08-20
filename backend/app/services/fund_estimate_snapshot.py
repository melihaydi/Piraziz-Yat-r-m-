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
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.services.tefas import tefas_service

logger = logging.getLogger(__name__)

# The container's system clock runs UTC, not Turkey time - a naive
# datetime.now() compared against a literal hour=19/minute=45 target fired
# this at 19:45 UTC (22:45 TR) instead of the intended 19:45 TR, 15 minutes
# after TefasService's own (equally mistimed, see tefas.py) daily refresh.
# See market_data.py's _BIST_TZ for the same pattern used correctly elsewhere.
_TR_TZ = ZoneInfo("Europe/Istanbul")

# Same funds the "Popüler Fonlar" feature tracks (see POPULAR_LIVE_FUNDS in
# app/api/v1/endpoints/funds.py) - kept as a separate constant here rather
# than imported from that endpoint module, since a service pulling from an
# API-layer module would be backwards layering.
TRACKED_FUND_CODES: List[str] = ["TMV", "DOH", "TLY", "THF"]


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
            today = datetime.now(_TR_TZ).date()

            # TEFAS doesn't publish NAVs on weekends (no trading day), so
            # get_fund()'s daily_return on a Saturday/Sunday is just
            # whatever Friday's figure was still sitting in cache - snapshotting
            # it here would silently record a fake "actual_change_pct" for a
            # day nothing actually happened, and the accuracy table would
            # show Saturday/Sunday rows a user can't sanity-check against
            # anything real. Monday=0 ... Sunday=6 (Python's weekday()).
            if today.weekday() >= 5:
                return

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
                    # First-pass value only - get_fund()'s daily_return is a
                    # ROLLING "latest vs previous close" figure, and TEFAS's
                    # own settlement doesn't always land before this same-
                    # evening run (confirmed live: a Friday's real NAV
                    # sometimes only firms up the following Monday morning).
                    # _backfill_recent_actuals() below re-derives this same
                    # figure from the dated historical series on later runs,
                    # overwriting this provisional value once it's settled.
                    actual_change_pct=fund["daily_return"] if fund else None,
                ))
            db.commit()
            logger.info(f"Fund estimate snapshot: recorded {len(pending)} funds for {today}.")

            self._backfill_recent_actuals(db)
        except Exception as e:
            db.rollback()
            logger.error(f"Fund estimate snapshot run failed: {e}")
        finally:
            db.close()

    def _backfill_recent_actuals(self, db: Session) -> None:
        """Re-derives actual_change_pct for the last several days' rows from
        tefas_service's DATED historical NAV series (see
        TefasService.get_dated_return_pct), overwriting whatever same-evening
        daily_return-based value was first written. Bounded to a short
        lookback (not the whole table) since this runs on every daily
        snapshot and older rows are never expected to still be wrong - if a
        date isn't in the historical series yet, get_dated_return_pct
        returns None and that row is simply left untouched until a later run
        has real data for it."""
        cutoff = datetime.now(_TR_TZ).date() - timedelta(days=5)
        candidates = db.query(FundEstimateSnapshot).filter(
            FundEstimateSnapshot.fund_code.in_(TRACKED_FUND_CODES),
            FundEstimateSnapshot.snapshot_date >= cutoff,
        ).all()

        updated = 0
        for row in candidates:
            dated_return = tefas_service.get_dated_return_pct(row.fund_code, row.snapshot_date)
            if dated_return is None or dated_return == row.actual_change_pct:
                continue
            row.actual_change_pct = dated_return
            updated += 1

        if updated:
            db.commit()
            logger.info(f"Fund estimate snapshot: backfilled {updated} settled actual_change_pct value(s).")

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
            now = datetime.now(_TR_TZ)
            target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if now >= target_today:
                self._run_snapshot()
            while True:
                now = datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._run_snapshot()

        threading.Thread(target=loop, daemon=True).start()


fund_estimate_snapshot_service = FundEstimateSnapshotService()
