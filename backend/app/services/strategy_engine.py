"""
Frantic Algoritmik Strateji - price-action signal engine for BIST30.

Architecture note (why this doesn't reuse market_data_service's live
websocket cache): MarketDataService's candle fetching goes through a single
shared TradingView chart *session* (see market_data.py's patched
subscribe_chart docstring) - only one symbol's candle history can be
"active" on it at a time, serialized behind a lock. Scanning 30 symbols
through that path would mean ~30 sequential subscribe+wait cycles (each up
to a few seconds), which directly conflicts with "fast, live scanning".

borsapy.Ticker(symbol).history(...) is a separate, ordinary REST-based
fetch with no shared session - completely safe to run concurrently across
all 30 symbols via a thread pool, the same pattern already used elsewhere
in this codebase (portfolio.py, trade_service.py) for concurrent price
fetches. That's what this module uses instead, keeping candle data and the
live quote/order-book system fully independent.

Everything here is computed from real OHLCV data and borsapy's own
TradingView-technical-rating endpoint (ta_signals) - there is no fabricated
or placeholder signal data. See STRATEGY_NOTES at the bottom of this file
for the scope/limitations of the heuristics used (documented for the
deliverables report, not read by the API).
"""
import logging
import threading
import time
from concurrent.futures import ThreadPoolExecutor, as_completed
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import borsapy

logger = logging.getLogger(__name__)

BIST30_TICKERS = [
    "AKBNK", "ALARK", "ASELS", "ASTOR", "BIMAS", "EKGYO", "ENKAI", "EREGL", "FROTO", "GARAN",
    "HEKTS", "ISCTR", "KCHOL", "KONTR", "KOZAL", "MGROS", "ODAS", "OYAKC", "PETKM", "PGSUS",
    "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TOASO", "TUPRS", "YKBNK", "TTKOM",
]

SWING_WINDOW = 3          # bars on each side to confirm a swing high/low (fractal)
STRUCTURE_LOOKBACK = 6    # how many recent swings to consider for HH/HL/LH/LL trend read
BREAKOUT_ATR_MULT = 0.5   # a close must clear the level by this many ATRs to count as a breakout
RETEST_TOLERANCE_ATR = 0.75  # how close price must return to the broken level to count as a retest
RETEST_WINDOW = 5         # bars after a breakout to look for a retest
MAX_RISK_PCT = 8.0        # signals whose stop distance exceeds this % of entry are dropped (bad R:R/too risky)


@dataclass
class SwingPoint:
    index: int
    date: str
    price: float
    kind: str  # "high" | "low"


@dataclass
class Level:
    price: float
    kind: str  # "support" | "resistance"
    touches: int


@dataclass
class Signal:
    ticker: str
    name: str
    direction: str  # "LONG" | "SHORT" | "NONE"
    price: float
    change_percent: float
    structure: str  # "Yükseliş (HH/HL)" | "Düşüş (LH/LL)" | "Yatay/Belirsiz"
    score: int
    confidence: str  # "Yüksek" | "Orta" | "Düşük"
    reasons: List[str]
    triggered_conditions: List[str]
    entry: Optional[float]
    stop_loss: Optional[float]
    take_profit: Optional[float]
    risk_reward: Optional[float]
    risk_level: str  # "Düşük" | "Orta" | "Yüksek"
    support_levels: List[float]
    resistance_levels: List[float]
    last_update: str
    error: Optional[str] = None


def _find_swings(df: pd.DataFrame, window: int = SWING_WINDOW) -> List[SwingPoint]:
    """Fractal swing high/low detection: bar i is a swing high if its high
    is the strict max of the window [i-window, i+window], swing low
    symmetrically for lows. Standard, simple, and - critically - only
    depends on OHLC that's already settled (needs `window` bars of
    hindsight, same as any real fractal indicator)."""
    highs = df["High"].values
    lows = df["Low"].values
    n = len(df)
    swings: List[SwingPoint] = []
    for i in range(window, n - window):
        window_highs = highs[i - window: i + window + 1]
        window_lows = lows[i - window: i + window + 1]
        if highs[i] == window_highs.max() and (window_highs == highs[i]).sum() == 1:
            swings.append(SwingPoint(index=i, date=str(df.index[i].date()), price=float(highs[i]), kind="high"))
        if lows[i] == window_lows.min() and (window_lows == lows[i]).sum() == 1:
            swings.append(SwingPoint(index=i, date=str(df.index[i].date()), price=float(lows[i]), kind="low"))
    swings.sort(key=lambda s: s.index)
    return swings


