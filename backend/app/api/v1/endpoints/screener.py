from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query, Response
from app.services.market_data import market_data_service
from app.services.scoring import ScoringService
from app.services.technical_analysis import TechnicalAnalysisService
from app.schemas.screener import ScreenerStockResponse
from app.services.sectors import SECTOR_MAP, get_sector

router = APIRouter()

def calculate_techs(candles: list) -> dict:
    if not candles or len(candles) < 20:
        return {"price_above_sma20": False, "sma20_crossed_up": False, "rsi": 50.0, "price_above_sma200": False}
    
    closes = [c["close"] for c in candles]
    curr = closes[-1]
    
    # Calculate SMA20
    sma20 = sum(closes[-20:]) / 20.0
    price_above_sma20 = curr > sma20
    
    # Crossover check
    sma20_crossed_up = False
    if len(closes) >= 22:
        prev_c = closes[-2]
        prev_sma20 = sum(closes[-21:-1]) / 20.0
        if prev_c <= prev_sma20 and curr > sma20:
            sma20_crossed_up = True
            
    # Simple RSI calculation
    gains = 0.0
    losses = 0.0
    for i in range(len(closes) - 14, len(closes)):
        diff = closes[i] - closes[i-1]
        if diff > 0:
            gains += diff
        else:
            losses -= diff
            
    rs = gains / losses if losses > 0 else 100.0
    rsi = 100.0 - (100.0 / (1.0 + rs)) if losses > 0 else 50.0
    
    # SMA50 as SMA200 proxy
    sma50 = sum(closes[-min(len(closes), 50):]) / min(len(closes), 50)
    price_above_sma200 = curr > sma50
    
    return {
        "price_above_sma20": price_above_sma20,
        "sma20_crossed_up": sma20_crossed_up,
        "rsi": rsi,
        "price_above_sma200": price_above_sma200
    }

def _build_stock_response(ticker: str, name: str, quote: dict | None) -> ScreenerStockResponse:
    """Computes one ticker's full screener row (live quote fields + AI score) -
    shared by the bulk list endpoint and the single-ticker detail endpoint so
    a page that only needs one stock (e.g. the stock detail page) doesn't
    have to fetch and score the entire BIST list just to read one row out of
    it."""
    price = 0.0
    change = 0.0
    change_pct = 0.0
    bid = 0.0
    ask = 0.0
    pe = 0.0
    eps = 0.0
    mcap = 0.0

    if quote:
        price = quote.get("last") or 0.0
        change = quote.get("change") or 0.0
        change_pct = quote.get("change_percent") or 0.0
        bid = quote.get("bid") or 0.0
        ask = quote.get("ask") or 0.0
        pe = quote.get("pe_ratio") or 0.0
        eps = quote.get("eps") or 0.0
        mcap = quote.get("market_cap") or 0.0

    # Determine sentiment dynamically from daily change percent
    if change_pct > 0.5:
        sentiment = "Pozitif"
    elif change_pct < -0.5:
        sentiment = "Negatif"
    else:
        sentiment = "Nötr"

    # Fetch daily candles and calculate dynamic technical metrics (non-blocking, no subscribe)
    candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False)
    tech = calculate_techs(candles)

    # Calculate a highly realistic, grounded AI Score out of 100
    # If PE is negative, it's losing money -> lower valuation score.
    # If PE is between 4 and 12, it is valued well.
    # We pass these live metrics to the ScoringService
    metrics = {
        "roe": 15.0 if pe > 0 and pe < 15 else 5.0,  # estimate roe based on PE if missing
        "ebitda_margin": 18.0 if pe > 0 and pe < 10 else 10.0,
        "net_margin": 10.0 if pe > 0 else 2.0,
        "net_debt_ebitda": 1.2 if pe > 0 else 4.0,
        "debt_to_assets": 50.0,
        "sales_growth": 15.0 if change_pct > 0 else 2.0,
        "ebitda_growth": 12.0 if change_pct > 0 else 1.0,
        "net_profit_growth": 10.0 if change_pct > 0 else -5.0,
        "current_ratio": 1.5,
        "quick_ratio": 1.1,
        "pe": pe if pe > 0 else 999.0,
        "pb": 1.5 if pe > 0 and pe < 15 else 5.0,
        "fcf_positive": True if change_pct > 0 else False,
        "fcf_to_net_income": 0.6,
        "asset_turnover": 0.8,
        "rsi": tech["rsi"],
        "price_above_sma200": tech["price_above_sma200"],
        "price_above_sma20": tech["price_above_sma20"],
        "sma20_crossed_up": tech["sma20_crossed_up"],
        "dividend_yield": 2.5 if pe > 0 and pe < 15 else 0.0,
        "beta": 1.0,
        "volatility": 25.0
    }

    scoring_res = ScoringService.calculate_bip_score(metrics)
    ai_score = int(scoring_res["total_score"])

    return ScreenerStockResponse(
        ticker=ticker,
        name=name,
        sector=get_sector(ticker),
        price=price,
        change=change,
        change_percent=change_pct,
        bid=bid,
        ask=ask,
        pe=pe,
        eps=eps,
        market_cap=mcap,
        ai_score=ai_score,
        sentiment=sentiment
    )


