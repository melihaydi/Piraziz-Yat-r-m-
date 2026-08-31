"""
Endeks giriş/çıkış takibi - BIST30/BIST100'ün bileşen listesi günde bir kez
anlık görüntülenip (bkz. IndexMembership) bir önceki gündeki listeyle
karşılaştırılır; farkı olan (yeni giren/çıkan) her ticker için bir
IndexChangeEvent kaydı yazılır.

Bu, resmi bir "rebalance takvimi" DEĞİL - borsapy.Index'in AN İTİBARIYLA
döndürdüğü gerçek bileşen listesindeki değişimin gün-be-gün gözlenmesi.
BIST'in kendi periyodik rebalance duyurularından bağımsız, ama pratikte
aynı gerçek değişimi (bir hissenin fiilen endekse girdiği/çıktığı günü)
yakalıyor.
"""
import logging
import threading
import time
from datetime import datetime, timedelta
from typing import List
from zoneinfo import ZoneInfo

import borsapy
from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.index_membership import IndexMembership, IndexChangeEvent

logger = logging.getLogger(__name__)

_TR_TZ = ZoneInfo("Europe/Istanbul")

# BIST30 (XU030) ve BIST100 (XU100) - uygulamanın geri kalanında zaten
# takip edilen iki ana endeks (bkz. market_data.py'nin piyasa özeti).
TRACKED_INDEX_CODES: List[str] = ["XU030", "XU100"]


def _fetch_component_symbols(index_code: str) -> List[str]:
    return [s.upper() for s in borsapy.Index(index_code).component_symbols]


def run_daily_snapshot() -> None:
    """Her endeks için BUGÜNÜN gerçek bileşen listesini çeker, bugüne ait
    bir snapshot zaten varsa atlar (restart güvenliği - fund_estimate_
    snapshot.py'deki aynı desen). Bugünden ÖNCEKİ en son snapshot'la
    karşılaştırıp fark varsa IndexChangeEvent yazar."""
    db: Session = SessionLocal()
    try:
        today = datetime.now(_TR_TZ).date()

        for index_code in TRACKED_INDEX_CODES:
            already_done = db.query(IndexMembership.id).filter(
                IndexMembership.index_code == index_code,
                IndexMembership.snapshot_date == today,
            ).first()
            if already_done:
                continue

            try:
                current_symbols = set(_fetch_component_symbols(index_code))
            except Exception as e:
                logger.error(f"Index tracker: failed to fetch components for {index_code}: {e}")
                continue
            if not current_symbols:
                continue

            last_snapshot_date = (
                db.query(IndexMembership.snapshot_date)
                .filter(IndexMembership.index_code == index_code, IndexMembership.snapshot_date < today)
                .order_by(IndexMembership.snapshot_date.desc())
                .limit(1)
                .scalar()
            )

            if last_snapshot_date is not None:
                previous_symbols = {
                    row[0] for row in
                    db.query(IndexMembership.ticker)
                    .filter(IndexMembership.index_code == index_code, IndexMembership.snapshot_date == last_snapshot_date)
                    .all()
                }
                added = current_symbols - previous_symbols
                removed = previous_symbols - current_symbols
                for ticker in added:
                    db.add(IndexChangeEvent(index_code=index_code, ticker=ticker, change_type="ADDED", detected_date=today))
                for ticker in removed:
                    db.add(IndexChangeEvent(index_code=index_code, ticker=ticker, change_type="REMOVED", detected_date=today))
                if added or removed:
                    logger.info(f"Index tracker: {index_code} changed - +{sorted(added)} -{sorted(removed)}")

            for ticker in current_symbols:
                db.add(IndexMembership(index_code=index_code, ticker=ticker, snapshot_date=today))

        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Index tracker daily snapshot failed: {e}")
    finally:
        db.close()


def get_recent_changes(db: Session, days: int = 30) -> List[IndexChangeEvent]:
    cutoff = datetime.now(_TR_TZ).date() - timedelta(days=days)
    return (
        db.query(IndexChangeEvent)
        .filter(IndexChangeEvent.detected_date >= cutoff)
        .order_by(IndexChangeEvent.detected_date.desc(), IndexChangeEvent.index_code, IndexChangeEvent.ticker)
        .all()
    )


class IndexTrackerService:
    """Diğer *_snapshot.py servisleriyle aynı "kendi arka plan thread'i,
    günde bir kez çalışır" deseni (bkz. fund_estimate_snapshot.py,
    portfolio_snapshot.py)."""

    def __init__(self):
        self._scheduler_started = False

    def start_daily_scheduler(self, hour: int = 19, minute: int = 0, startup_delay_seconds: int = 90):
        """19:00 TR - BIST'in 18:00 kapanışından sonra, o günün gerçek
        (kapanış sonrası netleşmiş) bileşen listesini yakalamak için."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            now = datetime.now(_TR_TZ)
            target_today = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
            if now >= target_today:
                run_daily_snapshot()
            while True:
                now = datetime.now(_TR_TZ)
                target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                run_daily_snapshot()

        threading.Thread(target=loop, daemon=True).start()


index_tracker_service = IndexTrackerService()