def _classify_structure(swings: List[SwingPoint]) -> tuple[str, List[str]]:
    """Reads the last few swing highs/lows for the classic HH/HL (uptrend)
    vs LH/LL (downtrend) pattern. Returns a human label plus the specific
    HH/HL/LH/LL tags found, for the signal's "triggered conditions" list."""
    recent_highs = [s for s in swings if s.kind == "high"][-STRUCTURE_LOOKBACK:]
    recent_lows = [s for s in swings if s.kind == "low"][-STRUCTURE_LOOKBACK:]
    tags: List[str] = []

    high_trend = None
    if len(recent_highs) >= 2:
        high_trend = "HH" if recent_highs[-1].price > recent_highs[-2].price else "LH"
        tags.append(f"Son tepe: {high_trend}")
    low_trend = None
    if len(recent_lows) >= 2:
        low_trend = "HL" if recent_lows[-1].price > recent_lows[-2].price else "LL"
        tags.append(f"Son dip: {low_trend}")

    if high_trend == "HH" and low_trend == "HL":
        return "Yükseliş (HH/HL)", tags
    if high_trend == "LH" and low_trend == "LL":
        return "Düşüş (LH/LL)", tags
    return "Yatay/Belirsiz", tags


def _cluster_levels(swings: List[SwingPoint], current_price: float, tolerance_pct: float = 1.5) -> List[Level]:
    """Groups nearby swing highs into resistance levels and swing lows into
    support levels (within tolerance_pct of each other), counting touches
    as a simple strength proxy. Only keeps levels within a sane distance of
    the current price (dynamic S/R, not every swing since inception)."""
    levels: List[Level] = []
    for kind, pts in (("resistance", [s for s in swings if s.kind == "high"]), ("support", [s for s in swings if s.kind == "low"])):
        prices = sorted([p.price for p in pts], reverse=(kind == "resistance"))
        used = [False] * len(prices)
        for i, p in enumerate(prices):
            if used[i]:
                continue
            cluster = [p]
            used[i] = True
            for j in range(i + 1, len(prices)):
                if used[j]:
                    continue
                if abs(prices[j] - p) / p * 100 <= tolerance_pct:
                    cluster.append(prices[j])
                    used[j] = True
            levels.append(Level(price=float(np.mean(cluster)), kind=kind, touches=len(cluster)))
    # Keep only levels within 15% of price - distant historical levels
    # aren't operationally relevant for an entry/stop/target right now.
    levels = [l for l in levels if abs(l.price - current_price) / current_price <= 0.15]
    levels.sort(key=lambda l: abs(l.price - current_price))
    return levels


def _atr(df: pd.DataFrame, period: int = 14) -> float:
    high, low, close = df["High"], df["Low"], df["Close"]
    prev_close = close.shift(1)
    tr = pd.concat([high - low, (high - prev_close).abs(), (low - prev_close).abs()], axis=1).max(axis=1)
    return float(tr.rolling(period).mean().iloc[-1])


