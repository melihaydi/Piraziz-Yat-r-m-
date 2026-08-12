"""
Daily portfolio equity-curve snapshots. See PortfolioSnapshot's docstring in
app/models/portfolio.py for the table shape and the "no backfill" caveat -
this only starts recording from whenever the daily scheduler first runs on
a given deployment, so a freshly-tracked account's curve starts thin and
fills in one point per day going forward.
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import Dict, List
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.portfolio import Portfolio, PortfolioSnapshot

logger = logging.getLogger(__name__)

# The container's system clock runs UTC, not Turkey time - a naive
# datetime.now() compared against a literal hour=20 target fired this at
# 20:00 UTC (23:00 TR) instead of the intended post-close 20:00 TR. See
# market_data.py's _BIST_TZ for the same pattern used correctly elsewhere.
_TR_TZ = ZoneInfo("Europe/Istanbul")


class PortfolioSnapshotService:
    """Same "background-refreshed, own daemon thread" shape as TefasService/
    StrategyEngine (see their start_daily_scheduler/start_background_refresh
    in tefas.py/strategy_engine.py) - one daily run computes every user
    with at least one holding's current total portfolio value (reusing
    portfolio.py's own live-price gathering via _fetch_live_price) and
    inserts one PortfolioSnapshot row per user. Skips users who already
    have a snapshot for today rather than relying only on the once-a-day
    timer, so a backend restart mid-day can't double-write (the table also
    has a DB-level unique constraint on (user_id, snapshot_date) as a
    second line of defense)."""

    def __init__(self):
        self._scheduler_started = False

    def _run_snapshot_for_all_users(self) -> None:
        from concurrent.futures import ThreadPoolExecutor
        from app.api.v1.endpoints.portfolio import _fetch_live_price

        db: Session = SessionLocal()
        try:
            today = datetime.now(_TR_TZ).date()

            # Keyed by the whole Portfolio row (not just its assets) so cash
            # and VİOP teminatı - which have no `assets` entry of their own -
            # still count toward the snapshot, and so a portfolio holding
            # ONLY cash/margin (no priced assets at all) still gets a
            # snapshot instead of being skipped entirely (the old `if
            # p.assets:` guard here silently dropped those users).
            portfolios_by_user: Dict[int, List[Portfolio]] = {}
            for p in db.query(Portfolio).all():
                portfolios_by_user.setdefault(p.user_id, []).append(p)

            if not portfolios_by_user:
                return

            already_done = {
                row[0] for row in
                db.query(PortfolioSnapshot.user_id)
                .filter(PortfolioSnapshot.snapshot_date == today)
                .filter(PortfolioSnapshot.user_id.in_(portfolios_by_user.keys()))
                .all()
            }
            pending = {uid: portfolios for uid, portfolios in portfolios_by_user.items() if uid not in already_done}
            if not pending:
                return

            all_tickers = sorted({
                a.ticker.upper() for portfolios in pending.values() for p in portfolios for a in p.assets
            })
            # A cash/VİOP-teminatı-only portfolio contributes no tickers at
            # all - ThreadPoolExecutor rejects max_workers=0 outright, and
            # since that's now possible (unlike before, when only users with
            # assets were tracked here), this must be skipped rather than
            # unconditionally spun up.
            price_by_ticker: Dict[str, float] = {}
            if all_tickers:
                with ThreadPoolExecutor(max_workers=min(len(all_tickers), 8)) as pool:
                    price_by_ticker = dict(zip(all_tickers, pool.map(_fetch_live_price, all_tickers)))

            for uid, portfolios in pending.items():
                total_value = sum(
                    a.shares * (price_by_ticker.get(a.ticker.upper()) or a.average_cost)
                    for p in portfolios for a in p.assets
                ) + sum(p.cash_balance + p.viop_margin for p in portfolios)
                db.add(PortfolioSnapshot(user_id=uid, snapshot_date=today, total_value=total_value))
            db.commit()
            logger.info(f"Portfolio snapshot: recorded {len(pending)} users' total value for {today}.")
        except Exception as e:
            db.rollback()
            logger.error(f"Portfolio snapshot run failed: {e}")
        finally:
            db.close()

    def start_daily_scheduler(self, hour: int = 20, minute: int = 0, startup_delay_seconds: int = 90):
        """Defaults to 20:00 local time - after both BIST's 18:00 close and
        TefasService's own 19:30 daily refresh (see tefas.py), so fund NAVs
        used in that day's snapshot are already the fresh end-of-day ones
        instead of the previous day's stale price.

        Unlike TefasService/StrategyEngine's caches (which self-heal on
        their next refresh if a value is briefly wrong), a PortfolioSnapshot
        row is a permanent once-a-day historical record protected by a DB
        unique constraint - it can't just be silently overwritten later.
        market_data_service.get_quote() returns a hardcoded 150.0 placeholder
        for any symbol whose live-quote WebSocket subscription hasn't
        finished connecting yet (see market_data.py's `default_val =
        fallbacks.get(symbol, 150.0)`), which is exactly what a request in
        the first second after container startup hits - confirmed live,
        this baked a wrong ₺1500 snapshot for a ₺3190 THYAO position before
        this delay was added. Waiting `startup_delay_seconds` before the
        first (catch-up) run gives real quotes time to arrive first.

        The startup run only fires if today's target time has ALREADY
        passed - it must NOT fire unconditionally on every restart. It
        used to (unlike fund_estimate_snapshot.py's otherwise-identical
        scheduler, which already had this guard), so any deploy before
        20:00 - a normal occurrence - permanently locked in that day's
        equity-curve point as whatever the portfolio was worth at deploy
        time instead of the intended post-close value, since the
        (user_id, snapshot_date) unique constraint then blocks the real
        20:00 run from ever correcting it. Confirmed live: every single
        day's row in the table was created by a restart, morning or
        midday, never once by the actual 20:00 timer."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            now = datetime.now(_TR_TZ)
            target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if now >= target_today:
                self._run_snapshot_for_all_users()
            while True:
                now = datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._run_snapshot_for_all_users()

        threading.Thread(target=loop, daemon=True).start()


portfolio_snapshot_service = PortfolioSnapshotService()
