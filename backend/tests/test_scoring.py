import pytest
from app.services.scoring import ScoringService

def test_scoring_super_company():
    # Metrics of a highly profitable, growing, low debt company with low valuation
    super_metrics = {
        "roe": 40.0,
        "ebitda_margin": 30.0,
        "net_margin": 25.0,
        "net_debt_ebitda": -0.5,  # Net Cash
        "debt_to_assets": 25.0,
        "sales_growth": 45.0,
        "ebitda_growth": 40.0,
        "net_profit_growth": 35.0,
        "current_ratio": 2.0,
        "quick_ratio": 1.5,
        "pe": 5.0,  # Highly undervalued
        "pb": 0.8,
        "fcf_positive": True,
        "fcf_to_net_income": 0.9,
        "asset_turnover": 1.6,
        "rsi": 55.0,  # Perfect stable momentum
        "price_above_sma200": True,
        "dividend_yield": 9.0,  # Super high dividend
        "beta": 0.9,
        "volatility": 12.0  # Safe/low volatility
    }

    result = ScoringService.calculate_bip_score(super_metrics)
    
    assert result["total_score"] >= 90.0
    # Assert breakdown has all 10 categories
    assert len(result["breakdown"]) == 10
    assert result["breakdown"]["profitability"] == 10.0
    assert result["breakdown"]["debt"] == 10.0
    assert result["breakdown"]["valuation"] == 10.0

def test_scoring_troubled_company():
    # Metrics of a highly indebted, unprofitable, shrinking, expensive company
    troubled_metrics = {
        "roe": 2.0,
        "ebitda_margin": 3.0,
        "net_margin": 1.0,
        "net_debt_ebitda": 5.5,  # High debt burden
        "debt_to_assets": 85.0,
        "sales_growth": -20.0,  # Shrinking
        "ebitda_growth": -35.0,
        "net_profit_growth": -50.0,
        "current_ratio": 0.6,  # Liquidity crisis
        "quick_ratio": 0.3,
        "pe": 45.0,  # Highly overvalued
        "pb": 12.0,
        "fcf_positive": False,
        "fcf_to_net_income": -0.5,
        "asset_turnover": 0.2,
        "rsi": 80.0,  # Extreme overbought risk
        "price_above_sma200": False,
        "dividend_yield": 0.0,
        "beta": 1.8,  # High systematic risk
        "volatility": 55.0  # Wild price swings
    }

    result = ScoringService.calculate_bip_score(troubled_metrics)
    
    assert result["total_score"] <= 25.0
    assert result["breakdown"]["profitability"] <= 2.0
    assert result["breakdown"]["debt"] <= 1.0
    assert result["breakdown"]["valuation"] == 0.0

def test_scoring_default_fallbacks():
    # Empty dictionary should handle default values gracefully without raising exceptions
    result = ScoringService.calculate_bip_score({})
    
    assert "total_score" in result
    assert isinstance(result["total_score"], float)
    assert len(result["breakdown"]) == 10