def _candle_pattern(df: pd.DataFrame) -> Optional[str]:
    """Checks the two most recent completed candles for the standard
    confirmation patterns the request asked for. Pure OHLC math, no
    external library needed for these four well-defined shapes."""
    if len(df) < 2:
        return None
    c0, c1 = df.iloc[-1], df.iloc[-2]
    body0 = abs(c0["Close"] - c0["Open"])
    range0 = c0["High"] - c0["Low"]
    upper_wick = c0["High"] - max(c0["Close"], c0["Open"])
    lower_wick = min(c0["Close"], c0["Open"]) - c0["Low"]

    # Engulfing
    bullish0 = c0["Close"] > c0["Open"]
    bearish1 = c1["Close"] < c1["Open"]
    if bullish0 and bearish1 and c0["Close"] >= c1["Open"] and c0["Open"] <= c1["Close"]:
        return "Yutan Boğa Mumu (Bullish Engulfing)"
    bearish0 = c0["Close"] < c0["Open"]
    bullish1 = c1["Close"] > c1["Open"]
    if bearish0 and bullish1 and c0["Open"] >= c1["Close"] and c0["Close"] <= c1["Open"]:
        return "Yutan Ayı Mumu (Bearish Engulfing)"

    # Pin bar / hammer / shooting star: small body, one wick >= 2x body
    if range0 > 0 and body0 / range0 < 0.35:
        if lower_wick >= 2 * body0 and lower_wick > upper_wick:
            return "Pin Bar (Çekiç - alt gölge)"
        if upper_wick >= 2 * body0 and upper_wick > lower_wick:
            return "Pin Bar (Kayan Yıldız - üst gölge)"

    # Inside bar breakout: c1 fully contains c0's *prior* bar range and c0 breaks out of it
    if len(df) >= 3:
        c2 = df.iloc[-3]
        inside = c1["High"] <= c2["High"] and c1["Low"] >= c2["Low"]
        if inside:
            if c0["Close"] > c2["High"]:
                return "İç Bar Kırılımı (Yukarı)"
            if c0["Close"] < c2["Low"]:
                return "İç Bar Kırılımı (Aşağı)"
    return None


def _detect_breakout(df: pd.DataFrame, levels: List[Level], atr: float) -> Optional[Dict[str, Any]]:
    """Looks for a recent close that cleared a support/resistance level by
    more than BREAKOUT_ATR_MULT * ATR (the "genuine breakout, not noise"
    filter), then checks the following bars for either a successful retest
    (price came back near the level and held) or a clean continuation with
    volume above its recent average (momentum confirmation) - the request's
    "candle close confirmation + momentum confirmation + structure
    confirmation" trio, applied concretely."""
    if atr <= 0 or len(df) < RETEST_WINDOW + 2:
        return None
    closes = df["Close"].values
    vols = df["Volume"].values
    avg_vol = float(np.mean(vols[-20:])) if len(vols) >= 20 else float(np.mean(vols))

    for level in levels:
        for i in range(len(df) - RETEST_WINDOW - 1, len(df)):
            if i < 1:
                continue
            broke_up = level.kind == "resistance" and closes[i] > level.price + BREAKOUT_ATR_MULT * atr and closes[i - 1] <= level.price
            broke_down = level.kind == "support" and closes[i] < level.price - BREAKOUT_ATR_MULT * atr and closes[i - 1] >= level.price
            if not (broke_up or broke_down):
                continue
            direction = "LONG" if broke_up else "SHORT"
            breakout_vol_ok = vols[i] >= avg_vol
            retested = False
            for j in range(i + 1, min(i + 1 + RETEST_WINDOW, len(df))):
                if abs(closes[j] - level.price) <= RETEST_TOLERANCE_ATR * atr:
                    holds = (closes[j] >= level.price) if direction == "LONG" else (closes[j] <= level.price)
                    if holds:
                        retested = True
                    break
            is_latest = i >= len(df) - 2  # only act on breakouts that are still fresh
            if is_latest:
                return {
                    "direction": direction,
                    "level": level.price,
                    "level_kind": level.kind,
                    "volume_confirmed": breakout_vol_ok,
                    "retested": retested,
                    "bars_since": len(df) - 1 - i,
                }
    return None


def _liquidity_grab(df: pd.DataFrame, swings: List[SwingPoint]) -> Optional[str]:
    """Heuristic proxy for a stop hunt: the latest bar's wick pierces
    beyond a recent swing extreme but the candle closes back inside the
    prior range, on above-average volume - price "grabbed" the liquidity
    resting beyond that level (stops/breakout orders) without actually
    continuing. This is a reasonable, well-known proxy; it isn't order-book
    liquidity data (BIST doesn't expose that publicly), which is a real
    scope limit, documented in the deliverables report."""
    if len(df) < 21:
        return None
    last = df.iloc[-1]
    avg_vol = float(df["Volume"].iloc[-20:].mean())
    recent_highs = [s.price for s in swings if s.kind == "high"][-3:]
    recent_lows = [s.price for s in swings if s.kind == "low"][-3:]
    if recent_highs and last["High"] > max(recent_highs) and last["Close"] < max(recent_highs) and last["Volume"] > avg_vol:
        return "Üst likidite avı (stop hunt) tespit edildi"
    if recent_lows and last["Low"] < min(recent_lows) and last["Close"] > min(recent_lows) and last["Volume"] > avg_vol:
        return "Alt likidite avı (stop hunt) tespit edildi"
    return None


