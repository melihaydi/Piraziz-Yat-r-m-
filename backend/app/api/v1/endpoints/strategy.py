from dataclasses import asdict
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Request, status

from app.api import deps
from app.core.limiter import limiter
from app.models.user import User
from app.services.strategy_engine import strategy_engine, backtest_engine
from app.services.market_data import market_data_service

router = APIRouter(dependencies=[Depends(deps.get_current_premium_user)])


def _enrich_with_live_pnl(signal_dict: dict) -> dict:
    """Adds `live_price` and `captured_pnl_pct` to a signal dict WITHOUT
    touching StrategyEngine's own scan/Signal computation at all - purely
    additive, fetched fresh from market_data_service on every request, since
    the scan itself only refreshes every REFRESH_INTERVAL_SECONDS (3 min) so
    its own `price` field can lag a live quote by that much.
    captured_pnl_pct is the live price's move from `entry` in the signal's
    own favor (positive for a LONG that's risen, or a SHORT that's fallen),
    as a percentage. Deliberately % only, not a ₺ amount - the scanner has
    no real position size, so a raw ₺-per-share delta (e.g. "₺0.03") reads
    as a meaningless number rather than useful P&L."""
    ticker = signal_dict.get("ticker", "")
    quote = market_data_service.get_quote(ticker) if market_data_service.is_known_ticker(ticker) else None
    live_price = quote.get("last") if quote else None
    signal_dict["live_price"] = live_price

    entry = signal_dict.get("entry")
    direction = signal_dict.get("direction")
    pnl_pct = None
    if live_price is not None and entry:
        if direction == "LONG":
            pnl_pct = (live_price - entry) / entry * 100
        elif direction == "SHORT":
            pnl_pct = (entry - live_price) / entry * 100
    signal_dict["captured_pnl_pct"] = round(pnl_pct, 2) if pnl_pct is not None else None
    return signal_dict


@router.get("/scan")
@limiter.limit("30/minute")
def scan_bist30(
    request: Request,
    current_user: User = Depends(deps.get_current_user),
):
    """Frantic Algoritmik Strateji's live BIST30 scanner - serves the
    background-refreshed signal cache (see StrategyEngine.REFRESH_INTERVAL_SECONDS),
    not a per-request recompute, so this stays fast regardless of how often
    the dashboard polls it. Each signal is enriched with a live price +
    running %P&L on top of that cache (see _enrich_with_live_pnl)."""
    signals = strategy_engine.scan_now()
    return {
        "last_update": strategy_engine.get_last_run(),
        "signals": [_enrich_with_live_pnl(asdict(s)) for s in signals],
    }


@router.get("/history")
@limiter.limit("60/minute")
def signal_history(
    request: Request,
    current_user: User = Depends(deps.get_current_user),
):
    """Intraday log of LONG/SHORT calls the scanner has made today - each
    entry is recorded once, when a symbol's direction first changes into
    LONG or SHORT (see StrategyEngine._run_scan), not repeated on every
    3-minute rescan while it stays active. Resets at the start of each new
    day. Each entry is enriched with a live price + running P&L on top of
    the historical snapshot (same as /scan) - previously only the current
    signals list had this, so the history tab could only show the price
    AT the moment the call fired, never how it's done since."""
    history = strategy_engine.get_signal_history()
    return {
        "last_update": strategy_engine.get_last_run(),
        "history": [_enrich_with_live_pnl(asdict(h)) for h in history],
    }


@router.get("/scan/{ticker}")
@limiter.limit("30/minute")
def scan_one(
    request: Request,
    ticker: str,
    current_user: User = Depends(deps.get_current_user),
):
    signals = strategy_engine.scan_now()
    match = next((s for s in signals if s.ticker == ticker.upper()), None)
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sembol bulunamadı.")
    return _enrich_with_live_pnl(asdict(match))


@router.get("/backtest")
@limiter.limit("10/minute")
def backtest_bist30(
    request: Request,
    current_user: User = Depends(deps.get_current_user),
):
    """Walk-forward backtest of the same signal logic over ~2 years of
    history for every BIST30 symbol - serves the background-refreshed cache
    (see BacktestEngine.REFRESH_INTERVAL_SECONDS, once/day). Never blocks:
    the first call after a cold backend start kicks off the computation in
    the background and returns immediately with computing=true; the
    frontend polls until it flips to false."""
    results = backtest_engine.get_results()
    return {
        "last_update": backtest_engine.get_last_run(),
        "computing": backtest_engine.is_running(),
        "results": [asdict(r) for r in results],
    }


@router.get("/backtest/{ticker}")
@limiter.limit("10/minute")
def backtest_one(
    request: Request,
    ticker: str,
    current_user: User = Depends(deps.get_current_user),
):
    results = backtest_engine.get_results()
    match = next((r for r in results if r.ticker == ticker.upper()), None)
    if not match:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sembol bulunamadı.")
    return asdict(match)