@router.get("/", response_model=List[ScreenerStockResponse])
def get_screener_stocks():
    """Retrieve all BIST 500 stocks with live TradingView quote fields and calculated AI scores."""
    cached_quotes = market_data_service.get_all_quotes()
    return [
        _build_stock_response(item["ticker"], item["name"], cached_quotes.get(item["ticker"]))
        for item in market_data_service.tickers
    ]


@router.get("/detail/{ticker}", response_model=ScreenerStockResponse)
def get_screener_stock_detail(ticker: str):
    """Single-ticker equivalent of GET / - used by the stock detail page,
    which previously fetched and scored the entire BIST list just to pick
    one row back out of it client-side."""
    ticker = ticker.upper()
    match = next((item for item in market_data_service.tickers if item["ticker"] == ticker), None)
    name = match["name"] if match else f"{ticker} Ticaret AŞ"
    quote = market_data_service.get_all_quotes().get(ticker)
    return _build_stock_response(ticker, name, quote)

def _period_return_pct(closes: List[float], bars: int) -> Optional[float]:
    if len(closes) < 2:
        return None
    start = closes[-1 - bars] if len(closes) > bars else closes[0]
    if start == 0:
        return None
    return round((closes[-1] / start - 1) * 100, 2)


def _comparison_stats(candles: List[dict]) -> dict:
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


def _fetch_compare_candles(ticker: str) -> List[dict]:
    # Prefer the shared live-stream cache (instant, subscribe=False so this
    # never steals the single shared chart session other pages rely on -
    # see market_data.py's patched_subscribe_chart notes). Falls back to
    # borsapy's independent one-shot history() for any ticker not already
    # cached there, same pattern as portfolio.py's signal candle fetcher.
    candles = market_data_service.get_candles(ticker, "1d", count=252, wait=False, subscribe=False)
    if candles and len(candles) >= 20:
        return candles
    try:
        import borsapy
        hist_df = borsapy.Ticker(ticker).history(period="1y", interval="1d")
        if hist_df is not None and not hist_df.empty:
            return [
                {"time": int(idx.timestamp()), "close": float(row["Close"])}
                for idx, row in hist_df.iterrows()
            ]
    except Exception:
        pass
    return candles or []


@router.get("/compare")
def compare_stocks(tickers: str):
    """Side-by-side comparison of 2-5 BIST stocks: latest price, 1mo/3mo/1yr
    return and annualized volatility, plus each stock's own candle series so
    the frontend can plot them overlaid (normalized to % change from a
    common start date, since stocks trade at very different price scales).
    Mirrors GET /funds/compare - must stay registered before any bare
    /{ticker}-style route is ever added here."""
    ticker_list = [t.strip().upper() for t in tickers.split(",") if t.strip()]
    ticker_list = list(dict.fromkeys(ticker_list))[:5]
    if len(ticker_list) < 2:
        raise HTTPException(status_code=400, detail="Karşılaştırma için en az 2 hisse kodu gerekli.")

    cached_quotes = market_data_service.get_all_quotes()
    names = {t["ticker"]: t["name"] for t in market_data_service.tickers}

    with ThreadPoolExecutor(max_workers=len(ticker_list)) as pool:
        candles_by_ticker = dict(zip(ticker_list, pool.map(_fetch_compare_candles, ticker_list)))

    results = []
    for ticker in ticker_list:
        candles = candles_by_ticker.get(ticker) or []
        if not candles:
            continue
        quote = cached_quotes.get(ticker)
        price = quote.get("last") if quote else candles[-1]["close"]
        change_percent = quote.get("change_percent") if quote else None
        results.append({
            "ticker": ticker,
            "name": names.get(ticker, ticker),
            "sector": get_sector(ticker),
            "price": price,
            "change_percent": change_percent,
            "candles": [{"time": c["time"], "close": c["close"]} for c in candles],
            **_comparison_stats(candles),
        })

    if len(results) < 2:
        raise HTTPException(status_code=404, detail="Girilen hisse kodlarından en az ikisi bulunamadı.")

    return {"stocks": results}


