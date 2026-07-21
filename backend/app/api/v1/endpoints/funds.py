from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Response, status
from app.services.tefas import tefas_service
from app.services.market_data import market_data_service

router = APIRouter()

def _get_live_index_change() -> float:
    """Helper to get current XU100 daily change for dynamic fund price scaling."""
    quote = market_data_service.get_quote("XU100")
    return quote.get("change_percent") if (quote and quote.get("change_percent") is not None) else 0.64

@router.get("/")
def list_funds():
    """Get all TEFAS mutual funds with daily return scaling."""
    chg = _get_live_index_change()
    return tefas_service.get_funds(chg)

@router.get("/{code}")
def get_fund_detail(code: str):
    """Get details of a single TEFAS mutual fund."""
    chg = _get_live_index_change()
    fund = tefas_service.get_fund(code, chg)
    if not fund:
        raise HTTPException(status_code=404, detail="Fund not found")
    return fund

@router.get("/chart/{code}")
def get_fund_candles(code: str, response: Response, count: int = 30):
    """Get historical price candle array for a mutual fund (real TEFAS NAV history when available)."""
    chg = _get_live_index_change()
    candles, is_simulated = tefas_service.get_fund_candles(code, count, chg)
    if not candles:
        raise HTTPException(status_code=404, detail="Fund candles not found")
    response.headers["X-Chart-Simulated"] = "true" if is_simulated else "false"
    return candles