def _fetch_history_with_retry(t: "borsapy.Ticker", ticker: str) -> pd.DataFrame:
    """borsapy's history()/ta_signals() calls open their own TradingView
    connection per call - scanning 30 symbols concurrently bursts well past
    TradingView's per-IP rate limit (429s), even with a modest worker pool
    (see _run_scan's throttling). A short backoff-and-retry absorbs the
    transient 429s that still slip through instead of losing that symbol's
    signal for the whole 3-minute refresh cycle."""
    last_err: Optional[Exception] = None
    for attempt in range(3):
        try:
            return t.history(period="6mo", interval="1d")
        except Exception as e:
            last_err = e
            if "429" in str(e):
                time.sleep(1.5 * (attempt + 1))
                continue
            raise
    raise last_err  # type: ignore[misc]


def _build_signal(ticker: str, name: str) -> Signal:
    now_iso = datetime.now(timezone.utc).isoformat()
    try:
        t = borsapy.Ticker(ticker)
        df = _fetch_history_with_retry(t, ticker)
        if df is None or len(df) < SWING_WINDOW * 4:
            return Signal(
                ticker=ticker, name=name, direction="NONE", price=0.0, change_percent=0.0,
                structure="Veri yetersiz", score=0, confidence="Düşük", reasons=["Yeterli geçmiş veri yok"],
                triggered_conditions=[], entry=None, stop_loss=None, take_profit=None, risk_reward=None,
                risk_level="Orta", support_levels=[], resistance_levels=[], last_update=now_iso,
                error="insufficient_data",
            )

        price = float(df["Close"].iloc[-1])
        prev_close = float(df["Close"].iloc[-2]) if len(df) > 1 else price
        change_pct = (price - prev_close) / prev_close * 100 if prev_close else 0.0

        swings = _find_swings(df)
        structure, structure_tags = _classify_structure(swings)
        levels = _cluster_levels(swings, price)
        atr = _atr(df)
        breakout = _detect_breakout(df, levels, atr)
        pattern = _candle_pattern(df)
        liquidity_note = _liquidity_grab(df, swings)

        try:
            ta = t.ta_signals(interval="1d")
        except Exception as e:
            logger.warning(f"ta_signals failed for {ticker}: {e}")
            ta = None

        reasons: List[str] = list(structure_tags)
        triggered: List[str] = []
        score = 0
        direction = "NONE"

        structure_bullish = structure.startswith("Yükseliş")
        structure_bearish = structure.startswith("Düşüş")
        if structure_bullish or structure_bearish:
            score += 25
            triggered.append("Piyasa yapısı: " + structure)

        momentum_ok_long = momentum_ok_short = False
        if ta:
            osc_rec = ta.get("oscillators", {}).get("recommendation", "NEUTRAL")
            ma_rec = ta.get("moving_averages", {}).get("recommendation", "NEUTRAL")
            rsi = ta.get("oscillators", {}).get("values", {}).get("RSI", 50.0)
            momentum_ok_long = ma_rec != "STRONG_SELL" and rsi < 72
            momentum_ok_short = ma_rec != "STRONG_BUY" and rsi > 28
            if momentum_ok_long or momentum_ok_short:
                score += 25
                triggered.append(f"Momentum (TradingView): osc={osc_rec}, MA={ma_rec}, RSI={rsi:.1f}")
            else:
                reasons.append(f"Momentum uyumsuz (RSI={rsi:.1f}, MA={ma_rec})")

        if breakout:
            reasons.append(
                f"{breakout['level_kind']} kırılımı: {breakout['level']:.2f} seviyesi "
                f"({'hacim onaylı' if breakout['volume_confirmed'] else 'hacim zayıf'}, "
                f"{'test edildi' if breakout['retested'] else 'test bekleniyor'})"
            )
            if breakout["volume_confirmed"]:
                score += 15
                triggered.append("Hacim teyidi (ortalamanın üzerinde)")
            if breakout["retested"]:
                score += 20
                triggered.append("Kırılım seviyesi başarıyla test edildi (retest)")
            else:
                score += 8
        if pattern:
            score += 10
            triggered.append(f"Mum formasyonu: {pattern}")
        if liquidity_note:
            reasons.append(liquidity_note)

        # Direction: requires structure + breakout to agree, plus momentum
        # confirmation - the request's explicit LONG/SHORT entry rules.
        if breakout and structure_bullish and breakout["direction"] == "LONG" and momentum_ok_long:
            direction = "LONG"
        elif breakout and structure_bearish and breakout["direction"] == "SHORT" and momentum_ok_short:
            direction = "SHORT"
        elif structure_bullish and momentum_ok_long and pattern and "Boğa" in (pattern or ""):
            direction = "LONG"
            score += 5
            reasons.append("Kırılım yok ama yapı + mum formasyonu uyumlu (erken sinyal)")
        elif structure_bearish and momentum_ok_short and pattern and "Ayı" in (pattern or ""):
            direction = "SHORT"
            score += 5
            reasons.append("Kırılım yok ama yapı + mum formasyonu uyumlu (erken sinyal)")

        entry = stop = target = rr = None
        risk_level = "Orta"
        if direction != "NONE" and atr > 0:
            resistances = sorted([l.price for l in levels if l.kind == "resistance" and l.price > price])
            supports = sorted([l.price for l in levels if l.kind == "support" and l.price < price], reverse=True)
            entry = price
            if direction == "LONG":
                structural_stop = supports[0] if supports else price - 2 * atr
                stop = min(structural_stop, entry - 1.2 * atr)
                risk = entry - stop
                target = resistances[0] if resistances and resistances[0] - entry > risk * 0.8 else entry + risk * 2
            else:
                structural_stop = resistances[0] if resistances else price + 2 * atr
                stop = max(structural_stop, entry + 1.2 * atr)
                risk = stop - entry
                target = supports[0] if supports and entry - supports[0] > risk * 0.8 else entry - risk * 2

            risk_pct = abs(entry - stop) / entry * 100 if entry else 0
            reward = abs(target - entry)
            risk_amt = abs(entry - stop)
            rr = round(reward / risk_amt, 2) if risk_amt > 0 else None

            if risk_pct > MAX_RISK_PCT or (rr is not None and rr < 1.0):
                # Fails the request's "risk acceptable" entry-rule condition -
                # downgrade instead of publishing an unfavorable-R:R signal.
                direction = "NONE"
                reasons.append(f"Risk/ödül yetersiz (R:R={rr}, risk %{risk_pct:.1f}) - sinyal iptal edildi")
                entry = stop = target = rr = None
                score = max(score - 20, 0)
            else:
                risk_level = "Düşük" if risk_pct < 3 else ("Orta" if risk_pct < 6 else "Yüksek")
                if rr and rr >= 2:
                    score += 5

        score = int(max(0, min(100, score)))
        confidence = "Yüksek" if score >= 70 else ("Orta" if score >= 45 else "Düşük")
        if direction == "NONE" and not reasons:
            reasons.append("Giriş koşulları henüz sağlanmadı (yapı/kırılım/momentum uyuşmuyor)")

        return Signal(
            ticker=ticker, name=name, direction=direction, price=round(price, 4),
            change_percent=round(change_pct, 2), structure=structure, score=score, confidence=confidence,
            reasons=reasons, triggered_conditions=triggered,
            entry=round(entry, 4) if entry else None,
            stop_loss=round(stop, 4) if stop else None,
            take_profit=round(target, 4) if target else None,
            risk_reward=rr, risk_level=risk_level,
            support_levels=[round(l.price, 4) for l in levels if l.kind == "support"][:3],
            resistance_levels=[round(l.price, 4) for l in levels if l.kind == "resistance"][:3],
            last_update=now_iso,
        )
    except Exception as e:
        logger.error(f"Strategy engine failed for {ticker}: {e}")
        return Signal(
            ticker=ticker, name=name, direction="NONE", price=0.0, change_percent=0.0,
            structure="Hata", score=0, confidence="Düşük", reasons=[f"Analiz hatası: {e}"],
            triggered_conditions=[], entry=None, stop_loss=None, take_profit=None, risk_reward=None,
            risk_level="Orta", support_levels=[], resistance_levels=[], last_update=now_iso, error=str(e),
        )


