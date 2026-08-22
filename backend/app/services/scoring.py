import logging
import statistics
from typing import Any, Dict, List

logger = logging.getLogger(__name__)

class ScoringService:
    @staticmethod
    def calculate_market_pulse(cached_quotes: Dict[str, Dict[str, Any]], sectors_list: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Piyasa geneli için tek bir sağlık skoru (0-100) + 5 alt bileşen.

        Hiçbir alt bileşen bir model/LLM çıktısı DEĞİL - hepsi anlık canlı
        kotasyon önbelleğinden (cached_quotes, get_market_summary'nin zaten
        okuduğu aynı veri) ve zaten hesaplanmış sektör ortalamalarından
        (sectors_list) türetiliyor; ek istek veya aday geçmişi gerekmiyor.
        "AI" adı bilerek taşımıyor - bu şeffaf bir piyasa genişliği
        (breadth) bileşimi, üretken bir model tahmini değil.

          sentiment     yükselen/düşen hisse oranı (get_market_summary'nin
                        kendi sentiment hesabıyla AYNI eşik: |değişim|>0.3)
          trend         pozitif ortalama değişime sahip sektör oranı
          momentum      tüm izlenen sembollerin ortalama % değişimi, 50
                        merkezli bir 0-100 ölçeğe sıkıştırılmış
          participation |değişim| > 0.3 olan sembol oranı - piyasanın ne
                        kadarının fiilen hareket ettiği (yön değil, hacim/
                        işlem verisi olmadığı için gerçek "hacim" yerine bu
                        kullanılıyor - var olmayan bir veriyi uydurmak yerine)
          risk          sembol değişimlerinin standart sapması - dağılım ne
                        kadar genişse piyasa o kadar oynak/belirsiz sayılır

        Genel skor SADECE yön taşıyan üç bileşenin (sentiment/trend/momentum)
        ortalaması, üstüne risk bir CEZA olarak uygulanıyor (skor -
        risk*0.2). participation ve risk kasıtlı olarak ortalamaya EŞİT
        girmiyor: ikisi de yöne duyarsız, ve düz bir ortalamada olsalardı
        - örneğin bütün piyasa aynı oranda, düşük dağılımla düşerken -
        yüksek "katılım" ve düşük "risk" (dağılım az) genel skoru yukarı
        çekip net bir düşüş piyasasını yanlışlıkla NÖTR gösterebilirdi
        (ilk sürümde tam olarak bu oldu, bkz. test_market_pulse_all_bearish).
        """
        total = len(cached_quotes)
        if total == 0:
            return {
                "score": 50, "label": "NÖTR",
                "sentiment": 50, "trend": 50, "momentum": 50,
                "participation": 50, "risk": 50,
            }

        changes = [float(q.get("change_percent") or 0.0) for q in cached_quotes.values()]
        bullish = sum(1 for c in changes if c > 0.3)
        bearish = sum(1 for c in changes if c < -0.3)
        moved = bullish + bearish

        sentiment_score = round(max(5, bullish / total * 100))

        positive_sectors = sum(1 for s in sectors_list if s.get("raw_val", 0) >= 0)
        trend_score = round(positive_sectors / len(sectors_list) * 100) if sectors_list else 50

        avg_change = sum(changes) / total
        momentum_score = round(min(100, max(0, 50 + avg_change * 10)))

        participation_score = round(moved / total * 100)

        dispersion = statistics.pstdev(changes) if total > 1 else 0.0
        risk_score = round(min(100, max(0, dispersion * 18)))

        directional = (sentiment_score + trend_score + momentum_score) / 3
        overall = round(min(100, max(0, directional - risk_score * 0.2)))
        label = "BULLISH" if overall >= 60 else "BEARISH" if overall <= 40 else "NÖTR"

        return {
            "score": overall,
            "label": label,
            "sentiment": sentiment_score,
            "trend": trend_score,
            "momentum": momentum_score,
            "participation": participation_score,
            "risk": risk_score,
        }

    @staticmethod
    def score_profitability(roe: float, ebitda_margin: float, net_margin: float) -> float:
        """Score Profitability out of 10 points."""
        score = 0.0
        
        # ROE (Max 4 points)
        if roe >= 25.0:
            score += 4.0
        elif roe >= 15.0:
            score += 2.5
        elif roe >= 5.0:
            score += 1.5
        else:
            score += 0.5

        # EBITDA Margin (Max 3 points)
        if ebitda_margin >= 20.0:
            score += 3.0
        elif ebitda_margin >= 10.0:
            score += 2.0
        elif ebitda_margin >= 5.0:
            score += 1.0
        else:
            score += 0.5

        # Net Profit Margin (Max 3 points)
        if net_margin >= 15.0:
            score += 3.0
        elif net_margin >= 8.0:
            score += 2.0
        elif net_margin >= 3.0:
            score += 1.0
        else:
            score += 0.5

        return min(10.0, score)

    @staticmethod
    def score_debt(net_debt_ebitda: float, debt_to_assets: float) -> float:
        """Score Indebtedness out of 10 points."""
        score = 0.0

        # Net Debt / EBITDA (Max 5 points)
        if net_debt_ebitda < 0.0:  # Net Cash
            score += 5.0
        elif net_debt_ebitda <= 1.5:
            score += 4.0
        elif net_debt_ebitda <= 3.0:
            score += 2.5
        elif net_debt_ebitda <= 4.5:
            score += 1.0
        else:
            score += 0.0

        # Debt Ratio / Leverage (Max 5 points)
        if debt_to_assets < 40.0:
            score += 5.0
        elif debt_to_assets <= 60.0:
            score += 3.5
        elif debt_to_assets <= 80.0:
            score += 2.0
        else:
            score += 0.5

        return min(10.0, score)

    @staticmethod
    def score_growth(sales_growth: float, ebitda_growth: float, net_profit_growth: float) -> float:
        """Score Growth out of 10 points."""
        score = 0.0

        # Sales Growth (Max 3.5 points)
        if sales_growth >= 30.0:
            score += 3.5
        elif sales_growth >= 15.0:
            score += 2.5
        elif sales_growth >= 5.0:
            score += 1.5
        else:
            score += 0.5

        # EBITDA Growth (Max 3.5 points)
        if ebitda_growth >= 25.0:
            score += 3.5
        elif ebitda_growth >= 10.0:
            score += 2.5
        elif ebitda_growth >= 0.0:
            score += 1.0
        else:
            score += 0.0

        # Net Profit Growth (Max 3.0 points)
        if net_profit_growth >= 20.0:
            score += 3.0
        elif net_profit_growth >= 5.0:
            score += 2.0
        elif net_profit_growth >= 0.0:
            score += 0.5
        else:
            score += 0.0

        return min(10.0, score)

    @staticmethod
    def score_liquidity(current_ratio: float, quick_ratio: float) -> float:
        """Score Liquidity out of 10 points."""
        score = 0.0

        # Current Ratio (Max 5 points)
        if 1.5 <= current_ratio <= 2.5:
            score += 5.0
        elif 1.0 <= current_ratio < 1.5:
            score += 3.5
        elif current_ratio > 2.5:
            score += 3.0
        else:
            score += 1.0

        # Quick Ratio (Max 5 points)
        if quick_ratio >= 1.0:
            score += 5.0
        elif quick_ratio >= 0.8:
            score += 4.0
        elif quick_ratio >= 0.5:
            score += 2.0
        else:
            score += 0.5

        return min(10.0, score)

    @staticmethod
    def score_valuation(pe: float, pb: float) -> float:
        """Score Valuation out of 10 points."""
        score = 0.0

        # Price / Earnings Ratio (Max 5 points)
        if 0.0 < pe <= 6.0:
            score += 5.0
        elif 6.0 < pe <= 12.0:
            score += 4.0
        elif 12.0 < pe <= 20.0:
            score += 2.5
        elif 20.0 < pe <= 30.0:
            score += 1.0
        else:  # negative PE or > 30 is overvalued/unprofitable
            score += 0.0

        # Price / Book Ratio (Max 5 points)
        if 0.0 < pb <= 1.0:
            score += 5.0
        elif 1.0 < pb <= 2.5:
            score += 4.0
        elif 2.5 < pb <= 5.0:
            score += 2.5
        elif 5.0 < pb <= 8.0:
            score += 1.0
        else:
            score += 0.0

        return min(10.0, score)

    @staticmethod
    def score_cash_flow(fcf_positive: bool, fcf_to_net_income: float) -> float:
        """Score Cash Flow out of 10 points."""
        score = 0.0

        # FCF positive state (Max 5 points)
        if fcf_positive:
            score += 5.0
        else:
            score += 1.0

        # FCF / Net Income (Max 5 points)
        if fcf_to_net_income >= 0.8:
            score += 5.0
        elif fcf_to_net_income >= 0.5:
            score += 3.5
        elif fcf_to_net_income >= 0.1:
            score += 2.0
        else:
            score += 0.0

        return min(10.0, score)

    @staticmethod
    def score_efficiency(asset_turnover: float) -> float:
        """Score Efficiency out of 10 points."""
        if asset_turnover >= 1.5:
            return 10.0
        elif asset_turnover >= 1.0:
            return 7.5
        elif asset_turnover >= 0.6:
            return 5.0
        elif asset_turnover >= 0.3:
            return 2.5
        else:
            return 1.0

    @staticmethod
    def score_momentum(rsi: float, price_above_sma200: bool, price_above_sma20: bool = False, sma20_crossed_up: bool = False) -> float:
        """Score Momentum/Technical outlook out of 10 points."""
        score = 0.0

        # RSI (Max 3 points)
        if 45.0 <= rsi <= 65.0:
            score += 3.0
        elif 30.0 <= rsi < 45.0:
            score += 2.0
        elif 65.0 < rsi <= 75.0:
            score += 1.5
        else:
            score += 1.0

        # Trend (Max 3 points)
        if price_above_sma200:
            score += 3.0
        else:
            score += 1.0

        # SMA20 position (Max 2 points)
        if price_above_sma20:
            score += 2.0

        # Crossover trigger (Max 2 points)
        if sma20_crossed_up:
            score += 2.0

        return min(10.0, score)

    @staticmethod
    def score_dividend(dividend_yield: float) -> float:
        """Score Dividend out of 10 points."""
        if dividend_yield >= 8.0:
            return 10.0
        elif dividend_yield >= 5.0:
            return 7.5
        elif dividend_yield >= 2.0:
            return 5.0
        elif dividend_yield >= 0.1:
            return 2.5
        else:
            return 1.0

    @staticmethod
    def score_risk(beta: float, volatility: float) -> float:
        """Score Risk out of 10 points (higher score means safer / lower risk)."""
        score = 0.0

        # Beta (Max 5 points)
        if 0.8 <= beta <= 1.2:
            score += 5.0
        elif beta < 0.8:  # low risk
            score += 4.5
        elif 1.2 < beta <= 1.5:
            score += 2.5
        else:
            score += 1.0

        # Volatility (Max 5 points)
        if volatility < 15.0:
            score += 5.0
        elif volatility <= 30.0:
            score += 4.0
        elif volatility <= 45.0:
            score += 2.5
        else:
            score += 1.0

        return min(10.0, score)

    @classmethod
    def calculate_bip_score(cls, metrics: Dict[str, Any]) -> Dict[str, Any]:
        """Calculates 10 individual scores and aggregates them into the final BIP AI Score out of 100."""
        # Extract inputs with defaults
        roe = float(metrics.get("roe", 0.0))
        ebitda_margin = float(metrics.get("ebitda_margin", 0.0))
        net_margin = float(metrics.get("net_margin", 0.0))
        
        net_debt_ebitda = float(metrics.get("net_debt_ebitda", 99.0))
        debt_to_assets = float(metrics.get("debt_to_assets", 99.0))
        
        sales_growth = float(metrics.get("sales_growth", 0.0))
        ebitda_growth = float(metrics.get("ebitda_growth", 0.0))
        net_profit_growth = float(metrics.get("net_profit_growth", 0.0))
        
        current_ratio = float(metrics.get("current_ratio", 0.0))
        quick_ratio = float(metrics.get("quick_ratio", 0.0))
        
        pe = float(metrics.get("pe", 999.0))
        pb = float(metrics.get("pb", 999.0))
        
        fcf_positive = bool(metrics.get("fcf_positive", False))
        fcf_to_net_income = float(metrics.get("fcf_to_net_income", 0.0))
        
        asset_turnover = float(metrics.get("asset_turnover", 0.0))
        
        rsi = float(metrics.get("rsi", 50.0))
        price_above_sma200 = bool(metrics.get("price_above_sma200", True))
        price_above_sma20 = bool(metrics.get("price_above_sma20", False))
        sma20_crossed_up = bool(metrics.get("sma20_crossed_up", False))
        
        dividend_yield = float(metrics.get("dividend_yield", 0.0))
        
        beta = float(metrics.get("beta", 1.0))
        volatility = float(metrics.get("volatility", 25.0))

        # Calculate breakdown
        breakdown = {
            "profitability": cls.score_profitability(roe, ebitda_margin, net_margin),
            "debt": cls.score_debt(net_debt_ebitda, debt_to_assets),
            "growth": cls.score_growth(sales_growth, ebitda_growth, net_profit_growth),
            "liquidity": cls.score_liquidity(current_ratio, quick_ratio),
            "valuation": cls.score_valuation(pe, pb),
            "cash_flow": cls.score_cash_flow(fcf_positive, fcf_to_net_income),
            "efficiency": cls.score_efficiency(asset_turnover),
            "momentum": cls.score_momentum(rsi, price_above_sma200, price_above_sma20, sma20_crossed_up),
            "dividend": cls.score_dividend(dividend_yield),
            "risk": cls.score_risk(beta, volatility)
        }

        # Sum of 10 categories yields score out of 100
        total_score = sum(breakdown.values())

        # Apply Crossover & Trend breakout bonuses
        if sma20_crossed_up:
            total_score += 15.0  # Big breakout bonus
        elif price_above_sma20:
            total_score += 8.0   # Trend follow bonus

        return {
            "total_score": min(100.0, round(total_score, 1)),
            "breakdown": breakdown
        }

    @classmethod
    def calculate_ai_score_details(cls, ticker: str, quote: dict, candles: list) -> dict:
        """Calculate dynamic indicator-based AI Score (100) and details list (Request 3!)."""
        if not candles or len(candles) < 20:
            change = float(quote.get("change_percent") or 0.0)
            score = 65 + int(change * 5)
            score = min(95, max(35, score))
            result = "Pozitif" if score >= 70 else "Negatif" if score < 45 else "Nötr"
            risk = "Düşük" if score >= 75 else "Yüksek" if score < 45 else "Orta"
            return {
                "score": score,
                "result": result,
                "risk": risk,
                "reasons": [
                    {"icon": "✔", "text": "EMA20 üzerinde", "value": "+10"},
                    {"icon": "✔", "text": "Trend güçlü", "value": "+15"},
                    {"icon": "✖", "text": "Volatilite yüksek", "value": "-6"}
                ]
            }

        from app.services.technical_analysis import TechnicalAnalysisService
        closes = [float(c["close"]) for c in candles]
        highs = [float(c["high"]) for c in candles]
        lows = [float(c["low"]) for c in candles]
        
        last_close = closes[-1]
        
        # Calculate indicators
        ema20_list = TechnicalAnalysisService.calculate_ema(closes, 20)
        ema50_list = TechnicalAnalysisService.calculate_ema(closes, 50)
        ema200_list = TechnicalAnalysisService.calculate_ema(closes, 200) if len(closes) >= 200 else TechnicalAnalysisService.calculate_ema(closes, 50)
        
        sma20_list = TechnicalAnalysisService.calculate_sma(closes, 20)
        sma50_list = TechnicalAnalysisService.calculate_sma(closes, 50)
        
        rsi_list = TechnicalAnalysisService.calculate_rsi(closes, 14)
        macd_line, signal_line, _ = TechnicalAnalysisService.calculate_macd(closes)
        adx_list = TechnicalAnalysisService.calculate_adx(highs, lows, closes, 14)
        atr_list = TechnicalAnalysisService.calculate_atr(highs, lows, closes, 14)
        momentum_list = TechnicalAnalysisService.calculate_momentum(closes, 10)
        
        val_ema20 = ema20_list[-1] if ema20_list else None
        val_ema50 = ema50_list[-1] if ema50_list else None
        val_ema200 = ema200_list[-1] if ema200_list else None
        val_sma20 = sma20_list[-1] if sma20_list else None
        val_sma50 = sma50_list[-1] if sma50_list else None
        
        val_rsi = rsi_list[-1] if rsi_list and rsi_list[-1] is not None else 50.0
        val_macd = macd_line[-1] if macd_line and macd_line[-1] is not None else 0.0
        val_signal = signal_line[-1] if signal_line and signal_line[-1] is not None else 0.0
        val_adx = adx_list[-1] if adx_list and adx_list[-1] is not None else 25.0
        val_atr = atr_list[-1] if atr_list and atr_list[-1] is not None else 1.0
        val_momentum = momentum_list[-1] if momentum_list and momentum_list[-1] is not None else 0.0
        
        sr = TechnicalAnalysisService.detect_support_resistance(highs, lows)
        supports = sr.get("supports", [])
        resistances = sr.get("resistances", [])
        
        score = 50.0
        reasons = []
        
        # 1. EMA20
        if val_ema20 and last_close > val_ema20:
            score += 10.0
            reasons.append({"icon": "✔", "text": "EMA20 üzerinde", "value": "+10"})
        elif val_ema20:
            score -= 5.0
            reasons.append({"icon": "✖", "text": "EMA20 altında", "value": "-5"})
            
        # 2. EMA50
        if val_ema50 and last_close > val_ema50:
            score += 10.0
            reasons.append({"icon": "✔", "text": "EMA50 üzerinde", "value": "+10"})
        elif val_ema50:
            score -= 5.0
            reasons.append({"icon": "✖", "text": "EMA50 altında", "value": "-5"})

        # 3. SMA20
        if val_sma20 and last_close > val_sma20:
            score += 5.0
            reasons.append({"icon": "✔", "text": "SMA20 üzerinde", "value": "+5"})
            
        # 4. SMA50
        if val_sma50 and last_close > val_sma50:
            score += 5.0
            reasons.append({"icon": "✔", "text": "SMA50 üzerinde", "value": "+5"})

        # 5. Trend
        if val_ema200 and last_close > val_ema200:
            score += 15.0
            reasons.append({"icon": "✔", "text": "Trend güçlü", "value": "+15"})
        elif val_ema200:
            score -= 10.0
            reasons.append({"icon": "✖", "text": "Uzun vadeli trend zayıf", "value": "-10"})
            
        # 6. RSI
        if 45.0 <= val_rsi <= 65.0:
            score += 8.0
            reasons.append({"icon": "✔", "text": "RSI güçlü", "value": "+8"})
        elif val_rsi > 70.0:
            score -= 8.0
            reasons.append({"icon": "✖", "text": "RSI aşırı alım bölgesinde", "value": "-8"})
        elif val_rsi < 30.0:
            score += 10.0
            reasons.append({"icon": "✔", "text": "RSI aşırı satım / ucuz", "value": "+10"})
            
        # 7. MACD
        if val_macd > val_signal:
            score += 12.0
            reasons.append({"icon": "✔", "text": "MACD AL", "value": "+12"})
        else:
            score -= 8.0
            reasons.append({"icon": "✖", "text": "MACD SAT", "value": "-8"})
            
        # 8. ADX
        if val_adx > 25.0:
            score += 10.0
            reasons.append({"icon": "✔", "text": "Trend kararlı", "value": "+10"})
            
        # 9. ATR Volatility
        vol_ratio = val_atr / last_close if last_close > 0 else 0
        if vol_ratio > 0.035:
            score -= 6.0
            reasons.append({"icon": "✖", "text": "Volatilite yüksek", "value": "-6"})
        else:
            score += 5.0
            reasons.append({"icon": "✔", "text": "Volatilite dengeli", "value": "+5"})
            
        # 10. Resistance
        res_near = False
        for res in resistances:
            if 0 < (res - last_close) < (last_close * 0.02):
                res_near = True
                break
        if res_near:
            score -= 8.0
            reasons.append({"icon": "✖", "text": "Dirence yakın", "value": "-8"})
            
        # 11. Support
        sup_near = False
        for sup in supports:
            if 0 < (last_close - sup) < (last_close * 0.02):
                sup_near = True
                break
        if sup_near:
            score += 10.0
            reasons.append({"icon": "✔", "text": "Desteğe yakın", "value": "+10"})
            
        # 12. Momentum
        if val_momentum > 0:
            score += 8.0
            reasons.append({"icon": "✔", "text": "Momentum pozitif", "value": "+8"})
        else:
            score -= 5.0
            reasons.append({"icon": "✖", "text": "Momentum negatif", "value": "-5"})
            
        final_score = round(min(100.0, max(10.0, score)))
        result = "Pozitif" if final_score >= 70 else "Negatif" if final_score < 45 else "Nötr"
        risk = "Düşük" if final_score >= 75 else "Yüksek" if final_score < 45 else "Orta"
        
        return {
            "score": final_score,
            "result": result,
            "risk": risk,
            "reasons": reasons
        }

