from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status

from app.api import deps
from app.models.user import User
from app.services.strategy_engine import strategy_engine

router = APIRouter()


@router.get("/scan")
def scan_bist30(
    current_user: User = Depends(deps.get_current_user),
):
    """Frantic Algoritmik Strateji's live BIST30 scanner - serves the
    background-refreshed signal cache (see StrategyEngine.REFRESH_INTERVAL_SECONDS),
    not a per-request recompute, so this stays fast regardless of how often
    the dashboard polls it."""
    signals = strategy_engine.scan_now()
    return {
        "last_update": strategy_engine.get_last_run(),
        "signals": [asdict(s) for s in signals],
    }


@router.get("/scan/{ticker}")
def scan_one(
    ticker: str,
    current_user: User = Depends(deps.get_current_user),
):
    signals = strategy_engine.scan_now()
    match = next((s for s in signals if s.ticker == ticker.upper()), None)
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sembol bulunamadı.")
    return asdict(match)
