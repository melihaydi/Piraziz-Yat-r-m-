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
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone, timedelta

# Turkey has used a fixed UTC+3 offset year-round since abolishing DST in
# 2016 - used only to compute the intraday history's "which trading day is
# this" boundary (see _run_scan below), not for any other timestamp.
_TR_TZ = timezone(timedelta(hours=3))
from typing import Any, Dict, List, Optional

import numpy as np
import pandas as pd
import borsapy

from app.core.redis import cache_service

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
TREND_SMA_PERIOD = 50     # trend-following filter: price vs a rising/falling SMA(50)
STOP_ATR_MULT = 1.5       # minimum stop distance in ATRs (widened from 1.2 - see _decide_signal)

# StrategyEngine/BacktestEngine write their in-memory state through to these
# Redis keys on every recompute, and hydrate from them on __init__ - so a
# backend restart/redeploy serves the last real scan/backtest instantly
# instead of forcing every visitor to wait for a fresh ~20s scan (or, for
# the backtest, several minutes) before the dashboard shows anything. The
# in-memory lists remain the hot-path read (no Redis round-trip per
# request); Redis is the durability layer underneath them.
_SIGNALS_REDIS_KEY = "strategy_engine:signals"
_HISTORY_REDIS_KEY = "strategy_engine:history"
_BACKTEST_REDIS_KEY = "backtest_engine:results"
STRATEGY_REDIS_TTL_SECONDS = 900          # generous vs. the 180s scan interval
HISTORY_REDIS_TTL_SECONDS = 24 * 60 * 60  # the log itself resets daily anyway
BACKTEST_REDIS_TTL_SECONDS = 3 * 24 * 60 * 60  # backtest only refreshes once/day


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


@dataclass
class SignalHistoryEntry:
    """A single "the scanner called LONG/SHORT on this symbol" event,
    logged once when a symbol's direction first changes into LONG or SHORT
    - see StrategyEngine._run_scan. This is the intraday signal log shown
    in the dashboard's "Sinyal Geçmişi" tab, distinct from Signal above
    (which is always just the current snapshot)."""
    ticker: str
    name: str
    direction: str  # "LONG" | "SHORT"
    price: float
    score: int
    confidence: str
    entry: Optional[float]
    stop_loss: Optional[float]
    take_profit: Optional[float]
    timestamp: str


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


