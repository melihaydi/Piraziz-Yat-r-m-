import logging
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import SessionLocal
from app.models.user import User
from app.models.portfolio import Portfolio, PortfolioAsset
from app.schemas.portfolio import PortfolioCreate, PortfolioResponse, PortfolioAssetCreate, PortfolioAssetResponse
from app.services.market_data import market_data_service
from app.services.tefas import tefas_service
from app.services.portfolio_analytics import compute_portfolio_analytics
from app.core.redis import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()

def _fetch_live_price(ticker: str) -> Optional[float]:
    """Fetch a single ticker's live price - a fund NAV (3-char codes) or a
    BIST stock quote. Split out of calculate_asset_metrics so callers with
    several assets (get_user_portfolios) can fetch them all concurrently
    instead of one blocking network/cache call per asset in sequence."""
    ticker = ticker.upper()
    if len(ticker) == 3:
        fund = tefas_service.get_fund(ticker)
        return fund["price"] if fund else None
    quote = market_data_service.get_quote(ticker)
    return quote.get("last") if quote else None

def calculate_asset_metrics(asset: PortfolioAsset, live_price: Optional[float] = None) -> dict:
    """Helper to compute real-time value and profit metrics for an asset.
    Pass a pre-fetched `live_price` (see _fetch_live_price) to skip the
    network/cache lookup this would otherwise do itself."""
    if live_price is None:
        live_price = _fetch_live_price(asset.ticker)

    if live_price is None or live_price == 0:
        live_price = asset.average_cost

    cost_value = asset.shares * asset.average_cost
    current_value = asset.shares * live_price
    profit = current_value - cost_value
    profit_pct = (profit / cost_value * 100) if cost_value > 0 else 0.0

    return {
        "id": asset.id,
        "portfolio_id": asset.portfolio_id,
        "ticker": asset.ticker,
        "shares": asset.shares,
        "average_cost": asset.average_cost,
        "current_price": live_price,
        "total_value": current_value,
        "total_profit": profit,
        "profit_percentage": profit_pct,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }

