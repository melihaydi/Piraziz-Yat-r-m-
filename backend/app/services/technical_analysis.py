import math
from typing import Any, Dict, List, Optional, Tuple

class TechnicalAnalysisService:
    @staticmethod
    def calculate_sma(prices: List[float], period: int) -> List[Optional[float]]:
        """Calculate Simple Moving Average (SMA)."""
        sma: List[Optional[float]] = [None] * len(prices)
        if len(prices) < period:
            return sma
            
        current_sum = sum(prices[:period])
        sma[period - 1] = current_sum / period
        
        for i in range(period, len(prices)):
            current_sum = current_sum - prices[i - period] + prices[i]
            sma[i] = current_sum / period
            
        return sma

    @staticmethod
    def calculate_ema(prices: List[float], period: int) -> List[Optional[float]]:
        """Calculate Exponential Moving Average (EMA)."""
        ema: List[Optional[float]] = [None] * len(prices)
        if len(prices) < period:
            return ema

        # First value is the SMA
        sma_start = sum(prices[:period]) / period
        ema[period - 1] = sma_start
        
        multiplier = 2 / (period + 1)
        for i in range(period, len(prices)):
            ema[i] = (prices[i] - ema[i - 1]) * multiplier + ema[i - 1]
            
        return ema

    @staticmethod
    def calculate_rsi(prices: List[float], period: int = 14) -> List[Optional[float]]:
        """Calculate Relative Strength Index (RSI)."""
        rsi: List[Optional[float]] = [None] * len(prices)
        if len(prices) <= period:
            return rsi

        # Calculate gains and losses
        gains = []
        losses = []
        for i in range(1, len(prices)):
            diff = prices[i] - prices[i - 1]
            if diff > 0:
                gains.append(diff)
                losses.append(0.0)
            else:
                gains.append(0.0)
                losses.append(abs(diff))

        # Initial average gain and loss
        avg_gain = sum(gains[:period]) / period
        avg_loss = sum(losses[:period]) / period

        if avg_loss == 0:
            rsi[period] = 100.0
        else:
            rs = avg_gain / avg_loss
            rsi[period] = 100.0 - (100.0 / (1.0 + rs))

        # Calculate subsequent values using Wilder's smoothing technique
        for i in range(period + 1, len(prices)):
            gain = gains[i - 1]
            loss = losses[i - 1]
            
            avg_gain = (avg_gain * (period - 1) + gain) / period
            avg_loss = (avg_loss * (period - 1) + loss) / period

            if avg_loss == 0:
                rsi[i] = 100.0
            else:
                rs = avg_gain / avg_loss
                rsi[i] = 100.0 - (100.0 / (1.0 + rs))

        return rsi

    @staticmethod
    def calculate_macd(
        prices: List[float], 
        fast_period: int = 12, 
        slow_period: int = 26, 
        signal_period: int = 9
    ) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
        """Calculate MACD Line, Signal Line, and Histogram."""
        macd_line: List[Optional[float]] = [None] * len(prices)
        signal_line: List[Optional[float]] = [None] * len(prices)
        histogram: List[Optional[float]] = [None] * len(prices)

        if len(prices) < slow_period:
            return macd_line, signal_line, histogram

        fast_ema = TechnicalAnalysisService.calculate_ema(prices, fast_period)
        slow_ema = TechnicalAnalysisService.calculate_ema(prices, slow_period)

        # Calculate MACD Line = Fast EMA - Slow EMA
        for i in range(slow_period - 1, len(prices)):
            if fast_ema[i] is not None and slow_ema[i] is not None:
                macd_line[i] = fast_ema[i] - slow_ema[i]

        # Extract non-None MACD values to calculate its EMA (Signal Line)
        valid_macd_start = slow_period - 1
        valid_macd_values = [v for v in macd_line[valid_macd_start:] if v is not None]

        if len(valid_macd_values) < signal_period:
            return macd_line, signal_line, histogram

        macd_ema = TechnicalAnalysisService.calculate_ema(valid_macd_values, signal_period)

        # Map Signal Line and Histogram back to original index space
        for i in range(len(macd_ema)):
            original_idx = valid_macd_start + signal_period - 1 + i
            sig_val = macd_ema[signal_period - 1 + i] if (signal_period - 1 + i) < len(macd_ema) else None
            
            if sig_val is not None:
                signal_line[original_idx] = sig_val
                mac_val = macd_line[original_idx]
                if mac_val is not None:
                    histogram[original_idx] = mac_val - sig_val

        return macd_line, signal_line, histogram

    @staticmethod
    def calculate_bollinger_bands(
        prices: List[float], 
        period: int = 20, 
        num_std: float = 2.0
    ) -> Tuple[List[Optional[float]], List[Optional[float]], List[Optional[float]]]:
        """Calculate Bollinger Bands (Middle, Upper, Lower)."""
        middle_band = TechnicalAnalysisService.calculate_sma(prices, period)
        upper_band: List[Optional[float]] = [None] * len(prices)
        lower_band: List[Optional[float]] = [None] * len(prices)

        if len(prices) < period:
            return middle_band, upper_band, lower_band

        for i in range(period - 1, len(prices)):
            slice_prices = prices[i - period + 1 : i + 1]
            mean = middle_band[i]
            
            if mean is not None:
                variance = sum((x - mean) ** 2 for x in slice_prices) / period
                std_dev = math.sqrt(variance)
                upper_band[i] = mean + (num_std * std_dev)
                lower_band[i] = mean - (num_std * std_dev)

        return middle_band, upper_band, lower_band

    @staticmethod
    def calculate_atr(
        highs: List[float], 
        lows: List[float], 
        closes: List[float], 
        period: int = 14
    ) -> List[Optional[float]]:
        """Calculate Average True Range (ATR)."""
        atr: List[Optional[float]] = [None] * len(closes)
        if len(closes) < period:
            return atr

        # Calculate True Range (TR)
        tr = [0.0] * len(closes)
        tr[0] = highs[0] - lows[0]
        
        for i in range(1, len(closes)):
            tr[i] = max(
                highs[i] - lows[i],
                abs(highs[i] - closes[i - 1]),
                abs(lows[i] - closes[i - 1])
            )

        # Initial ATR is the average of first N True Ranges
        atr[period - 1] = sum(tr[:period]) / period

        # Subsequent ATR using Wilder's smoothing
        for i in range(period, len(closes)):
            atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period

        return atr

    @staticmethod
    def detect_support_resistance(
        highs: List[float], 
        lows: List[float], 
        window: int = 5
    ) -> Dict[str, List[float]]:
        """Find local extrema to identify key Support and Resistance levels."""
        supports: List[float] = []
        resistances: List[float] = []
        
        n = len(highs)
        if n < (window * 2 + 1):
            return {"supports": supports, "resistances": resistances}

        for i in range(window, n - window):
            # Check local low (Support)
            is_support = True
            for j in range(i - window, i + window + 1):
                if lows[j] < lows[i]:
                    is_support = False
                    break
            if is_support and lows[i] not in supports:
                supports.append(lows[i])

            # Check local high (Resistance)
            is_resistance = True
            for j in range(i - window, i + window + 1):
                if highs[j] > highs[i]:
                    is_resistance = False
                    break
            if is_resistance and highs[i] not in resistances:
                resistances.append(highs[i])

        return {
            "supports": sorted(supports),
            "resistances": sorted(resistances)
        }

    @staticmethod
    def detect_candlestick_patterns(
        open_p: List[float], 
        high_p: List[float], 
        low_p: List[float], 
        close_p: List[float]
    ) -> List[Dict[str, Any]]:
        """Identify key candlestick patterns in the latest bars."""
        patterns: List[Dict[str, Any]] = []
        n = len(close_p)
        if n < 2:
            return patterns

        # Check latest 3 bars
        for i in range(max(1, n - 3), n):
            op = open_p[i]
            hp = high_p[i]
            lp = low_p[i]
            cp = close_p[i]
            
            body = abs(cp - op)
            candle_range = hp - lp
            if candle_range == 0:
                continue

            # 1. Doji (Body size <= 10% of total candle range)
            if body <= (candle_range * 0.1):
                patterns.append({
                    "bar_index": i,
                    "pattern": "Doji",
                    "type": "Nötr",
                    "description": "Kararsız piyasa dengesi, trend dönüş işareti olabilir."
                })

            # 2. Hammer / Inverted Hammer
            # Hammer: Body in upper 30% of range, long lower wick (>= 2x body), short upper wick
            lower_wick = min(op, cp) - lp
            upper_wick = hp - max(op, cp)
            
            if body > 0:
                if lower_wick >= (2 * body) and upper_wick <= (0.2 * candle_range):
                    patterns.append({
                        "bar_index": i,
                        "pattern": "Çekiç (Hammer)",
                        "type": "Boğa (Bullish)",
                        "description": "Dipte güçlü alım baskısı, yükseliş dönüş işareti."
                    })
                elif upper_wick >= (2 * body) and lower_wick <= (0.2 * candle_range):
                    patterns.append({
                        "bar_index": i,
                        "pattern": "Ters Çekiç (Inverted Hammer)",
                        "type": "Boğa (Bullish)",
                        "description": "Alıcıların fiyatı yukarı itme çabası, dönüş sinyali."
                    })

            # 3. Engulfing (Bullish / Bearish Engulfing relative to previous bar)
            op_prev = open_p[i - 1]
            cp_prev = close_p[i - 1]
            
            # Bullish Engulfing: Prev was red, curr is green, curr body wraps prev body
            if cp_prev < op_prev and cp > op:
                if op <= cp_prev and cp >= op_prev:
                    patterns.append({
                        "bar_index": i,
                        "pattern": "Yutan Boğa (Bullish Engulfing)",
                        "type": "Boğa (Bullish)",
                        "description": "Alıcılar satıcıları tamamen domine etti, yükseliş trendi başlangıcı olabilir."
                    })
            # Bearish Engulfing: Prev was green, curr is red, curr body wraps prev body
            elif cp_prev > op_prev and cp < op:
                if op >= cp_prev and cp <= op_prev:
                    patterns.append({
                        "bar_index": i,
                        "pattern": "Yutan Ayı (Bearish Engulfing)",
                        "type": "Ayı (Bearish)",
                        "description": "Satıcılar alıcıları tamamen domine etti, düşüş trendi başlangıcı olabilir."
                    })

        return patterns

    @staticmethod
    def calculate_vwap(
        highs: List[float], 
        lows: List[float], 
        closes: List[float], 
        volumes: List[float]
    ) -> List[Optional[float]]:
        """Calculate Volume Weighted Average Price (VWAP)."""
        vwap: List[Optional[float]] = []
        cumulative_pv = 0.0
        cumulative_vol = 0.0
        for h, l, c, v in zip(highs, lows, closes, volumes):
            typical_price = (h + l + c) / 3.0
            cumulative_pv += typical_price * v
            cumulative_vol += v
            if cumulative_vol == 0:
                vwap.append(typical_price)
            else:
                vwap.append(cumulative_pv / cumulative_vol)
        return vwap

    @staticmethod
    def calculate_momentum(closes: List[float], period: int = 10) -> List[Optional[float]]:
        """Calculate Momentum (Rate of Change)."""
        momentum: List[Optional[float]] = [None] * len(closes)
        if len(closes) <= period:
            return momentum
        for i in range(period, len(closes)):
            momentum[i] = closes[i] - closes[i - period]
        return momentum

    @staticmethod
    def calculate_adx(highs: List[float], lows: List[float], closes: List[float], period: int = 14) -> List[Optional[float]]:
        """Calculate Average Directional Index (ADX) to determine trend strength."""
        adx: List[Optional[float]] = [None] * len(closes)
        n = len(closes)
        if n < (period * 2):
            return adx
        
        tr = [0.0] * n
        plus_dm = [0.0] * n
        minus_dm = [0.0] * n
        
        tr[0] = highs[0] - lows[0]
        for i in range(1, n):
            up_move = highs[i] - highs[i-1]
            down_move = lows[i-1] - lows[i]
            
            tr[i] = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
            
            if up_move > down_move and up_move > 0:
                plus_dm[i] = up_move
            else:
                plus_dm[i] = 0.0
                
            if down_move > up_move and down_move > 0:
                minus_dm[i] = down_move
            else:
                minus_dm[i] = 0.0
                
        atr_s = [0.0] * n
        plus_di = [0.0] * n
        minus_di = [0.0] * n
        
        atr_s[period-1] = sum(tr[:period])
        plus_dm_s = sum(plus_dm[:period])
        minus_dm_s = sum(minus_dm[:period])
        
        for i in range(period, n):
            atr_s[i] = atr_s[i-1] - (atr_s[i-1] / period) + tr[i]
            plus_dm_s = plus_dm_s - (plus_dm_s / period) + plus_dm[i]
            minus_dm_s = minus_dm_s - (minus_dm_s / period) + minus_dm[i]
            
            if atr_s[i] > 0:
                plus_di[i] = 100 * (plus_dm_s / atr_s[i])
                minus_di[i] = 100 * (minus_dm_s / atr_s[i])
                
        dx = [0.0] * n
        for i in range(period, n):
            di_sum = plus_di[i] + minus_di[i]
            di_diff = abs(plus_di[i] - minus_di[i])
            dx[i] = (di_diff / di_sum * 100) if di_sum > 0 else 0.0
            
        adx_sum = sum(dx[period:period*2]) / period
        adx[period*2 - 1] = adx_sum
        for i in range(period*2, n):
            adx_sum = (adx_sum * (period - 1) + dx[i]) / period
            adx[i] = adx_sum
            
        return adx

    @staticmethod
    def calculate_supertrend(highs: List[float], lows: List[float], closes: List[float], period: int = 10, multiplier: float = 3.0) -> Tuple[List[Optional[float]], List[str]]:
        """Calculate Supertrend line and buy/sell signals."""
        n = len(closes)
        st_line: List[Optional[float]] = [None] * n
        st_signal: List[str] = ["Takip Et"] * n
        if n < period:
            return st_line, st_signal
            
        atr = TechnicalAnalysisService.calculate_atr(highs, lows, closes, period)
        
        basic_ub = [0.0] * n
        basic_lb = [0.0] * n
        final_ub = [0.0] * n
        final_lb = [0.0] * n
        trend = [1] * n
        
        for i in range(n):
            val_atr = atr[i] or 0.0
            hl_avg = (highs[i] + lows[i]) / 2.0
            basic_ub[i] = hl_avg + (multiplier * val_atr)
            basic_lb[i] = hl_avg - (multiplier * val_atr)
            
        for i in range(1, n):
            if basic_ub[i] < final_ub[i-1] or closes[i-1] > final_ub[i-1]:
                final_ub[i] = basic_ub[i]
            else:
                final_ub[i] = final_ub[i-1]
                
            if basic_lb[i] > final_lb[i-1] or closes[i-1] < final_lb[i-1]:
                final_lb[i] = basic_lb[i]
            else:
                final_lb[i] = final_lb[i-1]
                
            if trend[i-1] == 1:
                if closes[i] < final_lb[i]:
                    trend[i] = -1
                else:
                    trend[i] = 1
            else:
                if closes[i] > final_ub[i]:
                    trend[i] = 1
                else:
                    trend[i] = -1
                    
            st_line[i] = final_lb[i] if trend[i] == 1 else final_ub[i]
            st_signal[i] = "AL" if trend[i] == 1 else "SAT"
            
        return st_line, st_signal

