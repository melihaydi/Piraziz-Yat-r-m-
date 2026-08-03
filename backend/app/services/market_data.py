import json
import logging
import os
import threading
import time
from typing import Any, Dict, List, Optional
from datetime import datetime, timezone
import borsapy
from borsapy.stream import TradingViewStream
from app.core.config import settings
from app.db.session import SessionLocal
from app.models.alert import Alert

# Symbols that don't live on the default "BIST" exchange. Used both for the
# initial bulk subscription and for the dynamic on-demand subscribe fallback
# in get_quote(), so a symbol is never accidentally subscribed under the
# wrong exchange (which TradingView then rejects with "no_such_symbol" and
# which permanently blocks the correct subscription for that symbol, since
# the underlying stream treats a symbol as "already subscribed" regardless
# of exchange).
SPECIAL_EXCHANGES: Dict[str, str] = {
    "USDTRY": "FX_IDC",
    "EURTRY": "FX_IDC",
    "XAUTRYG": "FX_IDC",
    "XAUUSD": "FX_IDC",
    "BTCUSDT": "BINANCE",
    "NDX": "NASDAQ",
    # "GOLD" under TVC is a distinct cache entry from "XAUUSD"/FX_IDC above -
    # it exists specifically so the Trade module's VİOP gold contracts can
    # price themselves off the exact same TradingView symbol (TVC:GOLD) their
    # own chart widget renders (see TradeChart.tsx's SYMBOL_OVERRIDES). Two
    # different real TradingView gold feeds (FX_IDC:XAUUSD vs TVC:GOLD) can
    # legitimately quote a few points apart, which is what caused the
    # reported "cost 4074 but chart shows 4077" mismatch - keeping the Trade
    # P&L math anchored to the same feed as the chart it's displayed next to
    # removes that discrepancy without touching XAUUSD/XAUTRYG anywhere else
    # in the app (Header, screener, etc. keep using FX_IDC as before).
    "GOLD": "TVC",
}

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
                time.sleep(0.03)
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

