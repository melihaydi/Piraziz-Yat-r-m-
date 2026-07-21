import pytest
from app.services.technical_analysis import TechnicalAnalysisService

def test_sma_calculation():
    prices = [10.0, 12.0, 14.0, 16.0, 18.0, 20.0]
    # SMA 3
    sma_3 = TechnicalAnalysisService.calculate_sma(prices, 3)
    assert len(sma_3) == len(prices)
    assert sma_3[0] is None
    assert sma_3[1] is None
    assert sma_3[2] == pytest.approx(12.0)  # (10+12+14)/3
    assert sma_3[3] == pytest.approx(14.0)  # (12+14+16)/3
    assert sma_3[4] == pytest.approx(16.0)  # (14+16+18)/3
    assert sma_3[5] == pytest.approx(18.0)  # (16+18+20)/3

def test_ema_calculation():
    prices = [10.0, 12.0, 14.0, 16.0, 18.0]
    # EMA 3
    ema_3 = TechnicalAnalysisService.calculate_ema(prices, 3)
    assert len(ema_3) == len(prices)
    assert ema_3[0] is None
    assert ema_3[1] is None
    assert ema_3[2] == pytest.approx(12.0)  # SMA of first 3 elements: (10+12+14)/3
    
    # multiplier = 2 / (3 + 1) = 0.5
    # ema[3] = (16 - 12) * 0.5 + 12 = 14
    assert ema_3[3] == pytest.approx(14.0)
    
    # ema[4] = (18 - 14) * 0.5 + 14 = 16
    assert ema_3[4] == pytest.approx(16.0)

def test_rsi_calculation():
    # Price constantly goes up
    prices_up = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]
    rsi_up = TechnicalAnalysisService.calculate_rsi(prices_up, 5)
    assert rsi_up[5] == pytest.approx(100.0)
    assert rsi_up[15] == pytest.approx(100.0)

    # Price constantly goes down
    prices_down = [25, 24, 23, 22, 21, 20, 19, 18, 17, 16, 15, 14, 13, 12, 11, 10]
    rsi_down = TechnicalAnalysisService.calculate_rsi(prices_down, 5)
    assert rsi_down[5] == pytest.approx(0.0)
    assert rsi_down[15] == pytest.approx(0.0)

def test_macd_calculation():
    prices = [10 + i * 0.5 for i in range(40)]
    macd, signal, hist = TechnicalAnalysisService.calculate_macd(prices, 12, 26, 9)
    assert len(macd) == len(prices)
    assert len(signal) == len(prices)
    assert len(hist) == len(prices)
    # Check that early periods are padded with None
    assert macd[0] is None
    assert signal[0] is None
    assert hist[0] is None

def test_bollinger_bands():
    prices = [10, 12, 11, 13, 12, 14, 13, 15, 14, 16, 15, 17, 16, 18, 17, 19, 18, 20, 19, 21, 20, 22, 21, 23, 22]
    mid, upper, lower = TechnicalAnalysisService.calculate_bollinger_bands(prices, 10, 2)
    
    assert len(mid) == len(prices)
    assert len(upper) == len(prices)
    assert len(lower) == len(prices)
    
    for i in range(9, len(prices)):
        assert mid[i] is not None
        assert upper[i] is not None
        assert lower[i] is not None
        assert upper[i] > mid[i]
        assert lower[i] < mid[i]

def test_atr_calculation():
    highs = [12, 14, 13, 15, 16, 18, 17, 19, 20, 22, 21, 23, 24, 26, 25, 27]
    lows = [10, 11, 10, 12, 13, 15, 14, 16, 17, 19, 18, 20, 21, 23, 22, 24]
    closes = [11, 13, 12, 14, 15, 17, 16, 18, 19, 21, 20, 22, 23, 25, 24, 26]
    
    atr = TechnicalAnalysisService.calculate_atr(highs, lows, closes, 5)
    assert len(atr) == len(closes)
    assert atr[0] is None
    assert atr[4] is not None
    assert atr[-1] > 0

def test_support_resistance():
    highs = [10, 11, 12, 11, 10, 9, 8, 9, 10, 11, 12, 13, 14, 13, 12]
    lows =  [8,  9,  10, 9,  8,  7, 6, 7, 8,  9,  10, 11, 12, 11, 10]
    
    levels = TechnicalAnalysisService.detect_support_resistance(highs, lows, window=2)
    
    assert len(levels["supports"]) > 0
    assert len(levels["resistances"]) > 0
    # Peak at index 2 (high=12) is a resistance
    assert 12 in levels["resistances"]
    # Trough at index 6 (low=6) is a support
    assert 6 in levels["supports"]

def test_candlestick_patterns():
    # Doji Pattern (Body is very small)
    opens =  [100.0, 100.0]
    highs =  [105.0, 105.0]
    lows =   [95.0, 95.0]
    closes = [101.0, 100.1]
    
    patterns = TechnicalAnalysisService.detect_candlestick_patterns(opens, highs, lows, closes)
    assert any(p["pattern"] == "Doji" for p in patterns)

    # Bullish Engulfing Pattern
    # Bar 0: Red (open=100, close=95)
    # Bar 1: Green (open=94, close=101) - wraps Bar 0 body
    opens_eng =  [100.0, 94.0]
    highs_eng =  [102.0, 102.0]
    lows_eng =   [94.0,  93.0]
    closes_eng = [95.0,  101.0]

    patterns_eng = TechnicalAnalysisService.detect_candlestick_patterns(opens_eng, highs_eng, lows_eng, closes_eng)
    assert any(p["pattern"] == "Yutan Boğa (Bullish Engulfing)" for p in patterns_eng)
