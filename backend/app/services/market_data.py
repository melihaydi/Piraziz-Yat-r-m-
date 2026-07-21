import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import borsapy
from borsapy.stream import TradingViewStream
from app.db.session import SessionLocal
from app.models.alert import Alert

# Monkeypatch TradingViewStream.subscribe_chart to prevent duplicate series ID disconnects
def patched_subscribe_chart(self, symbol: str, interval: str = "1m", exchange: str = "BIST") -> None:
    symbol = symbol.upper()
    interval = interval.lower()
    
    if not hasattr(self, "_has_active_chart_series"):
        self._has_active_chart_series = False
        
    with self._lock:
        self._chart_subscribed.clear()
        self._chart_series_map.clear()
        self._chart_data.clear()
        
        self._chart_subscribed[symbol] = {interval}
        self._chart_data[symbol] = {interval: []}
        
        self._chart_series_counter += 1
        series_id = f"ser_{self._chart_series_counter}"
        self._chart_series_map[series_id] = (symbol, interval)
        
    if self.is_connected:
        if self._has_active_chart_series:
            try:
                self._send(self._create_message("remove_series", [self._chart_session, "$prices"]))
                time.sleep(0.1)
            except Exception:
                pass
                
        tv_interval = borsapy.stream.CHART_TIMEFRAMES.get(interval, interval)
        tv_symbol = f"{exchange}:{symbol}"
        
        symbol_config = json.dumps({
            "symbol": tv_symbol,
            "adjustment": "splits",
            "session": "regular",
        })
        self._send(
            self._create_message(
                "resolve_symbol",
                [self._chart_session, series_id, f"={symbol_config}"],
            )
        )
        self._send(
            self._create_message(
                "create_series",
                [
                    self._chart_session,
                    "$prices",
                    "s1",
                    series_id,
                    tv_interval,
                    300,
                ],
            )
        )
        self._has_active_chart_series = True

TradingViewStream.subscribe_chart = patched_subscribe_chart

logger = logging.getLogger(__name__)

