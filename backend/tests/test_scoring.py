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


# --- calculate_market_pulse ------------------------------------------------
# Piyasa geneli "Piyasa Nabzı" bileşimi - hiçbir alt bileşen bir model
# çıktısı değil, hepsi canlı kotasyon önbelleğinden ve zaten hesaplanmış
# sektör ortalamalarından türetiliyor. Bu testler formülün gerçekten
# belgelendiği gibi davrandığını (yön, sınırlar, boş girdi) doğruluyor.

def test_market_pulse_empty_quotes_returns_neutral_defaults():
    result = ScoringService.calculate_market_pulse({}, [])
    assert result["score"] == 50
    assert result["label"] == "NÖTR"


def test_market_pulse_all_bullish_scores_high_and_labels_bullish():
    quotes = {f"S{i}": {"change_percent": 2.0} for i in range(20)}
    sectors = [{"name": "Bankacılık", "raw_val": 2.0}, {"name": "Enerji", "raw_val": 1.5}]
    result = ScoringService.calculate_market_pulse(quotes, sectors)
    assert result["label"] == "BULLISH"
    assert result["sentiment"] == 100
    assert result["trend"] == 100
    # Uniform +2% değişim -> hiç dağılım yok -> risk minimum.
    assert result["risk"] == 0


def test_market_pulse_all_bearish_scores_low_and_labels_bearish():
    quotes = {f"S{i}": {"change_percent": -2.0} for i in range(20)}
    sectors = [{"name": "Bankacılık", "raw_val": -2.0}, {"name": "Enerji", "raw_val": -1.5}]
    result = ScoringService.calculate_market_pulse(quotes, sectors)
    assert result["label"] == "BEARISH"
    assert result["sentiment"] == 5  # max(5, ...) tabanı - sıfıra hiç düşmüyor
    assert result["trend"] == 0


def test_market_pulse_high_dispersion_raises_risk_and_lowers_overall():
    """Aynı ortalama değişime sahip ama dağılımı farklı iki piyasa - daha
    geniş dağılımlı olan daha yüksek risk, dolayısıyla daha düşük genel
    skor almalı (risk tersten katkı veriyor)."""
    calm = {f"S{i}": {"change_percent": 0.5} for i in range(10)}
    volatile_changes = [5.0, -4.0, 5.0, -4.0, 5.0, -4.0, 5.0, -4.0, 5.0, -4.0]
    volatile = {f"S{i}": {"change_percent": c} for i, c in enumerate(volatile_changes)}
    sectors = [{"name": "X", "raw_val": 0.5}]

    calm_result = ScoringService.calculate_market_pulse(calm, sectors)
    volatile_result = ScoringService.calculate_market_pulse(volatile, sectors)

    assert volatile_result["risk"] > calm_result["risk"]
    assert volatile_result["score"] < calm_result["score"]


def test_market_pulse_participation_counts_moved_symbols_regardless_of_direction():
    # 3 tanesi esikte (>0.3 mutlak deger), 2 tanesi hareketsiz sayilir.
    quotes = {
        "A": {"change_percent": 1.0}, "B": {"change_percent": -1.0},
        "C": {"change_percent": 0.5}, "D": {"change_percent": 0.1}, "E": {"change_percent": -0.1},
    }
    result = ScoringService.calculate_market_pulse(quotes, [{"name": "X", "raw_val": 0.1}])
    assert result["participation"] == 60  # 3/5


def test_market_pulse_score_and_subscores_stay_within_bounds():
    quotes = {f"S{i}": {"change_percent": v} for i, v in enumerate([50, -50, 30, -30, 0, 12, -12, 8])}
    result = ScoringService.calculate_market_pulse(quotes, [{"name": "X", "raw_val": 10}])
    for key in ("score", "sentiment", "trend", "momentum", "participation", "risk"):
        assert 0 <= result[key] <= 100, f"{key} sinirlarin disinda: {result[key]}"