def _trend_state(df: pd.DataFrame, period: int = TREND_SMA_PERIOD) -> Optional[str]:
    """Standard trend-following filter (Dow Theory / moving-average trend
    systems): "up" only if price is above a SMA(50) that's itself rising,
    "down" only if price is below a SMA(50) that's falling, else None.

    This is a deliberately coarser, harder-to-fake trend read than the
    fractal HH/HL structure classifier above - a 50-bar SMA slope can't
    flip on one new swing the way HH/HL sometimes does on a choppy stock.
    Backtesting the original version of this engine (structure + breakout +
    live TA rating only, no SMA trend gate) showed a stark asymmetry: LONG
    trades averaged +1.3%, SHORT trades averaged -1.0%, over the same
    2-year window on the same universe - i.e. the engine was frequently
    shorting individual stocks that were still in a broader uptrend, which
    is a well-known losing bet (fighting the dominant trend). Requiring
    trend agreement is the standard fix."""
    if len(df) < period + 5:
        return None
    sma = df["Close"].rolling(period).mean()
    if pd.isna(sma.iloc[-1]) or pd.isna(sma.iloc[-5]):
        return None
    price = float(df["Close"].iloc[-1])
    if price > sma.iloc[-1] and sma.iloc[-1] > sma.iloc[-5]:
        return "up"
    if price < sma.iloc[-1] and sma.iloc[-1] < sma.iloc[-5]:
        return "down"
    return None


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
    volume above its recent average (momentum confirmation).

    A stricter version of this was tried during the 2026-07-28 strategy
    revision - requiring a fully-completed retest-and-hold before firing at
    all, instead of firing on the breakout bar itself - on the theory that
    the original 37.6% backtest win rate (174 stops vs 95 targets) meant
    too many fakeout breakouts were being entered. Empirically, on a full
    30-symbol / ~2-year re-backtest, that made results WORSE (avg return
    per symbol +0.9% -> -1.9%, win rate 37.6% -> 32.7%): waiting for the
    retest missed too many clean continuation moves on strongly-trending
    stocks to be worth the fewer fakeouts avoided. Reverted - this is the
    original immediate-fire behavior. See _decide_signal / _trend_state for
    the change that DID measurably help (SMA50 trend filter)."""
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


def _decide_signal(
    df: pd.DataFrame,
    price: float,
    swings: List[SwingPoint],
    structure: str,
    structure_tags: List[str],
    levels: List[Level],
    atr: float,
    pattern: Optional[str],
    momentum_ok_long: bool,
    momentum_ok_short: bool,
    momentum_note: str,
) -> Dict[str, Any]:
    """Core direction/entry/stop/target/score decision, shared by the live
    scanner (_build_signal) and the backtest (_backtest_symbol) so the two
    can never silently diverge the way they used to - the backtest
    previously had its own hand-copied version of this logic, and the
    engine changes below (confirmed-retest breakouts, SMA trend filter)
    were only being validated against the backtest's copy until this was
    unified. The one intentional difference between live and backtest stays
    external to this function: how momentum_ok_long/short get computed
    (live: TradingView's ta_signals rating; backtest: local RSI(14), since
    ta_signals has no historical/point-in-time API - see STRATEGY_NOTES)."""
    reasons: List[str] = list(structure_tags)
    triggered: List[str] = []
    score = 0
    direction = "NONE"

    structure_bullish = structure.startswith("Yükseliş")
    structure_bearish = structure.startswith("Düşüş")
    if structure_bullish or structure_bearish:
        score += 20
        triggered.append("Piyasa yapısı: " + structure)

    trend = _trend_state(df)
    trend_up = trend == "up"
    trend_down = trend == "down"
    if trend_up:
        triggered.append(f"Trend filtresi: SMA{TREND_SMA_PERIOD} üzerinde ve yükseliş eğiminde")
    elif trend_down:
        triggered.append(f"Trend filtresi: SMA{TREND_SMA_PERIOD} altında ve düşüş eğiminde")
    else:
        reasons.append(f"Trend filtresi belirsiz (fiyat SMA{TREND_SMA_PERIOD} etrafında yatay)")

    if momentum_ok_long or momentum_ok_short:
        score += 20
        triggered.append(momentum_note)
    else:
        reasons.append(f"Momentum uyumsuz ({momentum_note})")

    breakout = _detect_breakout(df, levels, atr)
    if breakout:
        reasons.append(
            f"{breakout['level_kind']} kırılımı: {breakout['level']:.2f} seviyesi "
            f"({'hacim onaylı' if breakout['volume_confirmed'] else 'hacim zayıf'}, "
            f"{'test edildi' if breakout['retested'] else 'test bekleniyor'})"
        )
        if breakout["volume_confirmed"]:
            score += 10
            triggered.append("Hacim teyidi (ortalamanın üzerinde)")
        if breakout["retested"]:
            score += 20
            triggered.append("Kırılım seviyesi başarıyla test edildi (retest)")
        else:
            score += 8
    if pattern:
        score += 10
        triggered.append(f"Mum formasyonu: {pattern}")
    liquidity_note = _liquidity_grab(df, swings)
    if liquidity_note:
        reasons.append(liquidity_note)

    # Direction requires structure + confirmed-retest breakout + SMA trend +
    # momentum to all agree - the request's LONG/SHORT entry rules, now with
    # a trend-following gate that specifically targets the asymmetry found
    # in backtesting (SHORTs losing money on average by fighting a still-
    # rising broader trend - see _trend_state's docstring for the numbers).
    if breakout and structure_bullish and trend_up and breakout["direction"] == "LONG" and momentum_ok_long:
        direction = "LONG"
    elif breakout and structure_bearish and trend_down and breakout["direction"] == "SHORT" and momentum_ok_short:
        direction = "SHORT"
    elif structure_bullish and trend_up and momentum_ok_long and pattern and "Boğa" in (pattern or ""):
        direction = "LONG"
        score += 5
        reasons.append("Kırılım yok ama yapı + trend + mum formasyonu uyumlu (erken sinyal)")
    elif structure_bearish and trend_down and momentum_ok_short and pattern and "Ayı" in (pattern or ""):
        direction = "SHORT"
        score += 5
        reasons.append("Kırılım yok ama yapı + trend + mum formasyonu uyumlu (erken sinyal)")

    if direction == "SHORT":
        # Backtesting this engine (2026-07-28 revision) across all 30 BIST30
        # symbols over ~2 years consistently showed SHORT trades underperforming
        # LONG trades on the SAME setup criteria (SHORT avg ~-1.0% to -1.5% per
        # trade vs LONG avg ~+1.2% to +1.3%), even after adding a per-stock SMA
        # trend filter and an XU100 market-regime filter - neither closed the
        # gap. This looks like a genuine, structural characteristic of shorting
        # individual BIST stocks over this period (not a fixable false-breakout
        # or momentum-filter bug - several were tried and none helped), so
        # instead of claiming a fix the evidence doesn't support, SHORT signals
        # are held to a stricter confidence bar until this changes.
        score = max(score - 12, 0)
        reasons.append("Not: Geriye dönük testte SHORT sinyalleri LONG'a göre daha zayıf performans gösterdi - güven puanı buna göre düşürüldü")

    entry = stop = target = rr = None
    risk_level = "Orta"
    if direction != "NONE" and atr > 0:
        resistances = sorted([l.price for l in levels if l.kind == "resistance" and l.price > price])
        supports = sorted([l.price for l in levels if l.kind == "support" and l.price < price], reverse=True)
        entry = price
        if direction == "LONG":
            structural_stop = supports[0] if supports else entry - 2 * atr
            stop = min(structural_stop, entry - STOP_ATR_MULT * atr)
            risk = entry - stop
            target = resistances[0] if resistances and resistances[0] - entry > risk * 0.8 else entry + risk * 2
        else:
            structural_stop = resistances[0] if resistances else entry + 2 * atr
            stop = max(structural_stop, entry + STOP_ATR_MULT * atr)
            risk = stop - entry
            target = supports[0] if supports and entry - supports[0] > risk * 0.8 else entry - risk * 2

        risk_pct = abs(entry - stop) / entry * 100 if entry else 0
        risk_amt = abs(entry - stop)
        rr = round(abs(target - entry) / risk_amt, 2) if risk_amt > 0 else None

        if risk_pct > MAX_RISK_PCT or (rr is not None and rr < 1.0):
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
        reasons.append("Giriş koşulları henüz sağlanmadı (yapı/trend/kırılım/momentum uyuşmuyor)")

    return {
        "direction": direction, "reasons": reasons, "triggered": triggered, "score": score,
        "confidence": confidence, "entry": entry, "stop": stop, "target": target, "rr": rr,
        "risk_level": risk_level,
    }


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
        pattern = _candle_pattern(df)

        try:
            ta = t.ta_signals(interval="1d")
        except Exception as e:
            logger.warning(f"ta_signals failed for {ticker}: {e}")
            ta = None

        momentum_ok_long = momentum_ok_short = False
        momentum_note = "TradingView verisi alınamadı"
        if ta:
            osc_rec = ta.get("oscillators", {}).get("recommendation", "NEUTRAL")
            ma_rec = ta.get("moving_averages", {}).get("recommendation", "NEUTRAL")
            rsi = ta.get("oscillators", {}).get("values", {}).get("RSI", 50.0)
            momentum_ok_long = ma_rec != "STRONG_SELL" and rsi < 72
            momentum_ok_short = ma_rec != "STRONG_BUY" and rsi > 28
            momentum_note = f"Momentum (TradingView): osc={osc_rec}, MA={ma_rec}, RSI={rsi:.1f}"

        decision = _decide_signal(
            df, price, swings, structure, structure_tags, levels, atr, pattern,
            momentum_ok_long, momentum_ok_short, momentum_note,
        )

        return Signal(
            ticker=ticker, name=name, direction=decision["direction"], price=round(price, 4),
            change_percent=round(change_pct, 2), structure=structure, score=decision["score"],
            confidence=decision["confidence"], reasons=decision["reasons"], triggered_conditions=decision["triggered"],
            entry=round(decision["entry"], 4) if decision["entry"] else None,
            stop_loss=round(decision["stop"], 4) if decision["stop"] else None,
            take_profit=round(decision["target"], 4) if decision["target"] else None,
            risk_reward=decision["rr"], risk_level=decision["risk_level"],
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


@dataclass
class BacktestTrade:
    direction: str
    entry_date: str
    entry_price: float
    exit_date: str
    exit_price: float
    exit_reason: str  # "stop" | "target" | "timeout" | "açık pozisyon (güncel fiyat)"
    return_pct: float


@dataclass
class BacktestResult:
    ticker: str
    name: str
    total_trades: int
    win_rate: Optional[float]
    total_return_pct: Optional[float]
    avg_return_pct: Optional[float]
    best_trade_pct: Optional[float]
    worst_trade_pct: Optional[float]
    last_trade: Optional[BacktestTrade]
    recent_trades: List[BacktestTrade]
    error: Optional[str] = None


def _backtest_result_from_dict(d: dict) -> BacktestResult:
    """Reverses asdict(BacktestResult(...)) - needed because BacktestResult
    nests BacktestTrade dataclasses, which json.loads() only gives back as
    plain dicts."""
    d = dict(d)
    d["last_trade"] = BacktestTrade(**d["last_trade"]) if d.get("last_trade") else None
    d["recent_trades"] = [BacktestTrade(**t) for t in d.get("recent_trades", [])]
    return BacktestResult(**d)


BACKTEST_LOOKBACK_PERIOD = "2y"
BACKTEST_WINDOW_BARS = 120    # bars of context fed to swing/structure/breakout detection at each step
BACKTEST_WARMUP_BARS = 60     # need this many bars of history before evaluating the first signal
BACKTEST_MAX_HOLD_BARS = 40   # force-close a still-open simulated trade after this many bars


def _rsi_series(closes: pd.Series, period: int = 14) -> pd.Series:
    delta = closes.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.rolling(period).mean()
    avg_loss = loss.rolling(period).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50.0)


def _backtest_symbol(ticker: str, name: str) -> BacktestResult:
    """Walk-forward simulation of the exact same signal logic _build_signal
    uses live (swing structure, ATR-normalized breakout+retest, candle
    pattern, risk/R:R floor) - re-evaluated at every historical bar using
    only data available up to that point, so this can't "see the future".

    One necessary difference from the live engine: TradingView's ta_signals
    rating (used live for momentum confirmation) only reflects the CURRENT
    moment - there's no API for "what would the rating have been on this
    past date". The momentum condition here is a locally-computed RSI(14) +
    price-vs-SMA50 check instead, applied consistently at every step -
    close in spirit to the live filter, not a re-run of the identical
    TradingView computation. This is a real, documented scope difference
    (see STRATEGY_NOTES), not a shortcut that inflates results.
    """
    try:
        df = borsapy.Ticker(ticker).history(period=BACKTEST_LOOKBACK_PERIOD, interval="1d")
        if df is None or len(df) < BACKTEST_WARMUP_BARS + 10:
            return BacktestResult(ticker, name, 0, None, None, None, None, None, None, [], error="Yeterli geçmiş veri yok")

        rsi = _rsi_series(df["Close"])
        sma50 = df["Close"].rolling(50).mean()

        trades: List[BacktestTrade] = []
        open_trade: Optional[Dict[str, Any]] = None

        for i in range(BACKTEST_WARMUP_BARS, len(df)):
            bar = df.iloc[i]

            if open_trade:
                d = open_trade
                hit_stop = (bar["Low"] <= d["stop"]) if d["direction"] == "LONG" else (bar["High"] >= d["stop"])
                hit_target = (bar["High"] >= d["target"]) if d["direction"] == "LONG" else (bar["Low"] <= d["target"])
                bars_held = i - d["entry_idx"]
                exit_price = exit_reason = None
                if hit_stop:
                    # Conservative: if both stop and target were technically
                    # touchable within the same bar's range, assume the
                    # worse outcome (stop) resolved first - avoids
                    # overstating results from an ambiguous single-bar case.
                    exit_price, exit_reason = d["stop"], "stop"
                elif hit_target:
                    exit_price, exit_reason = d["target"], "target"
                elif bars_held >= BACKTEST_MAX_HOLD_BARS:
                    exit_price, exit_reason = float(bar["Close"]), "timeout"

                if exit_price is not None:
                    ret = (exit_price - d["entry_price"]) / d["entry_price"] * 100
                    if d["direction"] == "SHORT":
                        ret = -ret
                    trades.append(BacktestTrade(
                        direction=d["direction"], entry_date=d["entry_date"], entry_price=round(d["entry_price"], 4),
                        exit_date=str(df.index[i].date()), exit_price=round(exit_price, 4),
                        exit_reason=exit_reason, return_pct=round(ret, 2),
                    ))
                    open_trade = None
                continue

            window_df = df.iloc[max(0, i - BACKTEST_WINDOW_BARS):i + 1]
            swings = _find_swings(window_df)
            structure, structure_tags = _classify_structure(swings)
            entry_price = float(bar["Close"])
            levels = _cluster_levels(swings, entry_price)
            atr = _atr(window_df)
            if not atr or pd.isna(atr) or atr <= 0:
                continue
            pattern = _candle_pattern(window_df)

            r = rsi.iloc[i]
            sma_val = sma50.iloc[i]
            price_above_sma = bool(entry_price > sma_val) if not pd.isna(sma_val) else True
            momentum_ok_long = r < 72 and price_above_sma
            momentum_ok_short = r > 28 and not price_above_sma
            momentum_note = f"Momentum (yerel): RSI={r:.1f}, SMA50 {'üzerinde' if price_above_sma else 'altında'}"

            decision = _decide_signal(
                window_df, entry_price, swings, structure, structure_tags, levels, atr, pattern,
                momentum_ok_long, momentum_ok_short, momentum_note,
            )
            if decision["direction"] == "NONE" or decision["entry"] is None:
                continue

            open_trade = {
                "direction": decision["direction"], "entry_idx": i, "entry_price": entry_price,
                "entry_date": str(df.index[i].date()), "stop": decision["stop"], "target": decision["target"],
            }

        if open_trade:
            last_close = float(df["Close"].iloc[-1])
            ret = (last_close - open_trade["entry_price"]) / open_trade["entry_price"] * 100
            if open_trade["direction"] == "SHORT":
                ret = -ret
            trades.append(BacktestTrade(
                direction=open_trade["direction"], entry_date=open_trade["entry_date"],
                entry_price=round(open_trade["entry_price"], 4), exit_date=str(df.index[-1].date()),
                exit_price=round(last_close, 4), exit_reason="açık pozisyon (güncel fiyat)",
                return_pct=round(ret, 2),
            ))

        if not trades:
            return BacktestResult(ticker, name, 0, None, None, None, None, None, None, [], error=None)

        wins = [t for t in trades if t.return_pct > 0]
        returns = [t.return_pct for t in trades]
        return BacktestResult(
            ticker=ticker, name=name, total_trades=len(trades),
            win_rate=round(len(wins) / len(trades) * 100, 1),
            total_return_pct=round(sum(returns), 2),
            avg_return_pct=round(sum(returns) / len(returns), 2),
            best_trade_pct=round(max(returns), 2),
            worst_trade_pct=round(min(returns), 2),
            last_trade=trades[-1],
            recent_trades=trades[-10:],
        )
    except Exception as e:
        logger.error(f"Backtest failed for {ticker}: {e}")
        return BacktestResult(ticker, name, 0, None, None, None, None, None, None, [], error=str(e))


class BacktestEngine:
    """Same "background-refreshed cache" shape as StrategyEngine, but on a
    much longer cycle (once a day) - a walk-forward backtest over ~2 years
    of daily bars per symbol is backward-looking and doesn't change
    intraday, so there's no reason to recompute it every 3 minutes like the
    live scanner."""

    REFRESH_INTERVAL_SECONDS = 24 * 60 * 60

    def __init__(self):
        self._lock = threading.Lock()
        self._results: List[BacktestResult] = []
        self._last_run: Optional[str] = None
        self._scheduler_started = False
        self._running = False
        self._hydrate_from_redis()

    def _hydrate_from_redis(self) -> None:
        data = cache_service.get_json(_BACKTEST_REDIS_KEY)
        if not data:
            return
        try:
            self._results = [_backtest_result_from_dict(r) for r in data["results"]]
            self._last_run = data["last_run"]
        except Exception as e:
            logger.warning(f"Backtest engine: failed to hydrate from Redis: {e}")

    def _persist_to_redis(self) -> None:
        with self._lock:
            payload = {
                "results": [asdict(r) for r in self._results],
                "last_run": self._last_run,
            }
        cache_service.set_json(_BACKTEST_REDIS_KEY, payload, expire_seconds=BACKTEST_REDIS_TTL_SECONDS)

    def _run_backtest(self) -> None:
        with self._lock:
            if self._running:
                return
            self._running = True
        try:
            names = {t["ticker"]: t["name"] for t in _ticker_names()}
            results: List[BacktestResult] = []
            with ThreadPoolExecutor(max_workers=4) as pool:
                futures = {}
                for ticker in BIST30_TICKERS:
                    futures[pool.submit(_backtest_symbol, ticker, names.get(ticker, ticker))] = ticker
                    time.sleep(0.15)
                for fut in as_completed(futures):
                    try:
                        results.append(fut.result())
                    except Exception as e:
                        logger.error(f"Backtest crashed for {futures[fut]}: {e}")
            order = {t: i for i, t in enumerate(BIST30_TICKERS)}
            results.sort(key=lambda r: order.get(r.ticker, 999))
            with self._lock:
                self._results = results
                self._last_run = datetime.now(timezone.utc).isoformat()
            self._persist_to_redis()
        finally:
            with self._lock:
                self._running = False

    def get_results(self) -> List[BacktestResult]:
        """Non-blocking: a 30-symbol x ~2-year walk-forward backtest can take
        a few minutes, so this never makes an HTTP request wait on it. If
        there's no cached result yet (first request after a cold start) and
        a run isn't already in flight, it kicks one off in the background
        and returns immediately - callers should also check is_running() to
        distinguish "still computing" from "no signals in this window"."""
        with self._lock:
            has_results = bool(self._results)
            running = self._running
        if not has_results and not running:
            threading.Thread(target=self._run_backtest, daemon=True).start()
        with self._lock:
            return list(self._results)

    def is_running(self) -> bool:
        with self._lock:
            return self._running

    def get_last_run(self) -> Optional[str]:
        with self._lock:
            return self._last_run

    def start_background_refresh(self) -> None:
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def loop():
            # First run happens lazily on the first request instead of
            # blocking startup - a 2-year x 30-symbol backtest takes real
            # time and there's no need to make every app boot wait on it.
            while True:
                time.sleep(self.REFRESH_INTERVAL_SECONDS)
                try:
                    self._run_backtest()
                    logger.info(f"Backtest engine: re-ran walk-forward backtest for {len(BIST30_TICKERS)} symbols.")
                except Exception as e:
                    logger.error(f"Backtest refresh loop error: {e}")

        threading.Thread(target=loop, daemon=True).start()


backtest_engine = BacktestEngine()


class StrategyEngine:
    """Owns the periodically-refreshed BIST30 scan result. Recomputing all
    30 symbols concurrently takes ~2-3s (see module docstring); refreshing
    every few minutes on a background thread means API requests always
    serve an already-computed cache instead of paying that cost per
    request, and the scanner still reads as "live" without hammering
    borsapy's REST endpoints on every page view."""

    REFRESH_INTERVAL_SECONDS = 180
    MAX_HISTORY_ENTRIES = 300

    def __init__(self):
        self._lock = threading.Lock()
        self._signals: List[Signal] = []
        self._last_run: Optional[str] = None
        self._running = False
        self._scheduler_started = False
        # Intraday LONG/SHORT signal log: a new entry is recorded whenever a
        # symbol's direction *changes into* LONG or SHORT (not on every scan
        # it stays active, which would just spam duplicates every 3 minutes)
        # - this is "what did the scanner call today", not just the current
        # snapshot. Resets at the start of each new day.
        self._history: List[SignalHistoryEntry] = []
        self._last_direction: Dict[str, str] = {}
        self._history_day: Optional[str] = None
        self._hydrate_from_redis()

    def _hydrate_from_redis(self) -> None:
        signals_data = cache_service.get_json(_SIGNALS_REDIS_KEY)
        if signals_data:
            try:
                self._signals = [Signal(**s) for s in signals_data["signals"]]
                self._last_run = signals_data["last_run"]
            except Exception as e:
                logger.warning(f"Strategy engine: failed to hydrate signals from Redis: {e}")
        history_data = cache_service.get_json(_HISTORY_REDIS_KEY)
        if history_data:
            try:
                self._history = [SignalHistoryEntry(**h) for h in history_data["history"]]
                self._last_direction = history_data["last_direction"]
                self._history_day = history_data["history_day"]
            except Exception as e:
                logger.warning(f"Strategy engine: failed to hydrate history from Redis: {e}")

    def _persist_to_redis(self) -> None:
        with self._lock:
            signals_payload = {
                "signals": [asdict(s) for s in self._signals],
                "last_run": self._last_run,
            }
            history_payload = {
                "history": [asdict(h) for h in self._history],
                "last_direction": self._last_direction,
                "history_day": self._history_day,
            }
        cache_service.set_json(_SIGNALS_REDIS_KEY, signals_payload, expire_seconds=STRATEGY_REDIS_TTL_SECONDS)
        cache_service.set_json(_HISTORY_REDIS_KEY, history_payload, expire_seconds=HISTORY_REDIS_TTL_SECONDS)

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

        now = datetime.now(timezone.utc)
        # The intraday history resets once per real Turkey trading day, not
        # once per UTC calendar day - using now.date() directly (UTC) reset
        # 3 hours after Turkey's actual local midnight (Turkey is UTC+3),
        # so a scan run between 00:00-03:00 Turkey time kept logging into
        # the PREVIOUS day's bucket, which then got wiped a few hours into
        # the user's new day instead of at their actual midnight. Confirmed
        # live: a signal was still landing in "yesterday's" bucket well
        # after Turkey's midnight, then the whole log reset once UTC
        # finally ticked over.
        today = now.astimezone(_TR_TZ).date().isoformat()
        with self._lock:
            if self._history_day != today:
                self._history = []
                self._last_direction = {}
                self._history_day = today
            for s in results:
                prev = self._last_direction.get(s.ticker)
                if s.direction in ("LONG", "SHORT") and s.direction != prev:
                    self._history.insert(0, SignalHistoryEntry(
                        ticker=s.ticker, name=s.name, direction=s.direction, price=s.price,
                        score=s.score, confidence=s.confidence, entry=s.entry,
                        stop_loss=s.stop_loss, take_profit=s.take_profit,
                        timestamp=now.isoformat(),
                    ))
                self._last_direction[s.ticker] = s.direction
            self._history = self._history[: self.MAX_HISTORY_ENTRIES]
            self._signals = results
            self._last_run = now.isoformat()
        self._persist_to_redis()

    def scan_now(self) -> List[Signal]:
        if not self._signals:
            self._run_scan()
        return self.get_signals()

    def get_signals(self) -> List[Signal]:
        with self._lock:
            return list(self._signals)

    def get_signal_history(self) -> List[SignalHistoryEntry]:
        if not self._signals:
            self._run_scan()
        with self._lock:
            return list(self._history)

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
#
# 2026-07-28 strategy revision (backtest-driven, see BacktestEngine):
#   Live and backtest previously ran two independently hand-written copies
#   of the direction/entry/stop/target decision logic - they've been
#   unified into one shared _decide_signal() function so they can't
#   silently diverge again; only the momentum SOURCE differs (live:
#   TradingView's ta_signals rating; backtest: local RSI(14), since
#   ta_signals has no historical/point-in-time API).
#
#   Backtesting the original engine full-universe (30 BIST30 symbols, ~2yr
#   daily bars) found: 37.6% win rate, 174 stops vs 95 targets, and a stark
#   LONG/SHORT asymmetry (LONG trades averaged +1.32%, SHORT averaged
#   -1.02%). Four changes were tried and empirically re-backtested (not
#   just theorized) before shipping:
#     1. SMA(50) trend filter (_trend_state) - require price above/below a
#        rising/falling 50-bar SMA, in addition to the fractal HH/HL
#        structure read. KEPT: avg return/symbol +0.9% -> +1.0%, positive
#        symbols 14/30 -> 16/30, roughly flat win rate. Small but real.
#     2. Requiring a fully-completed breakout retest before entering
#        (instead of firing on the breakout bar itself). REVERTED: made
#        results clearly worse (avg return +0.9% -> -1.9%, win rate 37.6%
#        -> 32.7%) - missed too many clean continuation moves on strongly
#        trending stocks to be worth the fakeouts it filtered.
#     3. Tighter RSI-midline momentum threshold (require RSI on the
#        "correct" side of 50, not just outside the 28/72 extremes).
#        REVERTED: also worse (avg return -0.8%), SHORT avg return got
#        worse, not better.
#     4. XU100 market-regime filter (block SHORT signals while the index
#        itself is in an SMA(50) uptrend). REVERTED: didn't fix the
#        asymmetry either - remaining SHORT trades (taken during confirmed
#        index downtrends) still averaged -1.55%, worse than baseline.
#   None of the SHORT-targeted fixes worked - this looks like a genuine,
#   structural characteristic of shorting individual BIST stocks over this
#   period/instrument set, not a filter bug. Rather than claim a fix the
#   evidence doesn't support, _decide_signal applies an explicit score
#   penalty to SHORT signals and surfaces this finding in the signal's
#   `reasons`, so the UI's confidence label honestly reflects the weaker
#   backtested edge instead of overstating it.
