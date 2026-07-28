"""Real portfolio analytics: sector/asset-type allocation and genuine
Beta/Sharpe/volatility computed from actual historical daily returns.

This replaces a frontend implementation that was faking these numbers
entirely from asset *count* (`volatility = 18.4 + count*0.8`, `beta = 1.05
+ (count % 3)*0.05`) rather than any real price history - Beta/Sharpe are
now computed the standard way: weighted portfolio daily returns vs the
XU100 benchmark's daily returns over the same lookback window.
"""
import logging
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional

import pandas as pd
import borsapy

from app.services.sectors import get_sector
from app.services.tefas import tefas_service

logger = logging.getLogger(__name__)

LOOKBACK_PERIOD = "6mo"
MIN_RETURN_POINTS = 20
TRADING_DAYS_PER_YEAR = 252
FALLBACK_RISK_FREE_RATE = 0.35  # only used if borsapy.risk_free_rate() is unavailable


def _fetch_stock_returns(ticker: str, retries: int = 2) -> Optional[pd.Series]:
    """A couple of retries absorb the occasional transient "No data
    received" borsapy raises under concurrent load (several of these run
    at once here, plus market_data_service's own background subscriber
    thread sharing the same TradingView connection pool) - a single
    request-scoped retry is cheap and avoids the whole risk-metrics
    response bailing out over what's usually a one-off hiccup."""
    last_err: Optional[Exception] = None
    for attempt in range(retries + 1):
        try:
            df = borsapy.Ticker(ticker).history(period=LOOKBACK_PERIOD, interval="1d")
            if df is None or len(df) < MIN_RETURN_POINTS:
                return None
            returns = df["Close"].pct_change().dropna()
            returns.index = df.index[1:].date
            return returns
        except Exception as e:
            last_err = e
            if attempt < retries:
                continue
    logger.warning(f"Failed to fetch stock returns for {ticker}: {last_err}")
    return None


def _fetch_fund_returns(code: str) -> Optional[pd.Series]:
    try:
        import datetime as dt
        candles, is_simulated = tefas_service.get_fund_candles(code, count=130)
        # Simulated candles are synthetically generated (correlated with
        # XU100 as a placeholder, see tefas.py's _generate_synthetic_candles)
        # - including them would make Beta trivially ~1 for that holding,
        # not a real number. Excluded from the risk calc (still counted in
        # sector/type allocation, which only needs the holding's value).
        if is_simulated or not candles or len(candles) < MIN_RETURN_POINTS:
            return None
        # Date-indexed (not the default positional index) so this aligns
        # correctly against stocks' date-indexed returns below - a fund's
        # trading calendar (TEFAS NAV days) doesn't line up 1:1 with BIST's,
        # so combining them via position instead of date would silently
        # misalign every row.
        dates = [dt.date.fromtimestamp(c["time"]) for c in candles]
        closes = pd.Series([c["close"] for c in candles], index=dates)
        returns = closes.pct_change().dropna()
        return returns
    except Exception as e:
        logger.warning(f"Failed to fetch fund returns for {code}: {e}")
        return None


def _pct_breakdown(totals: Dict[str, float], total_value: float) -> List[Dict[str, Any]]:
    if total_value <= 0:
        return []
    rows = [
        {"name": name, "value": round(value, 2), "percentage": round(value / total_value * 100, 1)}
        for name, value in totals.items() if value > 0
    ]
    rows.sort(key=lambda r: -r["percentage"])
    return rows


def _compute_allocation(assets: List[Dict[str, Any]], total_value: float) -> Dict[str, Any]:
    sector_totals: Dict[str, float] = {}
    type_totals = {"Hisse Senedi": 0.0, "Yatırım Fonu": 0.0}
    for a in assets:
        ticker = a["ticker"].upper()
        is_fund = len(ticker) == 3
        type_totals["Yatırım Fonu" if is_fund else "Hisse Senedi"] += a["total_value"]
        sector_name = "Yatırım Fonları" if is_fund else get_sector(ticker)
        sector_totals[sector_name] = sector_totals.get(sector_name, 0.0) + a["total_value"]

    return {
        "sector_breakdown": _pct_breakdown(sector_totals, total_value),
        "asset_type_breakdown": _pct_breakdown(type_totals, total_value),
    }