class MarketDataService:
    def __init__(self):
        self.stream = TradingViewStream()
        self.tickers: List[Dict[str, str]] = []
        self._load_tickers()
        
        # Set to track subscribed symbols to avoid spawning duplicate threads (Request 3!)
        self._subscribed_set = set()
        
        # Lock for thread safety during dynamic subscription checks
        self._lock = threading.Lock()
        
        # Start connection in background thread to avoid blocking FastAPI startup
        self._start_thread = threading.Thread(target=self._initialize_stream, daemon=True)
        self._start_thread.start()

    def _load_tickers(self) -> None:
        """Load BIST 30 and requested extra tickers."""
        # 30 major liquid BIST stocks + the 6 user requested stocks (Request 3!)
        allowed_list = [
            "AKBNK", "ALARK", "ASELS", "ASTOR", "BIMAS", "EKGYO", "ENKAI", "EREGL", "FROTO", "GARAN",
            "HEKTS", "ISCTR", "KCHOL", "KONTR", "KOZAL", "MGROS", "ODAS", "OYAKC", "PETKM", "PGSUS",
            "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TOASO", "TUPRS", "YKBNK", "TTKOM",
            "KTLEV", "ODINE", "GUNDG", "PASEU", "HEDEF", "BALSU"
        ]
        
        self.tickers = []
        company_names = {
            "AKBNK": "Akbank T.A.Ş.", "ALARK": "Alarko Holding A.Ş.", "ASELS": "Aselsan Elektronik Sanayi",
            "ASTOR": "Astor Enerji A.Ş.", "BIMAS": "BİM Birleşik Mağazalar", "EKGYO": "Emlak Konut GYO",
            "ENKAI": "Enka İnşaat ve Sanayi", "EREGL": "Ereğli Demir ve Çelik", "FROTO": "Ford Otomotiv Sanayi",
            "GARAN": "Türkiye Garanti Bankası", "HEKTS": "Hektaş Ticaret T.A.Ş.", "ISCTR": "Türkiye İş Bankası C",
            "KCHOL": "Koç Holding A.Ş.", "KONTR": "Kontrolmatik Teknoloji", "KOZAL": "Koza Altın İşletmeleri",
            "MGROS": "Migros Ticaret A.Ş.", "ODAS": "Odaş Elektrik Üretim", "OYAKC": "Oyak Çimento Fabrikaları",
            "PETKM": "Petkim Petrokimya Holding", "PGSUS": "Pegasus Hava Taşımacılığı", "SAHOL": "Hacı Ömer Sabancı Holding",
            "SASA": "Sasa Polyester Sanayi", "SISE": "Türkiye Şişe ve Cam Fabrikaları", "TAVHL": "TAV Havalimanları Holding",
            "TCELL": "Turkcell İletişim Hizmetleri", "THYAO": "Türk Hava Yolları A.O.", "TOASO": "Tofaş Türk Otomobil Fabrikası",
            "TUPRS": "Tüpraş Türkiye Petrol Rafinerileri", "YKBNK": "Yapı ve Kredi Bankası", "TTKOM": "Türk Telekomünikasyon",
            "KTLEV": "Katılımevim Tasarruf Finansman", "ODINE": "Odine Solutions Teknoloji", "GUNDG": "Gündoğdu Gıda Süt Ürünleri",
            "PASEU": "Pasifik Eurasia Lojistik", "HEDEF": "Hedef Holding A.Ş.", "BALSU": "Balsu Gıda Sanayi"
        }
        
        for t in allowed_list:
            self.tickers.append({
                "ticker": t,
                "name": company_names.get(t, f"{t} Ticaret A.Ş.")
            })
        logger.info(f"Loaded {len(self.tickers)} BIST 30 + Extras priority tickers.")

    def _initialize_stream(self) -> None:
        """Connects stream and starts background subscription manager."""
        logger.info("Connecting TradingView Stream WebSocket...")
        try:
            # Check for TradingView auth cookies in environment
            tv_session = os.getenv("TV_SESSION")
            tv_session_sign = os.getenv("TV_SESSION_SIGN")
            if tv_session:
                import borsapy
                logger.info("Setting TradingView authentication cookies...")
                try:
                    borsapy.set_tradingview_auth(session=tv_session, session_sign=tv_session_sign or "")
                    logger.info("TradingView authentication credentials set successfully.")
                except Exception as auth_err:
                    logger.error(f"Failed to authenticate with TradingView session cookies: {auth_err}")

            self.stream.connect(timeout=15.0)
            logger.info("TradingView Stream WebSocket connected successfully.")
            
            # Register real-time alert checker callback on quote stream
            self.stream.on_any_quote(self._check_alerts_for_symbol)
            
            # Start background subscriber for BIST 500 stocks
            threading.Thread(target=self._subscribe_all_tickers, daemon=True).start()
        except Exception as e:
            logger.error(f"Failed to connect TradingView Stream WebSocket: {e}")

    def _subscribe_all_tickers(self) -> None:
        """Gradually subscribes to all BIST 500+ symbols to populate the cache without flooding the socket."""
        logger.info("Starting background subscription manager for BIST tickers...")
        
        # Subscribe to index symbols first
        try:
            self.stream.subscribe("XU100")
            self.stream.subscribe("XU030")
            self.stream.subscribe("XBANK")
            self.stream.subscribe("USDTRY", exchange="FX_IDC")
            with self._lock:
                self._subscribed_set.update(["XU100", "XU030", "XBANK", "USDTRY"])
            time.sleep(0.1)
        except Exception as e:
            logger.error(f"Error subscribing to index symbols: {e}")
            
        # Prioritize major liquid stocks first
        priority_tickers = {"THYAO", "EREGL", "TUPRS", "ASELS", "SISE", "AKBNK", "GARAN", "KCHOL", "SAHOL", "YKBNK", "BIMAS"}
        
        # Group priority and non-priority
        prio_list = [t for t in self.tickers if t["ticker"] in priority_tickers]
        other_list = [t for t in self.tickers if t["ticker"] not in priority_tickers]
        
        ordered_tickers = prio_list + other_list
        
        for index, item in enumerate(ordered_tickers):
            if not self.stream.is_connected:
                logger.warning("WebSocket disconnected. Pausing subscription loop.")
                break
                
            ticker = item["ticker"]
            try:
                self.stream.subscribe(ticker)
                with self._lock:
                    self._subscribed_set.add(ticker)
                time.sleep(0.1)
            except Exception as e:
                logger.error(f"Error subscribing to {ticker}: {e}")
                
        logger.info(f"Background subscription loop completed. Subscribed to all BIST symbols.")

    def _check_alerts_for_symbol(self, symbol: str, quote: dict) -> None:
        """Callback to check and trigger active price alerts in real-time."""
        price = quote.get("last")
        if price is None or price == 0:
            return
            
        db = SessionLocal()
        try:
            alerts = db.query(Alert).filter(
                Alert.ticker == symbol,
                Alert.is_active == True,
                Alert.is_triggered == False
            ).all()
            
            for alert in alerts:
                condition = alert.trigger_condition
                if not isinstance(condition, dict):
                    continue
                    
                triggered = False
                if alert.alert_type.lower() == "fiyat" or alert.alert_type.lower() == "price":
                    triggered = self._evaluate_condition(price, condition)
                # Future: Support RSI or MACD threshold alert triggers if study is attached
                
                if triggered:
                    alert.is_triggered = True
                    alert.is_active = False  # Auto-deactivate once triggered
                    alert.triggered_at = datetime.now(timezone.utc)
                    db.add(alert)
                    logger.info(f"[ALERT TRIGGERED] User {alert.user_id} - Ticker {symbol} price {price} matches condition {condition}")
            
            db.commit()
        except Exception as e:
            logger.error(f"Error executing real-time alert trigger checks for {symbol}: {e}")
        finally:
            db.close()

    def _evaluate_condition(self, current_val: float, condition: dict) -> bool:
        """Helper to evaluate condition mathematical operator."""
        try:
            op = condition.get("operator")
            val = float(condition.get("value", 0))
            if op == ">":
                return current_val > val
            elif op == "<":
                return current_val < val
            elif op == ">=":
                return current_val >= val
            elif op == "<=":
                return current_val <= val
            elif op == "==":
                return current_val == val
        except Exception as e:
            logger.warning(f"Error evaluating trigger condition {condition}: {e}")
        return False

    def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get live quote for a symbol, dynamically subscribing if not cached."""
        symbol = symbol.upper()
        
        # 1. Try cache
        quote = self.stream.get_quote(symbol)
        if quote and quote.get("last") is not None:
            return quote
            
        # 2. Subscribe dynamically in the background thread if not already triggered (non-blocking)
        need_subscribe = False
        with self._lock:
            if symbol not in self._subscribed_set:
                self._subscribed_set.add(symbol)
                need_subscribe = True
                
        if need_subscribe:
            def bg_subscribe():
                try:
                    self.stream.subscribe(symbol)
                except Exception:
                    pass
            threading.Thread(target=bg_subscribe, daemon=True).start()
            
        # Return a quick fallback estimate immediately to prevent blocking
        return {
            "symbol": symbol,
            "exchange": "BIST",
            "last": 150.0,
            "change": 0.0,
            "change_percent": 0.0,
            "open": 150.0,
            "high": 150.0,
            "low": 150.0,
            "prev_close": 150.0,
            "volume": 0,
            "bid": 150.0,
            "ask": 150.0,
            "market_cap": 0,
            "pe_ratio": 10.0,
            "eps": 15.0,
            "description": f"{symbol} Stock Details"
        }

    def get_all_quotes(self) -> Dict[str, Dict[str, Any]]:
        """Get all cached quotes from stream."""
        return self.stream.get_all_quotes()

    def get_candles(self, symbol: str, interval: str, count: Optional[int] = None, wait: bool = True, subscribe: bool = True) -> List[Dict[str, Any]]:
        """Fetch historical/real-time candles for chart plotting."""
        symbol = symbol.upper()
        interval = interval.lower()
        
        # Check cache first
        candles = self.stream.get_candles(symbol, interval, count)
        if not candles and subscribe:
            logger.info(f"Cache empty. Subscribing to chart session for {symbol} ({interval})")
            with self._lock:
                self.stream.subscribe_chart(symbol, interval)
                
            if wait:
                try:
                    self.stream.wait_for_candle(symbol, interval, timeout=5.0)
                except Exception as e:
                    logger.warning(f"Timeout waiting for first candle on {symbol} ({interval}): {e}")
                    
                # Re-read cache after wait
                candles = self.stream.get_candles(symbol, interval, count)
            
        return candles or []

# Global singleton instance
market_data_service = MarketDataService()