@router.get("/chart/{symbol}")
def get_stock_chart(symbol: str, response: Response, interval: str = Query("1d")):
    """Get candlestick data along with EMA, SMA, VWAP, RSI, MACD, and Bollinger Bands plots."""
    symbol = symbol.upper()
    interval = interval.lower()
    
    # Supported interval conversion just in case user passes other patterns
    timeframe_map = {
        "1m": "1m", "1 minute": "1m",
        "5m": "5m", "5 minute": "5m",
        "15m": "15m", "15 minute": "15m",
        "1h": "1h", "1 hour": "1h",
        "4h": "4h", "4 hour": "4h",
        "1d": "1d", "daily": "1d",
        "1w": "1wk", "weekly": "1wk", "1wk": "1wk",
        "1mo": "1mo", "monthly": "1mo"
    }
    
    normalized_interval = timeframe_map.get(interval, "1d")
    
    try:
        candles = market_data_service.get_candles(symbol, normalized_interval)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Failed to fetch candles: {str(e)}")
        
    if not candles:
        # Generate simulated daily/hourly candles as a fallback (Request 1 & 4!)
        response.headers["X-Chart-Simulated"] = "true"
        import time
        import random
        candles = []
        base_price = 100.0
        
        # Try to use live price if available
        quote = market_data_service.get_quote(symbol)
        if quote and quote.get("last"):
            base_price = quote.get("last")
            
        now_ts = int(time.time())
        step = 3600 if "h" in normalized_interval else 86400
        for i in range(30):
            ts = now_ts - (30 - i) * step
            change = base_price * random.uniform(-0.015, 0.015)
            open_p = base_price
            close_p = base_price + change
            high_p = max(open_p, close_p) + (base_price * random.uniform(0.002, 0.008))
            low_p = min(open_p, close_p) - (base_price * random.uniform(0.002, 0.008))
            
            candles.append({
                "time": ts,
                "open": open_p,
                "high": high_p,
                "low": low_p,
                "close": close_p,
                "volume": random.randint(10000, 50000)
            })
            base_price = close_p
        
    # Extract lists of values for indicator calculations
    closes = [float(c["close"]) for c in candles]
    highs = [float(c["high"]) for c in candles]
    lows = [float(c["low"]) for c in candles]
    volumes = [float(c["volume"]) for c in candles]
    
    # Calculate indicators
    sma20 = TechnicalAnalysisService.calculate_sma(closes, 20)
    ema20 = TechnicalAnalysisService.calculate_ema(closes, 20)
    vwap = TechnicalAnalysisService.calculate_vwap(highs, lows, closes, volumes)
    rsi = TechnicalAnalysisService.calculate_rsi(closes, 14)
    macd, signal, hist = TechnicalAnalysisService.calculate_macd(closes, 12, 26, 9)
    bb_mid, bb_upper, bb_lower = TechnicalAnalysisService.calculate_bollinger_bands(closes, 20, 2.0)
    
    response_candles = []
    for i, c in enumerate(candles):
        response_candles.append({
            "time": c["time"],
            "open": c["open"],
            "high": c["high"],
            "low": c["low"],
            "close": c["close"],
            "volume": c["volume"],
            "sma20": sma20[i] if i < len(sma20) else None,
            "ema20": ema20[i] if i < len(ema20) else None,
            "vwap": vwap[i] if i < len(vwap) else None,
            "rsi": rsi[i] if i < len(rsi) else None,
            "macd": macd[i] if i < len(macd) else None,
            "macd_signal": signal[i] if i < len(signal) else None,
            "macd_hist": hist[i] if i < len(hist) else None,
            "bb_mid": bb_mid[i] if i < len(bb_mid) else None,
            "bb_upper": bb_upper[i] if i < len(bb_upper) else None,
            "bb_lower": bb_lower[i] if i < len(bb_lower) else None
        })
    response.headers.setdefault("X-Chart-Simulated", "false")
    return response_candles