class StrategyEngine:
    """Owns the periodically-refreshed BIST30 scan result. Recomputing all
    30 symbols concurrently takes ~2-3s (see module docstring); refreshing
    every few minutes on a background thread means API requests always
    serve an already-computed cache instead of paying that cost per
    request, and the scanner still reads as "live" without hammering
    borsapy's REST endpoints on every page view."""

    REFRESH_INTERVAL_SECONDS = 180

    def __init__(self):
        self._lock = threading.Lock()
        self._signals: List[Signal] = []
        self._last_run: Optional[str] = None
        self._running = False
        self._scheduler_started = False

    def _run_scan(self) -> None:
        names = {t["ticker"]: t["name"] for t in _ticker_names()}
        # A modest worker count plus a small stagger between submissions -
        # 10 concurrent borsapy.Ticker.history()/ta_signals() calls (each
        # its own TradingView connection) reliably triggered 429 Too Many
        # Requests during testing. 4 workers with a 150ms stagger keeps the
        # whole 30-symbol scan under ~20s while staying under that limit.
        results: List[Signal] = []
        with ThreadPoolExecutor(max_workers=4) as pool:
            futures = {}
            for ticker in BIST30_TICKERS:
                futures[pool.submit(_build_signal, ticker, names.get(ticker, ticker))] = ticker
                time.sleep(0.15)
            for fut in as_completed(futures):
                try:
                    results.append(fut.result())
                except Exception as e:
                    ticker = futures[fut]
                    logger.error(f"Signal build crashed for {ticker}: {e}")
        order = {t: i for i, t in enumerate(BIST30_TICKERS)}
        results.sort(key=lambda s: order.get(s.ticker, 999))
        with self._lock:
            self._signals = results
            self._last_run = datetime.now(timezone.utc).isoformat()

    def scan_now(self) -> List[Signal]:
        if not self._signals:
            self._run_scan()
        return self.get_signals()

    def get_signals(self) -> List[Signal]:
        with self._lock:
            return list(self._signals)

    def get_last_run(self) -> Optional[str]:
        with self._lock:
            return self._last_run

    def start_background_refresh(self) -> None:
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            while True:
                try:
                    self._run_scan()
                    logger.info(f"Strategy engine: scanned {len(BIST30_TICKERS)} BIST30 symbols.")
                except Exception as e:
                    logger.error(f"Strategy engine scan loop error: {e}")
                time.sleep(self.REFRESH_INTERVAL_SECONDS)

        threading.Thread(target=loop, daemon=True).start()