# Symbols with a recent "bedelsiz sermaye artırımı" (bonus/rights share
# issue) whose ratio TradingView's LIVE quote feed hasn't applied yet. The
# chart/candle feed is requested with adjustment="splits" (see
# _send_chart_subscribe in borsapy's stream.py), but the live quote feed
# (quote_add_symbols, used by get_quote() below) has no equivalent option -
# it keeps computing change/change_percent against the PRE-action
# prev_close, producing an impossible single-day move until TradingView's
# own backend catches up (observed to take up to a day or two).
#
# Confirmed live: KTLEV's %238.16 bedelsiz issue, ex-date 2026-08-03 (100
# lot -> 338 lot, SPK-approved 2026-07-29) made the raw feed report a fake
# ~-73% "crash" (real BIST daily limit is ~+-10%).
# https://www.ekonomim.com/sirketler/katilimevim-yuzde-238-bedelsiz-sermaye-artiracak-haberi-909371
#
# ratio = 1 + bonus_pct/100 (e.g. 238.16% bonus -> 3.3816x more shares,
# so the pre-action prev_close must be divided by that factor).
_CORPORATE_ACTION_RATIO: Dict[str, float] = {
    "KTLEV": 3.3816,
}
# Only correct while the raw change still looks implausible - this makes the
# fix self-disable once TradingView's feed catches up, instead of needing to
# be manually removed later (and risking a double-correction if left in).
_IMPLAUSIBLE_CHANGE_PCT_THRESHOLD = 20.0


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
        # 30 major liquid BIST stocks + extra stocks including IEYHO (Request 3 & 4!)
        allowed_list = [
            "AKBNK", "ALARK", "ASELS", "ASTOR", "BIMAS", "EKGYO", "ENKAI", "EREGL", "FROTO", "GARAN",
            "HEKTS", "ISCTR", "KCHOL", "KONTR", "KOZAL", "MGROS", "ODAS", "OYAKC", "PETKM", "PGSUS",
            "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TOASO", "TUPRS", "YKBNK", "TTKOM",
            "KTLEV", "ODINE", "GUNDG", "PASEU", "HEDEF", "BALSU", "IEYHO",
            # Added for real TEFAS fund holdings (PBR/DFI/TMV assets_distribution
            # in tefas.py) so each holding resolves to a real live quote instead
            # of a name-only placeholder - see get_fund()'s details_map.
            "OZATD", "TEHOL", "TRHOL", "ANELE", "SELEC", "PEKGY", "DSTKF", "ALKLC", "EUPWR", "TERA",
            "GESAN", "TURSG", "TRALT", "TATEN", "SKBNK", "DAPGM", "BRSAN", "MPARK", "DCTTR", "IZFAS",
            "ANSGR", "BETAE", "MOPAS", "ISKPL", "AKSEN", "KORDS", "SVGYO", "MANAS", "TMPOL", "LIDER"
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
            "PASEU": "Pasifik Eurasia Lojistik", "HEDEF": "Hedef Holding A.Ş.", "BALSU": "Balsu Gıda Sanayi",
            "IEYHO": "Işıklar Enerji ve Yapı Holding",
            "OZATD": "Özata Denizcilik Sanayi ve Ticaret A.Ş.", "TEHOL": "Tera Yatırım Teknoloji Holding A.Ş.",
            "TRHOL": "Tera Finansal Yatırımlar Holding A.Ş.", "ANELE": "Anel Elektrik Proje ve Taahhüt A.Ş.",
            "SELEC": "Selçuk Ecza Deposu Ticaret ve Sanayi A.Ş.", "PEKGY": "Peker Gayrimenkul Yatırım Ortaklığı A.Ş.",
            "DSTKF": "Destek Finans Faktoring A.Ş.", "ALKLC": "Altınkılıç Gıda ve Süt Sanayi Ticaret A.Ş.",
            "EUPWR": "Europower Enerji ve Otomasyon Teknolojileri Sanayi Ticaret A.Ş.",
            "TERA": "Tera Yatırım Menkul Değerler A.Ş.", "GESAN": "Girişim Elektrik Sanayi ve Ticaret A.Ş.",
            "TURSG": "Türkiye Sigorta A.Ş.", "TRALT": "Türk Altın İşletmeleri A.Ş.",
            "TATEN": "Tatlıpınar Enerji Üretim A.Ş.", "SKBNK": "Şekerbank T.A.Ş.",
            "DAPGM": "DAP Gayrimenkul Geliştirme A.Ş.", "BRSAN": "Borusan Mannesmann Boru Sanayi ve Ticaret A.Ş.",
            "MPARK": "MLP Sağlık Hizmetleri A.Ş.", "DCTTR": "DCT Trading Dış Ticaret A.Ş.",
            "IZFAS": "İzmir Fırça Sanayi ve Ticaret A.Ş.", "ANSGR": "Anadolu Anonim Türk Sigorta Şirketi",
            "BETAE": "Beta Enerji ve Teknoloji A.Ş.", "MOPAS": "Mopaş Marketçilik Gıda Sanayi ve Ticaret A.Ş.",
            "ISKPL": "Işık Plastik Sanayi ve Dış Ticaret Pazarlama A.Ş.", "AKSEN": "Aksa Enerji Üretim A.Ş.",
            "KORDS": "Kordsa Teknik Tekstil A.Ş.", "SVGYO": "Savur Gayrimenkul Yatırım Ortaklığı A.Ş.",
            "MANAS": "Manas Enerji Yönetimi Sanayi ve Ticaret A.Ş.",
            "TMPOL": "Temapol Polimer Plastik ve İnşaat Sanayi Ticaret A.Ş.",
            "LIDER": "LDR Turizm A.Ş.",
        }
        
        for t in allowed_list:
            self.tickers.append({
                "ticker": t,
                "name": company_names.get(t, f"{t} Ticaret A.Ş.")
            })
        logger.info(f"Loaded {len(self.tickers)} BIST 30 + Extras priority tickers.")

    def is_known_ticker(self, symbol: str) -> bool:
        """True if `symbol` is in the tracked stock universe. get_quote()
        NEVER returns None - for any unrecognized symbol it still returns a
        synthetic fallback quote, so callers that need to tell "a real
        tracked stock" apart from "an arbitrary label" (e.g. a TEFAS fund
        category like "Ters Repo", or an unrelated portfolio ticker) must
        check this BEFORE calling get_quote(), not rely on its truthiness."""
        return symbol.upper() in {t["ticker"] for t in self.tickers}

    def _initialize_stream(self) -> None:
        """Connects stream and starts background subscription manager."""
        logger.info("Connecting TradingView Stream WebSocket...")
        try:
            # Check for TradingView auth cookies. Read from the app settings (which parse
            # the project .env file) rather than os.getenv() directly - os.getenv() only
            # sees real OS environment variables, which are NOT set when the backend is
            # launched via run_dev.bat/uvicorn directly (only docker-compose's env_file
            # directive would export them), silently forcing the ~15min delayed feed.
            tv_session = settings.TV_SESSION or os.getenv("TV_SESSION")
            tv_session_sign = settings.TV_SESSION_SIGN or os.getenv("TV_SESSION_SIGN")
            if tv_session:
                import borsapy
                logger.info("Setting TradingView authentication cookies...")
                try:
                    auth_result = borsapy.set_tradingview_auth(session=tv_session, session_sign=tv_session_sign or "")
                    # If TradingView didn't return a usable auth_token, the stream silently
                    # falls back to the unauthorized/public feed, which TradingView delays by
                    # ~15 minutes. Surface this loudly instead of failing silently, since it
                    # is the most likely cause of "stale" prices on screens like Hisseler.
                    if not auth_result or not auth_result.get("auth_token"):
                        logger.warning(
                            "TradingView session cookie (TV_SESSION) did not yield a valid "
                            "auth_token. Falling back to the UNAUTHENTICATED TradingView feed, "
                            "which is delayed by ~15 minutes. Refresh TV_SESSION/TV_SESSION_SIGN "
                            "with a valid, non-expired TradingView session to restore real-time data."
                        )
                    else:
                        logger.info("TradingView authentication credentials set successfully (real-time feed enabled).")
                except Exception as auth_err:
                    logger.error(
                        f"Failed to authenticate with TradingView session cookies: {auth_err}. "
                        "Falling back to the UNAUTHENTICATED TradingView feed (~15 minute delay)."
                    )
            else:
                logger.warning(
                    "TV_SESSION not configured. Using the UNAUTHENTICATED TradingView feed, "
                    "which is delayed by ~15 minutes for all symbols."
                )

            self.stream.connect(timeout=8.0)
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
        
        # Subscribe to Bloomberg index and parity symbols first
        try:
            self.stream.subscribe("XU100")
            self.stream.subscribe("XU030")
            self.stream.subscribe("XBANK")
            self.stream.subscribe("USDTRY", exchange="FX_IDC")
            self.stream.subscribe("EURTRY", exchange="FX_IDC")
            self.stream.subscribe("XAUTRYG", exchange="FX_IDC")
            self.stream.subscribe("XAUUSD", exchange="FX_IDC")
            self.stream.subscribe("BTCUSDT", exchange="BINANCE")
            self.stream.subscribe("NDX", exchange="NASDAQ")
            self.stream.subscribe("GOLD", exchange="TVC")
            with self._lock:
                self._subscribed_set.update(["XU100", "XU030", "XBANK", "USDTRY", "EURTRY", "XAUTRYG", "XAUUSD", "BTCUSDT", "US100", "NDX", "GOLD"])
            time.sleep(0.05)
        except Exception as e:
            logger.error(f"Error subscribing to index symbols: {e}")
            
        # Prioritize major liquid stocks first (Request 4!)
        priority_tickers = {"THYAO", "EREGL", "TUPRS", "ASELS", "SISE", "AKBNK", "GARAN", "KCHOL", "SAHOL", "YKBNK", "BIMAS", "IEYHO"}
        
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
                time.sleep(0.03)
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

    def _correct_stale_corporate_action(self, symbol: str, item: Dict[str, Any]) -> None:
        """Mutates `item` in place to correct change/change_percent for a
        known-stale corporate-action ratio (see _CORPORATE_ACTION_RATIO)."""
        ratio = _CORPORATE_ACTION_RATIO.get(symbol)
        if not ratio:
            return
        raw_change_pct = item.get("change_percent")
        prev_close = item.get("prev_close")
        last = item.get("last")
        if raw_change_pct is None or not prev_close or last is None:
            return
        if abs(raw_change_pct) <= _IMPLAUSIBLE_CHANGE_PCT_THRESHOLD:
            return  # Feed has already caught up - nothing to correct.
        corrected_prev_close = prev_close / ratio
        corrected_change = last - corrected_prev_close
        item["prev_close"] = corrected_prev_close
        item["change"] = corrected_change
        item["change_percent"] = (corrected_change / corrected_prev_close) * 100

    def get_quote(self, symbol: str) -> Optional[Dict[str, Any]]:
        """Get live quote for a symbol, dynamically subscribing if not cached."""
        symbol = symbol.upper()

        # Map US100 to NDX (Request 1!)
        lookup_symbol = "NDX" if symbol == "US100" else symbol

        # 1. Try cache
        quote = self.stream.get_quote(lookup_symbol)
        if quote and quote.get("last") is not None:
            # Return the live TradingView value as-is. (Previously this block force-rescaled
            # USDTRY/EURTRY/XAUUSD/XAUTRYG/US100 back toward old hardcoded anchor prices
            # whenever the live price moved past a threshold, which is why Ons Altın,
            # Gram Altın and US100 appeared permanently stuck near stale 2024-era values.)
            item = dict(quote)
            if symbol == "US100":
                item["symbol"] = "US100"
            self._correct_stale_corporate_action(symbol, item)
            return item
            
        # 2. Subscribe dynamically in the background thread if not already triggered (non-blocking)
        need_subscribe = False
        with self._lock:
            if lookup_symbol not in self._subscribed_set:
                self._subscribed_set.add(lookup_symbol)
                need_subscribe = True

        if need_subscribe:
            # Use lookup_symbol (e.g. "NDX", not "US100") and the correct exchange for
            # non-BIST instruments. Subscribing under the wrong exchange (the old code
            # always used the "BIST" default here) makes TradingView reject the symbol
            # AND permanently blocks the correct subscription afterwards, since the
            # underlying stream treats a symbol name as "already subscribed" regardless
            # of which exchange it was (wrongly) subscribed under.
            target_exchange = SPECIAL_EXCHANGES.get(lookup_symbol, "BIST")

            def bg_subscribe():
                try:
                    self.stream.subscribe(lookup_symbol, exchange=target_exchange)
                except Exception:
                    pass
            threading.Thread(target=bg_subscribe, daemon=True).start()
            
        # Return a quick fallback estimate immediately to prevent blocking
        fallbacks = {
            "XU100": 10240.50,
            "XU030": 11580.20,
            "XBANK": 14250.00,
            "USDTRY": 33.245,
            "EURTRY": 36.180,
            "XAUTRYG": 2550.40,
            "XAUUSD": 2410.60,
            "GOLD": 2410.60,
            "BTCUSDT": 66250.00,
            "US100": 19820.00
        }
        default_val = fallbacks.get(symbol, 150.0)
        logger.warning(
            f"No live quote cached yet for {symbol} - serving hardcoded fallback "
            f"price ({default_val}) while the TradingView subscription connects. "
            f"If this keeps appearing for the same symbol, the live feed for it "
            f"is stuck and prices/P&L for that symbol are stale."
        )

        return {
            "symbol": symbol,
            "exchange": "BIST",
            "last": default_val,
            "change": 0.0,
            "change_percent": 0.0,
            "open": default_val,
            "high": default_val,
            "low": default_val,
            "prev_close": default_val,
            "volume": 0,
            "bid": default_val,
            "ask": default_val,
            "market_cap": 0,
            "pe_ratio": 10.0,
            "eps": 15.0,
            "description": f"{symbol} Details"
        }

    def get_all_quotes(self) -> Dict[str, Dict[str, Any]]:
        """Get all cached quotes from the live stream, as-is (no artificial
        rescaling) other than the same stale-corporate-action correction
        get_quote() applies - screener/heatmap callers use this bulk method,
        not get_quote(), so the correction has to be applied here too."""
        quotes = self.stream.get_all_quotes()
        for symbol, item in quotes.items():
            self._correct_stale_corporate_action(symbol, item)
        return quotes

    def get_candles(self, symbol: str, interval: str, count: Optional[int] = None, wait: bool = True, subscribe: bool = True) -> List[Dict[str, Any]]:
        """Fetch historical/real-time candles for chart plotting."""
        symbol = symbol.upper()
        interval = interval.lower()

        # Check cache first
        candles = self.stream.get_candles(symbol, interval, count)
        if not candles and subscribe:
            logger.info(f"Cache empty. Subscribing to chart session for {symbol} ({interval})")
            # The underlying TradingViewStream only supports ONE active chart
            # series at a time (see patched_subscribe_chart above) - it's a
            # single shared "$prices" session, not one per symbol. Previously
            # only the subscribe_chart() call itself was inside self._lock;
            # wait_for_candle() ran AFTER releasing it, so if a second request
            # for a DIFFERENT symbol came in while the first was still waiting
            # (e.g. the user clicking between two stocks quickly, or the
            # frontend's self-healing chart retry overlapping a fresh
            # selection), that second call could reset the shared session out
            # from under the first one - whichever symbol's create_series
            # message reached TradingView last silently "won", so the first
            # chart could end up stuck showing the wrong symbol's data until
            # reopened. Holding the lock for the entire subscribe+wait+re-read
            # sequence serializes concurrent chart requests instead of letting
            # them interleave and corrupt each other's session state.
            with self._lock:
                self.stream.subscribe_chart(symbol, interval)

                if wait:
                    try:
                        self.stream.wait_for_candle(symbol, interval, timeout=3.0)
                    except Exception as e:
                        logger.warning(f"Timeout waiting for first candle on {symbol} ({interval}): {e}")

                    # Re-read cache after wait
                    candles = self.stream.get_candles(symbol, interval, count)

        return candles or []

# Global singleton instance
market_data_service = MarketDataService()