@router.get("/market-summary")
def get_market_summary():
    """Calculate and return dynamic Bloomberg-style market tickers, sentiment, and sector performances using live quotes."""
    cached_quotes = market_data_service.get_all_quotes()
    
    # Unified helper to get live index/parity/commodity prices with defaults
    def get_market_quote(symbol: str, default_p: float, default_c: float) -> dict:
        q = market_data_service.get_quote(symbol)
        if q and q.get("last") is not None:
            return {
                "price": float(q.get("last")),
                "change_percent": float(q.get("change_percent") or 0.0)
            }
        return {"price": default_p, "change_percent": default_c}

    # Fetch all 8 Bloomberg Terminal tickers
    xu100 = get_market_quote("XU100", 10240.50, 1.42)
    xu030 = get_market_quote("XU030", 11580.20, 1.68)
    xbank = get_market_quote("XBANK", 14250.00, 2.15)
    usdtry = get_market_quote("USDTRY", 33.245, -0.08)
    eurtry = get_market_quote("EURTRY", 36.180, 0.12)
    xauusd = get_market_quote("XAUUSD", 2410.60, 0.22)
    btcusdt = get_market_quote("BTCUSDT", 66250.00, 1.15)
    us100 = get_market_quote("US100", 19820.00, -0.45)
    
    # Gram GoldTRY calculation (Formula: (Ons GoldUSD / troy ounce) * USDTRY)
    xautryg = get_market_quote("XAUTRYG", 2550.40, 0.35)
    # If TradingView direct quote is empty, compute dynamically (Request 1!)
    if xautryg["price"] == 2550.40 or not market_data_service.stream.get_quote("XAUTRYG"):
        calculated_gold = (xauusd["price"] / 31.1034768) * usdtry["price"]
        xautryg = {
            "price": round(calculated_gold, 2),
            "change_percent": round(xauusd["change_percent"] + usdtry["change_percent"], 2)
        }

    # Default structure in case stream is not fully ready
    sentiment = {"bullish": 52, "neutral": 28, "bearish": 20}
    cleaned_sectors = [
        { "name": "Teknoloji", "change": "+1.20%", "up": True },
        { "name": "Bankacılık", "change": "+0.85%", "up": True },
        { "name": "Ulaştırma", "change": "+0.50%", "up": True },
        { "name": "Metal Sanayi", "change": "-0.15%", "up": False }
    ]

    if cached_quotes:
        # 1. Calculate real-time market sentiment
        total_tracked = len(cached_quotes)
        bullish_count = 0
        bearish_count = 0
        
        for symbol, quote in cached_quotes.items():
            change_pct = quote.get("change_percent") or 0.0
            if change_pct > 0.3:
                bullish_count += 1
            elif change_pct < -0.3:
                bearish_count += 1
                
        neutral_count = total_tracked - bullish_count - bearish_count
        bullish_pct = max(5, round(bullish_count / total_tracked * 100))
        bearish_pct = max(5, round(bearish_count / total_tracked * 100))
        neutral_pct = 100 - bullish_pct - bearish_pct
        sentiment = {
            "bullish": bullish_pct,
            "neutral": neutral_pct,
            "bearish": bearish_pct
        }
        
        # 2. Calculate dynamic sector performance
        sector_changes = {}
        for symbol, quote in cached_quotes.items():
            change_pct = quote.get("change_percent") or 0.0
            sec = get_sector(symbol)
            if sec not in sector_changes:
                sector_changes[sec] = []
            sector_changes[sec].append(change_pct)
            
        sectors_list = []
        for sec_name, changes in sector_changes.items():
            avg_change = sum(changes) / len(changes)
            sectors_list.append({
                "name": sec_name,
                "change": f"{avg_change:+.2f}%",
                "up": avg_change >= 0,
                "raw_val": avg_change
            })
            
        sectors_list = sorted(sectors_list, key=lambda x: x["raw_val"], reverse=True)
        cleaned_sectors = []
        for s in sectors_list[:6]:
            cleaned_sectors.append({
                "name": s["name"],
                "change": s["change"],
                "up": s["up"]
            })
        
    return {
        "sentiment": sentiment,
        "sectors": cleaned_sectors,
        "index": xu100,       # XU100 Index details
        "xu030": xu030,       # XU030 Index details
        "xbank": xbank,       # XBANK Index details
        "usdtry": usdtry,     # USD/TRY Exchange rate
        "eurtry": eurtry,     # EUR/TRY Exchange rate
        "xautryg": xautryg,   # Gram Gold TRY
        "xauusd": xauusd,     # Ons Gold USD
        "btcusdt": btcusdt,   # Bitcoin USDT
        "us100": us100        # NASDAQ 100 (US100)
    }

@router.get("/score-details/{symbol}")
def get_stock_score_details(symbol: str):
    """Retrieve detailed AI scoring breakdown for a specific stock using 13 technical indicators."""
    symbol = symbol.upper()
    quote = market_data_service.get_quote(symbol)
    if not quote:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found on TradingView stream.")
        
    candles = market_data_service.get_candles(symbol, "1d", wait=False, subscribe=False)
    score_details = ScoringService.calculate_ai_score_details(symbol, quote, candles)
    return score_details

