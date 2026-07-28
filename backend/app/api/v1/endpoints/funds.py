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


def _period_return_pct(closes: List[float], bars: int) -> Optional[float]:
    if len(closes) < 2:
        return None
    start = closes[-1 - bars] if len(closes) > bars else closes[0]
    if start == 0:
        return None
    return round((closes[-1] / start - 1) * 100, 2)


def _fund_comparison_stats(candles: List[dict]) -> dict:
    closes = [c["close"] for c in candles if c.get("close") is not None]
    if len(closes) < 2:
        return {"return_1m_pct": None, "return_3m_pct": None, "return_1y_pct": None, "volatility_pct": None}

    daily_returns = [(closes[i] / closes[i - 1] - 1) for i in range(1, len(closes)) if closes[i - 1] != 0]
    volatility_pct = None
    if len(daily_returns) >= 5:
        mean = sum(daily_returns) / len(daily_returns)
        variance = sum((r - mean) ** 2 for r in daily_returns) / len(daily_returns)
        volatility_pct = round((variance ** 0.5) * (252 ** 0.5) * 100, 1)

    return {
        "return_1m_pct": _period_return_pct(closes, 21),
        "return_3m_pct": _period_return_pct(closes, 63),
        "return_1y_pct": _period_return_pct(closes, 252),
        "volatility_pct": volatility_pct,
    }


@router.get("/compare")
def compare_funds(codes: str):
    """Side-by-side comparison of 2-5 TEFAS funds: latest price, 1mo/3mo/1yr
    return and annualized volatility, plus each fund's own candle series so
    the frontend can plot them overlaid (normalized to % change from a
    common start date, since NAVs aren't on the same price scale). Must be
    registered before GET /{code} below - otherwise FastAPI would match
    "compare" as a fund code and this route would never be reached."""
    fund_codes = [c.strip().upper() for c in codes.split(",") if c.strip()]
    fund_codes = list(dict.fromkeys(fund_codes))[:5]  # de-dup, cap at 5
    if len(fund_codes) < 2:
        raise HTTPException(status_code=400, detail="Karşılaştırma için en az 2 fon kodu gerekli.")

    chg = _get_live_index_change()
    results = []
    for code in fund_codes:
        fund = tefas_service.get_fund(code, chg)
        if not fund:
            continue
        candles, is_simulated = tefas_service.get_fund_candles(code, count=252, index_change_pct=chg)
        results.append({
            "code": code,
            "name": fund.get("name"),
            "price": fund.get("price"),
            "daily_return": fund.get("daily_return"),
            "category": fund.get("category"),
            "is_simulated": is_simulated,
            "candles": [{"time": c["time"], "close": c["close"]} for c in candles],
            **_fund_comparison_stats(candles),
        })

    if len(results) < 2:
        raise HTTPException(status_code=404, detail="Girilen fon kodlarından en az ikisi bulunamadı.")

    return {"funds": results}


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