def _compute_risk_metrics(assets: List[Dict[str, Any]], total_value: float) -> Dict[str, Any]:
    empty = {
        "beta": None, "sharpe": None, "volatility_pct": None,
        "annualized_return_pct": None, "risk_free_rate_pct": None,
        "risk_metrics_note": None,
    }
    if total_value <= 0 or not assets:
        return {**empty, "risk_metrics_note": "Portföyde varlık bulunmuyor."}

    tickers = [a["ticker"].upper() for a in assets]
    weights = {a["ticker"].upper(): a["total_value"] / total_value for a in assets}
    stock_tickers = [t for t in tickers if len(t) != 3]
    fund_tickers = [t for t in tickers if len(t) == 3]

    results: Dict[str, Optional[pd.Series]] = {}
    with ThreadPoolExecutor(max_workers=min(len(tickers) + 1, 8)) as pool:
        futures = {}
        for t in stock_tickers:
            futures[pool.submit(_fetch_stock_returns, t)] = t
        for t in fund_tickers:
            futures[pool.submit(_fetch_fund_returns, t)] = t
        futures[pool.submit(_fetch_stock_returns, "XU100")] = "__BENCHMARK__"
        for fut, key in futures.items():
            results[key] = fut.result()

    benchmark_returns = results.pop("__BENCHMARK__", None)
    included = {t: r for t, r in results.items() if r is not None}
    excluded = [t for t in tickers if t not in included]

    if not included:
        return {**empty, "risk_metrics_note": "Yeterli geçmiş fiyat verisi bulunamadığından risk metrikleri hesaplanamadı."}

    returns_df = pd.DataFrame(included)
    included_weight_sum = sum(weights[t] for t in included)
    portfolio_returns = sum(
        returns_df[t].fillna(0.0) * (weights[t] / included_weight_sum) for t in included
    )

    # Sharpe/volatility/return only need the portfolio's own return series -
    # computed unconditionally below. Beta additionally needs the XU100
    # benchmark aligned on shared dates, so it's computed separately and
    # degrades to null on its own (rather than a benchmark hiccup blanking
    # out every other metric too, which is what taking the whole thing from
    # a single `dropna()`'d portfolio+benchmark frame used to do).
    annualized_return = portfolio_returns.mean() * TRADING_DAYS_PER_YEAR
    annualized_volatility = portfolio_returns.std() * (TRADING_DAYS_PER_YEAR ** 0.5)

    try:
        risk_free_rate = borsapy.risk_free_rate() or FALLBACK_RISK_FREE_RATE
    except Exception:
        risk_free_rate = FALLBACK_RISK_FREE_RATE

    sharpe = (annualized_return - risk_free_rate) / annualized_volatility if annualized_volatility > 0 else None

    beta = None
    if benchmark_returns is not None:
        aligned = pd.DataFrame({"portfolio": portfolio_returns, "benchmark": benchmark_returns}).dropna()
        if len(aligned) >= 15:
            benchmark_variance = aligned["benchmark"].var()
            if benchmark_variance > 0:
                beta = aligned["portfolio"].cov(aligned["benchmark"]) / benchmark_variance

    notes = []
    if excluded:
        notes.append(f"{', '.join(excluded)} için yeterli geçmiş veri bulunamadığından risk hesabına dahil edilmedi.")
    if beta is None:
        notes.append("BIST100 karşılaştırma verisi alınamadığından Beta hesaplanamadı.")

    return {
        "beta": round(float(beta), 2) if beta is not None else None,
        "sharpe": round(float(sharpe), 2) if sharpe is not None else None,
        "volatility_pct": round(float(annualized_volatility) * 100, 1) if annualized_volatility else None,
        "annualized_return_pct": round(float(annualized_return) * 100, 1),
        "risk_free_rate_pct": round(risk_free_rate * 100, 1),
        "risk_metrics_note": " ".join(notes) if notes else None,
    }


def compute_portfolio_analytics(assets: List[Dict[str, Any]]) -> Dict[str, Any]:
    """assets: list of {"ticker": str, "total_value": float}."""
    total_value = sum(a["total_value"] for a in assets)
    return {
        **_compute_allocation(assets, total_value),
        **_compute_risk_metrics(assets, total_value),
    }
