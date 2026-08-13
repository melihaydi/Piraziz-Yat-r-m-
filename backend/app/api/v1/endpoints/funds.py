from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from sqlalchemy.orm import Session
from app.api import deps
from app.core.limiter import limiter
from app.core.redis import cache_service
from app.models.user import User
from app.services.tefas import tefas_service
from app.services.market_data import market_data_service
from app.models.fund_estimate_snapshot import FundEstimateSnapshot

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


# Funds shown in the "Popüler Fonlar - Anlık Getiri" section - deliberately
# a fixed short list (not every tracked fund) since building this estimate
# is itself a real cost (recursing through several live quote lookups per
# fund) and this section only ever asked for these four.
POPULAR_LIVE_FUNDS = ["TMV", "PBR", "DFI", "TLY"]


def _with_impact_pct(holdings: List[dict]) -> List[dict]:
    """Adds each holding's point contribution to the fund's overall estimate
    (weight/100 * its own change_pct) - the per-fund equivalent of what the
    Screener used to show per-stock. None when the holding wasn't resolvable
    (see get_live_estimated_return) rather than 0, so an unresolved holding
    never looks like it simply had no effect today."""
    out = []
    for h in holdings:
        impact = round(h["weight"] / 100 * h["change_pct"], 3) if h.get("change_pct") is not None else None
        out.append({**h, "impact_pct": impact})
    return out


@router.get("/popular/live-estimate")
@limiter.limit("120/minute")
def get_popular_funds_live_estimate(
    request: Request, current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Estimated INTRADAY % change for the "Popüler Fonlar" funds, computed
    from their last known holdings' live prices - see
    TefasService.get_live_estimated_return's docstring for exactly what this
    is and isn't (an estimate from disclosed composition x live prices, not
    a real intraday NAV recalculation; TEFAS itself only publishes one NAV
    per fund per day). Free/starter/pro tiers get this computed from
    15-minute-delayed stock quotes instead (see deps.get_data_delay_minutes).

    The computed result is cached server-side per delay tier: building it
    means walking every popular fund's holdings and recursively resolving
    sub-funds against live quotes, which is far too much work to redo for
    each viewer when every viewer on the same tier gets the identical
    answer. The delayed tier caches longer than the live one because its
    numbers are already quoted 15 minutes behind - another minute of cache
    age is invisible there, whereas a premium user is paying for immediacy."""
    cache_key = f"funds:popular:live-estimate:delay={delay}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    chg = _get_live_index_change()
    results = []
    for code in POPULAR_LIVE_FUNDS:
        fund = tefas_service.get_fund(code, chg)
        estimate = tefas_service.get_live_estimated_return(code, delay_minutes=delay)
        if not fund or not estimate:
            continue
        results.append({
            "code": code,
            "name": fund.get("name"),
            "price": fund.get("price"),
            "daily_return": fund.get("daily_return"),
            "fund_size": fund.get("fund_size"),
            "estimated_change_pct": estimate["estimated_change_pct"],
            "resolved_weight_pct": estimate["resolved_weight_pct"],
            "holdings": _with_impact_pct(estimate["holdings"]),
        })

    payload = {"funds": results}
    # Only cache a complete answer. A partial result (some fund's quote or
    # composition momentarily unresolvable, so it got skipped by the
    # `continue` above) would otherwise be frozen in place for everyone on
    # this tier for the full TTL, turning a one-off blip into a fund
    # visibly missing from the panel.
    if len(results) == len(POPULAR_LIVE_FUNDS):
        cache_service.set_json(cache_key, payload, expire_seconds=60 if delay > 0 else 15)
    return payload


@router.get("/popular/estimate-history")
def get_popular_funds_estimate_history(days: int = 30, db: Session = Depends(deps.get_db)):
    """Historical accuracy of the live estimate for the "Popüler Fonlar"
    funds: one row per (fund, day) with what get_live_estimated_return
    predicted (estimated_change_pct) alongside TEFAS's real published
    daily_return for that same day (actual_change_pct), captured together
    once daily - see FundEstimateSnapshotService. `days` caps how far back
    to look (default last 30 calendar days)."""
    cutoff = None
    if days > 0:
        from datetime import date, timedelta
        cutoff = date.today() - timedelta(days=days)

    query = db.query(FundEstimateSnapshot).filter(
        FundEstimateSnapshot.fund_code.in_(POPULAR_LIVE_FUNDS)
    )
    if cutoff:
        query = query.filter(FundEstimateSnapshot.snapshot_date >= cutoff)

    rows = query.order_by(
        FundEstimateSnapshot.snapshot_date.desc(), FundEstimateSnapshot.fund_code
    ).all()

    # Filters out any Saturday/Sunday rows recorded before the snapshot job
    # itself was fixed to skip weekends (see FundEstimateSnapshotService.
    # _run_snapshot) - TEFAS never publishes a real daily_return on those
    # days, so an old weekend row's actual_change_pct is just Friday's
    # figure repeated, not a real day-of comparison. Filtered here rather
    # than deleted from the table, so the raw history stays intact.
    rows = [r for r in rows if r.snapshot_date.weekday() < 5]

    return {
        "snapshots": [
            {
                "fund_code": r.fund_code,
                "date": r.snapshot_date.isoformat(),
                "estimated_change_pct": r.estimated_change_pct,
                "resolved_weight_pct": r.resolved_weight_pct,
                "actual_change_pct": r.actual_change_pct,
                "error_pct": (
                    round(r.estimated_change_pct - r.actual_change_pct, 2)
                    if r.estimated_change_pct is not None and r.actual_change_pct is not None
                    else None
                ),
            }
            for r in rows
        ]
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
