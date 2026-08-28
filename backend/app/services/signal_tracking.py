"""
Sinyal Karnesi (radikal dürüstlük) - StrategyEngine'in ürettiği HER LONG/
SHORT çağrısını kalıcı olarak StrategySignal tablosuna yazar, sonra
sonucunu (WIN/LOSS/EXPIRED) fiyat gerçekten stop/target'a değince doldurur.
Bkz. app/models/strategy_signal.py'nin docstring'i - strategy_engine.py'nin
kendi intraday geçmişi (SignalHistoryEntry) her gün sıfırlanıyor ve hiçbir
sonuç takibi yapmıyor, bu servis onun kalıcı ve dürüst hali.

fund_estimate_snapshot.py'nin "kendi arka plan thread'i, periyodik çalışır"
deseni burada da kullanılıyor.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone

from sqlalchemy.orm import Session

from app.db.session import SessionLocal
from app.models.strategy_signal import StrategySignal
from app.services.strategy_engine import strategy_engine
from app.services.market_data import market_data_service

logger = logging.getLogger(__name__)

# Bir sinyal bu kadar gün içinde stop ya da hedefe değmezse EXPIRED olarak
# kapatılır - sonsuza kadar "açık" kalan sinyaller karneyi anlamsızlaştırır.
MAX_OPEN_DAYS = 10


def _as_utc(dt: datetime) -> datetime:
    """SQLite (testlerde) DateTime(timezone=True) kolonunu bile naive
    datetime olarak geri veriyor - yazılırken zaten UTC olduğu biliniyor
    (bkz. strategy_engine'in SignalHistoryEntry.timestamp'i,
    datetime.now(timezone.utc).isoformat()), o yüzden tzinfo eksikse UTC
    varsayılır, TR'ye çevrilmez."""
    return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)


class SignalTrackingService:
    def __init__(self):
        self._scheduler_started = False

    def record_new_signals(self) -> None:
        """StrategyEngine'in intraday geçmişindeki (bkz. get_signal_history)
        her girdiyi StrategySignal tablosuna yazmayı dener - (ticker,
        fired_at) unique constraint zaten çift yazmayı engelliyor, bu yüzden
        history'nin TAMAMI her seferinde denenir, ayrıca bir "yeni mi"
        filtrelemesi gerekmez.
        """
        history = strategy_engine.get_signal_history()
        if not history:
            return

        db: Session = SessionLocal()
        try:
            existing = {
                (row[0], _as_utc(row[1]))
                for row in db.query(StrategySignal.ticker, StrategySignal.fired_at).all()
            }
            written = 0
            for entry in history:
                # entry/stop_loss/take_profit hepsi Optional (bkz.
                # SignalHistoryEntry) - üçü de olmadan bir karne satırının
                # kazanç/kayıp hesabı yapılamaz, eksikse atlanır.
                if entry.entry is None or entry.stop_loss is None or entry.take_profit is None:
                    continue
                fired_at = _as_utc(datetime.fromisoformat(entry.timestamp))
                if (entry.ticker, fired_at) in existing:
                    continue
                db.add(StrategySignal(
                    ticker=entry.ticker, direction=entry.direction,
                    entry_price=entry.entry, stop_price=entry.stop_loss,
                    target_price=entry.take_profit, confidence=entry.confidence,
                    fired_at=fired_at,
                ))
                written += 1
            if written:
                db.commit()
                logger.info(f"Signal tracking: recorded {written} new signal(s).")
        except Exception as e:
            db.rollback()
            logger.error(f"Signal tracking: record_new_signals failed: {e}")
        finally:
            db.close()

    def backfill_outcomes(self) -> None:
        """Açık (outcome IS NULL) sinyalleri güncel fiyatla karşılaştırıp
        stop/target'a değeni WIN/LOSS olarak, MAX_OPEN_DAYS'i aşanı EXPIRED
        olarak kapatır. Bu periyodik bir ÖRNEKLEME - stop ile target
        arasında kalan gerçek intraday dokunuşları (iki tarama arasında
        değip geri dönen bir fiyat hareketi) yakalamaz, tam bir tick-tick
        backtest değildir (uygulamanın geri kalanındaki tahmin/simülasyon
        disclaimer'larıyla aynı sınırlama, bkz. PortfolioStressTest)."""
        db: Session = SessionLocal()
        try:
            open_signals = db.query(StrategySignal).filter(StrategySignal.outcome.is_(None)).all()
            if not open_signals:
                return

            now = datetime.now(timezone.utc)
            resolved = 0
            for sig in open_signals:
                quote = market_data_service.get_quote(sig.ticker)
                price = quote.get("last") if quote else None
                if price is None:
                    continue

                outcome = None
                if sig.direction == "LONG":
                    if price >= sig.target_price:
                        outcome = "WIN"
                    elif price <= sig.stop_price:
                        outcome = "LOSS"
                else:  # SHORT
                    if price <= sig.target_price:
                        outcome = "WIN"
                    elif price >= sig.stop_price:
                        outcome = "LOSS"

                is_expired = outcome is None and (now - _as_utc(sig.fired_at)) > timedelta(days=MAX_OPEN_DAYS)
                if outcome is None and not is_expired:
                    continue

                sig.outcome = outcome or "EXPIRED"
                sig.resolved_at = now
                sign = 1 if sig.direction == "LONG" else -1
                sig.return_pct = round((price - sig.entry_price) / sig.entry_price * 100 * sign, 2)
                resolved += 1

            if resolved:
                db.commit()
                logger.info(f"Signal tracking: resolved {resolved} signal(s).")
        except Exception as e:
            db.rollback()
            logger.error(f"Signal tracking: backfill_outcomes failed: {e}")
        finally:
            db.close()

    def start_background_scheduler(self, interval_seconds: int = 300, startup_delay_seconds: int = 60):
        """StrategyEngine kendi taramasını her 180s'de bir yeniliyor (bkz.
        REFRESH_INTERVAL_SECONDS) - 300s'lik bu döngü her seferinde en az
        bir yeni tarama sonucunu yakalayacak kadar sık, ayrı bir zamanlama
        senkronizasyonuna gerek yok (dedup zaten idempotent)."""
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            while True:
                try:
                    self.record_new_signals()
                    self.backfill_outcomes()
                except Exception as e:
                    logger.error(f"Signal tracking scheduler loop error: {e}")
                time.sleep(interval_seconds)

        threading.Thread(target=loop, daemon=True).start()


signal_tracking_service = SignalTrackingService()
