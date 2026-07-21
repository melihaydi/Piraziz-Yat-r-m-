import logging
from typing import Any, Dict

logger = logging.getLogger(__name__)

class ScoringService:
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