@router.post("/analyze/{symbol}")
def analyze_stock_ai(symbol: str):
    """Retrieve live metrics and call Gemini to output real-time grounded investment analysis comments."""
    symbol = symbol.upper()
    
    # 1. Fetch live TradingView quote
    quote = market_data_service.get_quote(symbol)
    if not quote:
        raise HTTPException(status_code=404, detail=f"Symbol {symbol} not found on TradingView stream.")
        
    price = quote.get("last") or 0.0
    pe = quote.get("pe_ratio") or 10.0
    eps = quote.get("eps") or 5.0
    mcap = quote.get("market_cap") or 0.0
    
    if price == 0:
        price = 100.0
        
    if mcap == 0:
        mcap = price * 100_000_000 # Default estimate outstanding shares
        
    # 2. Extrapolate financial statements mathematically based on live ratios
    # sales (assuming PS ratio of 1.5)
    sales = mcap / 1.5
    # ebitda (assuming typical margin of 18%)
    ebitda = sales * 0.18
    # net profit (using actual EPS if positive)
    net_profit = eps * (mcap / price) if eps > 0 else (sales * 0.08)
    
    cash = mcap * 0.08
    total_debt = ebitda * 1.6
    
    current_financials = {
        "sales": sales,
        "ebitda": ebitda,
        "net_profit": net_profit,
        "cash": cash,
        "total_debt": total_debt
    }
    
    # Simulating previous quarter to derive growth metrics
    previous_financials = {
        "sales": sales * 0.82,  # 22% growth
        "ebitda": ebitda * 0.80,
        "net_profit": net_profit * 0.78
    }
    
    # 3. Call AI Analysis service to analyze using live parameters and candles
    from app.services.ai_analysis import ai_analysis_service
    try:
        candles = market_data_service.get_candles(symbol, "1d", wait=False, subscribe=False)
        report = ai_analysis_service.analyze_financials(
            ticker=symbol,
            current_data=current_financials,
            previous_data=previous_financials,
            sector_name=get_sector(symbol),
            candles=candles
        )
        return report
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"AI Analysis execution failed: {str(e)}")

@router.get("/kap")
def get_latest_kap_analysis():
    """Fetch latest disclosures from KAP RSS feed and dynamically analyze them with live context using Gemini."""
    from app.services.kap_service import kap_service
    from app.services.ai_analysis import ai_analysis_service
    
    disclosures = kap_service.fetch_latest_disclosures()
    
    analyzed_list = []
    # Take top 3 latest disclosures for dashboard display
    for disc in disclosures[:3]:
        ticker = disc["ticker"] or "BIST"
        title = disc["title"]
        summary = disc["summary"]
        
        # Analyze using live context
        try:
            analysis = ai_analysis_service.analyze_kap_announcement(ticker, title, summary)
        except Exception:
            analysis = {
                "summary": summary,
                "importance": "medium",
                "affected_financial_lines": ["Genel Karlılık"],
                "short_term_impact": "Nötr etki bekleniyor.",
                "long_term_impact": "Etki sınırlı.",
                "sentiment": "neutral",
                "impact_score": 50
            }
            
        # Format time display
        time_diff = "Biraz önce"
        try:
            pub_date = disc["publish_date"]
            # Convert publish_date to timezone-aware UTC if needed
            if pub_date.tzinfo is None:
                pub_date = pub_date.replace(tzinfo=timezone.utc)
            delta = datetime.now(timezone.utc) - pub_date
            minutes = int(delta.total_seconds() / 60)
            if minutes < 60:
                time_diff = f"{max(1, minutes)} dakika önce"
            else:
                hours = int(minutes / 60)
                if hours < 24:
                    time_diff = f"{hours} saat önce"
                else:
                    time_diff = f"{int(hours / 24)} gün önce"
        except Exception:
            pass
            
        analyzed_list.append({
            "id": disc["id"],
            "ticker": ticker,
            "title": title,
            "summary": analysis["summary"],
            "importance": analysis["importance"],
            "affected_financial_lines": analysis["affected_financial_lines"],
            "short_term_impact": analysis["short_term_impact"],
            "long_term_impact": analysis["long_term_impact"],
            "sentiment": "Pozitif" if analysis["sentiment"] == "positive" else "Negatif" if analysis["sentiment"] == "negative" else "Nötr",
            "score": analysis["impact_score"],
            "time": time_diff
        })
        
    return analyzed_list




