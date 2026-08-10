"""
Daily job: downgrades any user whose paid Subscription.expires_at has
passed back to role="free". A Checkout Form payment (see
payment_service.py) buys a fixed period, not an auto-renewing
subscription - nothing else ever un-grants a paid role, so without this
job an expired payment would leave someone premium forever.
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.subscription import Subscription
from app.models.user import User
from app.core.audit import log_audit

logger = logging.getLogger(__name__)

# Same reasoning as market_data.py's _BIST_TZ / the other daily schedulers
# in this codebase (tefas.py, portfolio_snapshot.py, fund_estimate_snapshot.py)
# - the container's system clock is UTC, so this must convert explicitly
# rather than compare a naive datetime.now() against a literal hour target.
_TR_TZ = ZoneInfo("Europe/Istanbul")


class SubscriptionExpiryService:
    def __init__(self):
        self._scheduler_started = False

    def _run_expiry_sweep(self) -> None:
        db: Session = SessionLocal()
        try:
            now = datetime.now(_TR_TZ)
            expired = (
                db.query(Subscription)
                .filter(Subscription.status == "paid", Subscription.expires_at < now)
                .all()
            )
            if not expired:
                return

            downgraded = 0
            for sub in expired:
                user = db.query(User).filter(User.id == sub.user_id).first()
                if not user:
                    continue
                # Skip if the user already has a DIFFERENT, still-valid paid
                # subscription (e.g. they upgraded from starter to premium
                # before the starter one expired) - only downgrade if their
                # current role actually matches the one that just expired.
                still_valid = (
                    db.query(Subscription)
                    .filter(
                        Subscription.user_id == user.id,
                        Subscription.status == "paid",
                        Subscription.expires_at >= now,
                    )
                    .first()
                )
                if still_valid:
                    continue
                if user.role != sub.role:
                    continue
                old_role = user.role
                user.role = "free"
                db.commit()
                log_audit(
                    db, "subscription_expired", user_id=user.id,
                    resource_type="subscription", resource_id=sub.id,
                    details={"old_role": old_role, "new_role": "free"},
                )
                downgraded += 1

            if downgraded:
                logger.info(f"Subscription expiry sweep: downgraded {downgraded} user(s) to free.")
        except Exception as e:
            db.rollback()
            logger.error(f"Subscription expiry sweep failed: {e}")
        finally:
            db.close()

    def start_daily_scheduler(self, hour: int = 3, minute: int = 0, startup_delay_seconds: int = 60):
        """Defaults to 03:00 TR - well outside trading hours, no reason for
        this to compete with anything else for DB/CPU."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            self._run_expiry_sweep()
            while True:
                now = datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                self._run_expiry_sweep()

        threading.Thread(target=loop, daemon=True).start()


subscription_expiry_service = SubscriptionExpiryService()
