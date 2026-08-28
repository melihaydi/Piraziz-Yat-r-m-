from datetime import datetime, timedelta, timezone

from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.limiter import limiter
from app.models.strategy_signal import StrategySignal

router = APIRouter()

# Karne son 90 günün KAPANMIŞ sinyallerine bakıyor - kayan bir pencere,
# sonsuza kadar birikmiş eski sinyallerle sulandırılmıyor.
_LOOKBACK_DAYS = 90


@router.get("/")
@limiter.limit("60/minute")
def get_scorecard(request: Request, db: Session = Depends(deps.get_db)):
    """"Sinyal Karnesi" - Frantic Algoritmik Strateji'nin taradığı HER LONG/
    SHORT çağrısının gerçek sonucu, kimlik doğrulama gerektirmeden herkese
    açık. Bilinçli olarak SADECE kapanmış (outcome dolu) sinyallerin özet
    istatistiğini gösterir - açık pozisyonların giriş/stop/hedef detayı
    burada YOK, o /strategy/scan'in premium ürünü (bkz. strategy.py). Bu
    "radikal dürüstlük" sayfası: kazanan da kaybeden de aynı şekilde
    sayılıyor, seçilmiş bir vitrin değil.
    """
    cutoff = datetime.now(timezone.utc) - timedelta(days=_LOOKBACK_DAYS)
    closed = (
        db.query(StrategySignal)
        .filter(StrategySignal.outcome.isnot(None))
        .filter(StrategySignal.fired_at >= cutoff)
        .all()
    )

    open_count = db.query(StrategySignal).filter(StrategySignal.outcome.is_(None)).count()

    if not closed:
        return {
            "window_days": _LOOKBACK_DAYS,
            "total_signals": 0,
            "win_rate": None,
            "avg_win_pct": None,
            "avg_loss_pct": None,
            "avg_return_pct": None,
            "best": None,
            "worst": None,
            "open_signals_count": open_count,
        }

    wins = [s for s in closed if s.outcome == "WIN"]
    losses = [s for s in closed if s.outcome == "LOSS"]
    # EXPIRED sinyaller win_rate'in paydasında sayılır (gerçekten oldu,
    # gizlenmiyor) ama ne kazanç ne kayıp ortalamasına dahil edilir - "ne
    # kazandırdı ne kaybettirdi" diye ayrı bir kova, ikisinin ortalamasını da
    # bozmadan.
    decided = wins + losses

    def _row(sig: StrategySignal) -> dict:
        return {
            "ticker": sig.ticker,
            "direction": sig.direction,
            "outcome": sig.outcome,
            "return_pct": sig.return_pct,
            "fired_at": sig.fired_at.isoformat() if sig.fired_at else None,
            "resolved_at": sig.resolved_at.isoformat() if sig.resolved_at else None,
        }

    best = max(closed, key=lambda s: s.return_pct if s.return_pct is not None else float("-inf"))
    worst = min(closed, key=lambda s: s.return_pct if s.return_pct is not None else float("inf"))

    return {
        "window_days": _LOOKBACK_DAYS,
        "total_signals": len(closed),
        "win_rate": round(len(wins) / len(decided) * 100, 2) if decided else None,
        "avg_win_pct": round(sum(s.return_pct for s in wins) / len(wins), 2) if wins else None,
        "avg_loss_pct": round(sum(s.return_pct for s in losses) / len(losses), 2) if losses else None,
        "avg_return_pct": round(sum(s.return_pct for s in closed if s.return_pct is not None) / len(closed), 2),
        "best": _row(best),
        "worst": _row(worst),
        "open_signals_count": open_count,
    }