@router.get("/", response_model=List[PortfolioResponse])
def get_user_portfolios(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Retrieve all portfolios for the current user, calculating real-time valuations."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()

    # Fetch every distinct ticker's live price once, concurrently, instead of
    # once per asset in sequence across every portfolio (each lookup is a
    # blocking TEFAS/market-data call).
    all_tickers = sorted({asset.ticker.upper() for p in portfolios for asset in p.assets})
    price_by_ticker = {}
    if all_tickers:
        with ThreadPoolExecutor(max_workers=min(len(all_tickers), 8)) as pool:
            for ticker, price in zip(all_tickers, pool.map(_fetch_live_price, all_tickers)):
                price_by_ticker[ticker] = price

    response_list = []
    for p in portfolios:
        assets_responses = []
        total_cost = 0.0
        total_value = 0.0

        for asset in p.assets:
            metrics = calculate_asset_metrics(asset, live_price=price_by_ticker.get(asset.ticker.upper()))
            assets_responses.append(PortfolioAssetResponse(**metrics))
            
            total_cost += asset.shares * asset.average_cost
            total_value += metrics["total_value"]

        total_profit = total_value - total_cost
        profit_pct = (total_profit / total_cost * 100) if total_cost > 0 else 0.0

        p_dict = {
            "id": p.id,
            "user_id": p.user_id,
            "name": p.name,
            "assets": assets_responses,
            "total_cost": total_cost,
            "total_value": total_value,
            "total_profit": total_profit,
            "profit_percentage": profit_pct,
            "created_at": p.created_at,
            "updated_at": p.updated_at
        }
        response_list.append(PortfolioResponse(**p_dict))

    return response_list

# Redis-backed cache for /analytics, keyed by (user_id, holdings composition) -
# not by live-priced total_value, since that changes on every quote tick and
# would defeat caching entirely. Beta/Sharpe/volatility come from historical
# daily closes and don't meaningfully change within minutes, so a real
# composition change (buy/sell/add) invalidates the cache immediately (new
# key), while repeat visits with the same holdings hit cache instead of
# re-fetching 6mo history per ticker from TradingView every time - that
# network round-trip was the actual cause of "Portföyüm" taking many
# seconds to render every single time it was opened. Backed by Redis (not
# process memory) so it survives backend restarts/redeploys and stays
# consistent across multiple backend instances.
_ANALYTICS_CACHE_TTL_SECONDS = 900


@router.get("/analytics")
def get_portfolio_analytics(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Real sector/asset-type allocation and genuine Beta/Sharpe/volatility
    computed from historical returns (see portfolio_analytics.py) - across
    every portfolio the user owns, combined into one allocation view."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    all_assets = [asset for p in portfolios for asset in p.assets]

    if not all_assets:
        return {
            "sector_breakdown": [], "asset_type_breakdown": [],
            "beta": None, "sharpe": None, "volatility_pct": None,
            "annualized_return_pct": None, "risk_free_rate_pct": None,
            "risk_metrics_note": "Portföyünüzde henüz varlık bulunmuyor.",
        }

    composition = sorted((a.ticker.upper(), round(a.shares, 4)) for a in all_assets)
    composition_key = "|".join(f"{ticker}:{shares}" for ticker, shares in composition)
    cache_key = f"portfolio_analytics:{current_user.id}:{composition_key}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    tickers = sorted({a.ticker.upper() for a in all_assets})
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        price_by_ticker = dict(zip(tickers, pool.map(_fetch_live_price, tickers)))

    asset_values = []
    for a in all_assets:
        price = price_by_ticker.get(a.ticker.upper()) or a.average_cost
        asset_values.append({"ticker": a.ticker.upper(), "total_value": a.shares * price})

    result = compute_portfolio_analytics(asset_values)
    cache_service.set_json(cache_key, result, expire_seconds=_ANALYTICS_CACHE_TTL_SECONDS)
    return result


@router.post("/", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
def create_portfolio(
    portfolio_in: PortfolioCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new portfolio."""
    db_portfolio = Portfolio(name=portfolio_in.name, user_id=current_user.id)
    db.add(db_portfolio)
    db.commit()
    db.refresh(db_portfolio)
    
    # Return empty response shell
    return PortfolioResponse(
        id=db_portfolio.id,
        user_id=db_portfolio.user_id,
        name=db_portfolio.name,
        assets=[],
        total_cost=0.0,
        total_value=0.0,
        total_profit=0.0,
        profit_percentage=0.0,
        created_at=db_portfolio.created_at,
        updated_at=db_portfolio.updated_at
    )

@router.post("/{id}/assets", response_model=PortfolioAssetResponse, status_code=status.HTTP_201_CREATED)
def add_asset_to_portfolio(
    id: int,
    asset_in: PortfolioAssetCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Add a stock asset to the portfolio or recalculate weighted cost if it already exists."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    ticker_upper = asset_in.ticker.upper()
    existing_asset = db.query(PortfolioAsset).filter(
        PortfolioAsset.portfolio_id == id, 
        PortfolioAsset.ticker == ticker_upper
    ).first()

    if existing_asset:
        # Calculate weighted average cost
        total_shares = existing_asset.shares + asset_in.shares
        if total_shares > 0:
            weighted_cost = (
                (existing_asset.shares * existing_asset.average_cost) + 
                (asset_in.shares * asset_in.average_cost)
            ) / total_shares
            existing_asset.average_cost = weighted_cost
            existing_asset.shares = total_shares
        
        db.commit()
        db.refresh(existing_asset)
        asset_obj = existing_asset
    else:
        # Create new asset
        db_asset = PortfolioAsset(
            portfolio_id=id,
            ticker=ticker_upper,
            shares=asset_in.shares,
            average_cost=asset_in.average_cost
        )
        db.add(db_asset)
        db.commit()
        db.refresh(db_asset)
        asset_obj = db_asset

    metrics = calculate_asset_metrics(asset_obj)
    return PortfolioAssetResponse(**metrics)

@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_asset_from_portfolio(
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Remove an asset from portfolio."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    db.delete(asset)
    db.commit()
    return None

from pydantic import BaseModel

class AssetUpdate(BaseModel):
    shares: float
    average_cost: float

class AssetSell(BaseModel):
    shares: float

@router.put("/assets/{asset_id}", response_model=PortfolioAssetResponse)
def update_portfolio_asset(
    asset_id: int,
    asset_in: AssetUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update asset lot quantity and average cost."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    asset.shares = asset_in.shares
    asset.average_cost = asset_in.average_cost
    db.commit()
    db.refresh(asset)

    metrics = calculate_asset_metrics(asset)
    return PortfolioAssetResponse(**metrics)

@router.post("/assets/{asset_id}/sell", response_model=Optional[PortfolioAssetResponse])
def sell_portfolio_asset(
    asset_id: int,
    sell_in: AssetSell,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Sell a partial or complete amount of shares. Deletes asset if remaining shares <= 0."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    if sell_in.shares >= asset.shares:
        # Sell entire lot
        db.delete(asset)
        db.commit()
        return None
    else:
        # Partial sell
        asset.shares -= sell_in.shares
        db.commit()
        db.refresh(asset)
        metrics = calculate_asset_metrics(asset)
        return PortfolioAssetResponse(**metrics)

# The Header component polls this every 15s, on every page, for every
# logged-in user (it's a global "AL/SAT" notification badge, not the
# primary trading view) - and each call runs a full 11-indicator technical
# analysis (SMA/EMA/RSI/MACD/VWAP/Supertrend/ATR/ADX) per ticker, falling
# back to a fresh borsapy history() network fetch for any ticker not
# already in the live-stream cache. Without caching, that repeats the same
# computation from scratch every 15s indefinitely for the same holdings -
# a real, constant background load contributing to overall app sluggishness.
# Daily-bar-based indicators don't meaningfully change within a couple of
# minutes, so this is cached per (user, holdings) like /analytics, and for
# the same reason lives in Redis rather than process memory.
_SIGNALS_CACHE_TTL_SECONDS = 120


@router.get("/signals")
def get_portfolio_signals(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Generate technical analysis buy/sell alerts for portfolio assets."""
    from datetime import datetime
    assets = db.query(PortfolioAsset).join(Portfolio).filter(
        Portfolio.user_id == current_user.id
    ).all()

    # If the user has no assets, provide signals for BIST 30 popular stocks
    symbols_to_check = [asset.ticker for asset in assets]
    is_fallback = False
    if not symbols_to_check:
        symbols_to_check = ["THYAO", "EREGL", "TUPRS", "BIMAS", "ODINE"]
        is_fallback = True

    symbols_key = "|".join(sorted(t.upper() for t in symbols_to_check))
    cache_key = f"portfolio_signals:{current_user.id}:{symbols_key}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    signals = []
    from app.services.technical_analysis import TechnicalAnalysisService

    def _fetch_signal_candles(ticker: str):
        """
        Get daily OHLCV history for indicator calculation. First checks the
        shared live-stream cache (instant, subscribe=False so it never steals
        the single shared chart session that Hisseler/Fon pages rely on - see
        the SPECIAL_EXCHANGES / patched_subscribe_chart notes in
        market_data.py for why that session is exclusive).

        Previously this was the ONLY source, so any ticker whose 1d chart
        hadn't already been opened elsewhere in the app came back empty -
        which is why the Frantic Strateji panel kept showing "Yetersiz
        geçmiş veri" for tickers nobody had happened to chart yet. Now, if
        the cache is empty, it falls back to borsapy's one-shot get_history
        (Ticker(...).history()), which opens its OWN independent TradingView
        WebSocket session and closes it when done - safe to call concurrently
        for several tickers without disturbing anyone's live chart.
        """
        candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False)
        if candles and len(candles) >= 20:
            return ticker, candles

        try:
            import borsapy
            hist_df = borsapy.Ticker(ticker).history(period="1y", interval="1d")
            if hist_df is not None and not hist_df.empty:
                built = []
                for idx, row in hist_df.iterrows():
                    vol = row.get("Volume", 0.0)
                    built.append({
                        "time": int(idx.timestamp()),
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": float(vol) if vol == vol else 0.0,  # NaN-safe
                    })
                if built:
                    return ticker, built
        except Exception as hist_err:
            logger.warning(f"borsapy history fallback failed for {ticker}: {hist_err}")

        return ticker, candles or []

    # Fetch every ticker's candles concurrently (each history() call is an
    # independent WS session) instead of one-by-one, so worst case is a single
    # symbol's timeout rather than N stacked timeouts.
    stock_tickers = [t.upper() for t in symbols_to_check if len(t.upper()) != 3]
    candles_by_ticker = {}
    if stock_tickers:
        with ThreadPoolExecutor(max_workers=min(len(stock_tickers), 5)) as pool:
            for ticker, candles in pool.map(_fetch_signal_candles, stock_tickers):
                candles_by_ticker[ticker] = candles

    for ticker in symbols_to_check:
        ticker = ticker.upper()
        if len(ticker) == 3:  # Skip funds (3 chars)
            continue

        candles = candles_by_ticker.get(ticker, [])
        if not candles or len(candles) < 20:
            signals.append({
                "ticker": ticker,
                "price": 0.0,
                "sma20": 0.0,
                "signal": "Takip Et",
                "description": "Yetersiz geçmiş veri nedeniyle teknik sinyal üretilemedi.",
                "color": "zinc",
                "timestamp": datetime.now().strftime("%H:%M:%S")
            })
            continue

        closes = [float(c["close"]) for c in candles]
        highs = [float(c["high"]) for c in candles]
        lows = [float(c["low"]) for c in candles]
        opens = [float(c["open"]) for c in candles]
        volumes = [float(c["volume"]) for c in candles]
        
        curr = closes[-1]
        
        # Calculate moving averages
        sma20_list = TechnicalAnalysisService.calculate_sma(closes, 20)
        ema20_list = TechnicalAnalysisService.calculate_ema(closes, 20)
        ema50_list = TechnicalAnalysisService.calculate_ema(closes, 50)
        ema200_list = TechnicalAnalysisService.calculate_ema(closes, 200) if len(closes) >= 200 else TechnicalAnalysisService.calculate_ema(closes, 50)
        
        sma20 = sma20_list[-1] if sma20_list else curr
        ema20 = ema20_list[-1] if ema20_list else curr
        ema50 = ema50_list[-1] if ema50_list else curr
        ema200 = ema200_list[-1] if ema200_list else curr
        
        # Calculate RSI
        rsi_list = TechnicalAnalysisService.calculate_rsi(closes, 14)
        rsi = rsi_list[-1] if rsi_list and rsi_list[-1] is not None else 50.0
        
        # Calculate MACD
        macd_line, sig_line, _ = TechnicalAnalysisService.calculate_macd(closes)
        macd_val = macd_line[-1] if macd_line and macd_line[-1] is not None else 0.0
        sig_val = sig_line[-1] if sig_line and sig_line[-1] is not None else 0.0
        
        # Calculate VWAP
        vwap_list = TechnicalAnalysisService.calculate_vwap(highs, lows, closes, volumes)
        vwap = vwap_list[-1] if vwap_list and vwap_list[-1] is not None else curr
        
        # Calculate Supertrend
        st_line, st_signals = TechnicalAnalysisService.calculate_supertrend(highs, lows, closes)
        st_signal = st_signals[-1] if st_signals else "Takip Et"
        
        # Calculate ATR & ADX
        atr_list = TechnicalAnalysisService.calculate_atr(highs, lows, closes, 14)
        atr = atr_list[-1] if atr_list and atr_list[-1] is not None else 1.0
        adx_list = TechnicalAnalysisService.calculate_adx(highs, lows, closes, 14)
        adx = adx_list[-1] if adx_list and adx_list[-1] is not None else 25.0
        
        # 11 Indicators Scoring
        buy_score = 0
        sell_score = 0
        
        # 1. SMA20
        if curr > sma20: buy_score += 1
        else: sell_score += 1
        
        # 2. EMA20
        if curr > ema20: buy_score += 1
        else: sell_score += 1
        
        # 3. EMA50
        if curr > ema50: buy_score += 1
        else: sell_score += 1
        
        # 4. EMA200
        if curr > ema200: buy_score += 1
        else: sell_score += 1
        
        # 5. RSI
        if rsi < 30: buy_score += 2
        elif rsi < 45: buy_score += 1
        elif rsi > 70: sell_score += 2
        elif rsi > 55: sell_score += 1
        
        # 6. MACD
        if macd_val > sig_val: buy_score += 1
        else: sell_score += 1
        
        # 7. Volume Spike
        avg_vol_10 = sum(volumes[-10:]) / 10.0 if len(volumes) >= 10 else 1.0
        if volumes[-1] > (1.8 * avg_vol_10):
            if curr > opens[-1]: buy_score += 1
            else: sell_score += 1
            
        # 8. VWAP
        if curr > vwap: buy_score += 1
        else: sell_score += 1
        
        # 9. Supertrend
        if st_signal == "AL": buy_score += 1
        elif st_signal == "SAT": sell_score += 1
        
        # 10. ATR (Volatility confirmation)
        vol_ratio = atr / curr if curr > 0 else 0
        if vol_ratio < 0.02 and curr > sma20:
            buy_score += 1
        elif vol_ratio > 0.04 and curr < sma20:
            sell_score += 1
            
        # 11. ADX (Trend strength)
        if adx > 25:
            if curr > ema50: buy_score += 1
            else: sell_score += 1

        # Map scores to output
        if buy_score >= 8:
            sig = "Güçlü AL"
            color = "emerald"
        elif buy_score >= 5:
            sig = "AL"
            color = "green"
        elif sell_score >= 8:
            sig = "Güçlü SAT"
            color = "rose"
        elif sell_score >= 5:
            sig = "SAT"
            color = "orange"
        else:
            sig = "Takip Et"
            color = "zinc"
            
        # Build dynamic details description
        total_ind = buy_score + sell_score
        desc = f"11 indikatörün {buy_score}'i AL, {sell_score}'si SAT yönünde. "
        
        # Highlights
        highlights = []
        if rsi < 30: highlights.append("RSI aşırı satım (ucuz) bölgesinde.")
        elif rsi > 70: highlights.append("RSI aşırı alım (pahalı) bölgesinde.")
        
        if macd_val > sig_val: highlights.append("MACD AL kesişimi koruyor.")
        else: highlights.append("MACD SAT kesişimi baskı oluşturuyor.")
        
        if curr > ema200: highlights.append("Fiyat uzun vadeli EMA200 trend desteğinin üzerinde.")
        else: highlights.append("Fiyat uzun vadeli EMA200 direncinin altında.")
        
        if st_signal == "AL": highlights.append("Supertrend AL sinyalini sürdürüyor.")
        
        desc += " ".join(highlights[:2])

        signals.append({
            "ticker": ticker,
            "price": round(curr, 2),
            "sma20": round(sma20, 2),
            "signal": sig,
            "description": desc,
            "color": color,
            "buy_score": buy_score,
            "sell_score": sell_score,
            "total_indicators": 11,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        })

    result = {
        "is_fallback": is_fallback,
        "signals": signals
    }
    cache_service.set_json(cache_key, result, expire_seconds=_SIGNALS_CACHE_TTL_SECONDS)
    return result