_TICKER_NAMES_CACHE: List[Dict[str, str]] = []


def _ticker_names() -> List[Dict[str, str]]:
    global _TICKER_NAMES_CACHE
    if _TICKER_NAMES_CACHE:
        return _TICKER_NAMES_CACHE
    from app.services.market_data import market_data_service
    _TICKER_NAMES_CACHE = [t for t in market_data_service.tickers if t["ticker"] in BIST30_TICKERS]
    return _TICKER_NAMES_CACHE


strategy_engine = StrategyEngine()


# --- STRATEGY_NOTES (for the deliverables report, not used by the API) ---
# What's real and fully implemented from real OHLCV data:
#   - Fractal swing high/low detection, HH/HL/LH/LL structure classification
#   - Clustered support/resistance from swing points
#   - ATR-normalized breakout detection with volume + retest confirmation
#   - 4 candle confirmation patterns (engulfing x2, pin bar x2, inside bar breakout)
#   - Entry/stop/target/R:R computed from real structural levels + ATR, with
#     a hard R:R/risk-% floor that suppresses low-quality signals entirely
#   - Momentum layer reuses TradingView's own technical rating (via
#     borsapy's ta_signals) rather than reimplementing RSI/MACD/moving
#     averages from scratch - same institutional indicator set, not a
#     placeholder
# What's a documented heuristic, not the literal institutional concept:
#   - "Liquidity grab / stop hunt" - a wick-beyond-swing-extreme-then-close-
#     back-inside proxy on elevated volume. Real liquidity-pool analysis
#     needs order-book depth data, which BIST doesn't expose publicly.
#   - Trendline detection is level/structure-based (S/R clustering +
#     breakout of those), not a literal two-point diagonal trendline fit
#     with its own break/retest tracking - scoped out for this pass, noted
#     as a follow-up.
