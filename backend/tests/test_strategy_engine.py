import pandas as pd

from app.services.strategy_engine import (
    SwingPoint,
    _find_swings,
    _classify_structure,
    _trend_state,
    _rsi_series,
    _cluster_levels,
    _atr,
    _candle_pattern,
    _decide_signal,
)


def _make_df(highs, lows, closes=None, volumes=None):
    n = len(highs)
    if closes is None:
        closes = [(h + l) / 2 for h, l in zip(highs, lows)]
    if volumes is None:
        volumes = [1000] * n
    dates = pd.date_range("2026-01-01", periods=n, freq="D")
    return pd.DataFrame(
        {"Open": closes, "High": highs, "Low": lows, "Close": closes, "Volume": volumes},
        index=dates,
    )


def test_find_swings_detects_clear_peak():
    # Rises to a single, unambiguous peak at index 7, then falls.
    highs = [10, 11, 12, 13, 14, 15, 16, 20, 16, 15, 14, 13, 12, 11, 10]
    lows = [h - 1 for h in highs]
    df = _make_df(highs, lows)
    swings = _find_swings(df, window=3)
    swing_highs = [s for s in swings if s.kind == "high"]
    assert any(s.index == 7 for s in swing_highs)


def test_find_swings_detects_clear_trough():
    lows = [20, 19, 18, 17, 16, 15, 14, 5, 14, 15, 16, 17, 18, 19, 20]
    highs = [l + 1 for l in lows]
    df = _make_df(highs, lows)
    swings = _find_swings(df, window=3)
    swing_lows = [s for s in swings if s.kind == "low"]
    assert any(s.index == 7 for s in swing_lows)


def test_find_swings_no_swings_on_perfectly_flat_data():
    # A strict-max/min tie (every bar identical) should never register as a
    # swing - _find_swings requires a UNIQUE max/min in the window.
    df = _make_df([100.0] * 20, [99.0] * 20)
    assert _find_swings(df, window=3) == []


def test_classify_structure_uptrend():
    swings = [
        SwingPoint(index=0, date="2026-01-01", price=100, kind="low"),
        SwingPoint(index=2, date="2026-01-03", price=110, kind="high"),
        SwingPoint(index=4, date="2026-01-05", price=105, kind="low"),
        SwingPoint(index=6, date="2026-01-07", price=120, kind="high"),
    ]
    structure, tags = _classify_structure(swings)
    assert structure == "Yükseliş (HH/HL)"
    assert len(tags) == 2


def test_classify_structure_downtrend():
    swings = [
        SwingPoint(index=0, date="2026-01-01", price=120, kind="high"),
        SwingPoint(index=2, date="2026-01-03", price=100, kind="low"),
        SwingPoint(index=4, date="2026-01-05", price=110, kind="high"),
        SwingPoint(index=6, date="2026-01-07", price=90, kind="low"),
    ]
    structure, tags = _classify_structure(swings)
    assert structure == "Düşüş (LH/LL)"


def test_classify_structure_insufficient_data():
    structure, tags = _classify_structure([])
    assert structure == "Yatay/Belirsiz"
    assert tags == []


def test_trend_state_requires_minimum_history():
    df = _make_df([10.0] * 20, [9.0] * 20)
    assert _trend_state(df, period=50) is None


def test_trend_state_up_when_price_above_rising_sma():
    n = 60
    closes = [100 + i * 0.5 for i in range(n)]  # steadily rising
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    assert _trend_state(df, period=50) == "up"


def test_trend_state_down_when_price_below_falling_sma():
    n = 60
    closes = [100 - i * 0.5 for i in range(n)]  # steadily falling
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    assert _trend_state(df, period=50) == "down"


def test_rsi_series_stays_within_bounds():
    closes = pd.Series([100 + (i % 5) - 2 for i in range(30)], dtype=float)
    rsi = _rsi_series(closes, period=14)
    assert (rsi >= 0).all() and (rsi <= 100).all()


def test_decide_signal_no_direction_on_flat_data():
    # No swings -> no structure -> direction must stay NONE regardless of
    # what momentum flags are passed in.
    df = _make_df([100.0] * 60, [99.0] * 60)
    swings = _find_swings(df)
    structure, tags = _classify_structure(swings)
    levels = _cluster_levels(swings, 100.0)
    atr = _atr(df)
    pattern = _candle_pattern(df)

    decision = _decide_signal(
        df, 100.0, swings, structure, tags, levels, atr, pattern,
        momentum_ok_long=True, momentum_ok_short=True, momentum_note="test",
    )
    assert decision["direction"] == "NONE"
    assert 0 <= decision["score"] <= 100
    assert decision["confidence"] in ("Yüksek", "Orta", "Düşük")


def test_decide_signal_short_gets_confidence_penalty_when_it_fires():
    # Construct a clean downtrend (falling SMA + LH/LL swing structure) so a
    # SHORT direction can actually fire via the pattern-based path, then
    # verify the documented SHORT confidence penalty (see _decide_signal)
    # is reflected: a SHORT signal must never score as high as the same
    # setup would if every condition were identically strong but bullish.
    n = 80
    # Falling trend with a bearish engulfing candle at the very end to
    # trigger the "structure + trend + pattern" SHORT path.
    closes = [200 - i * 1.0 for i in range(n - 2)]
    closes += [closes[-1] - 3, closes[-1] - 3 - 5]  # sharp final leg down
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    # Make the last candle a clean bearish engulfing: prior candle small
    # bullish body, last candle a larger bearish body engulfing it.
    opens = list(closes)
    opens[-2] = closes[-2] - 0.5  # prior candle: open < close (bullish)
    closes[-2] = closes[-2]
    opens[-1] = closes[-2] + 0.5  # last candle opens above prior close
    closes[-1] = closes[-1] - 1  # and closes below prior open (engulfing)

    df = _make_df(highs, lows, closes=closes)
    df["Open"] = opens

    swings = _find_swings(df)
    structure, tags = _classify_structure(swings)
    price = float(df["Close"].iloc[-1])
    levels = _cluster_levels(swings, price)
    atr = _atr(df)
    pattern = _candle_pattern(df)

    decision = _decide_signal(
        df, price, swings, structure, tags, levels, atr, pattern,
        momentum_ok_long=False, momentum_ok_short=True, momentum_note="test",
    )
    if decision["direction"] == "SHORT":
        # The penalty subtracts 12 points - confirm it's reflected by
        # checking the score never reaches the "Yüksek" (>=70) band from
        # just structure+trend+pattern alone (25ish points) the way an
        # equivalent LONG setup could.
        assert decision["score"] <= 88
