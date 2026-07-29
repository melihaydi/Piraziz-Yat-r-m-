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

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot

logger = logging.getLogger(__name__)


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
            today = datetime.now().date()

            assets_by_user: Dict[int, List[PortfolioAsset]] = {}
            for p in db.query(Portfolio).all():
                if p.assets:
                    assets_by_user.setdefault(p.user_id, []).extend(p.assets)

            if not assets_by_user:
                return

            already_done = {
                row[0] for row in
                db.query(PortfolioSnapshot.user_id)
                .filter(PortfolioSnapshot.snapshot_date == today)
                .filter(PortfolioSnapshot.user_id.in_(assets_by_user.keys()))
                .all()
            }
            pending = {uid: assets for uid, assets in assets_by_user.items() if uid not in already_done}
            if not pending:
                return

            all_tickers = sorted({a.ticker.upper() for assets in pending.values() for a in assets})
            with ThreadPoolExecutor(max_workers=min(len(all_tickers), 8)) as pool:
                price_by_ticker = dict(zip(all_tickers, pool.map(_fetch_live_price, all_tickers)))

            for uid, assets in pending.items():
                total_value = sum(
                    a.shares * (price_by_ticker.get(a.ticker.upper()) or a.average_cost)
                    for a in assets
                )
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
        first (catch-up) run gives real quotes time to arrive first."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            self._run_snapshot_for_all_users()
            while True:
                now = datetime.now()
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._run_snapshot_for_all_users()

        threading.Thread(target=loop, daemon=True).start()


portfolio_snapshot_service = PortfolioSnapshotService()
