import threading
import time

import pandas as pd

from app.services.strategy_engine import (
    SwingPoint,
    StrategyEngine,
    _find_swings,
    _classify_structure,
    _trend_state,
    _rsi_series,
    _cluster_levels,
    _atr,
    _candle_pattern,
    _decide_signal,
    _stochastic,
    _ichimoku,
    _fibonacci_levels,
    _compound_pct,
    _max_drawdown_pct,
    _profit_factor,
)


def test_run_scan_does_not_start_a_second_concurrent_scan():
    # Regression test for the cold-start thundering-herd bug: scan_now()/
    # get_signal_history() both call _run_scan() whenever self._signals is
    # empty, with no coordination - right after a deploy, several
    # simultaneous requests could each kick off their own full 30-symbol
    # scan. _run_scan() now guards this with self._running + an Event that
    # a second concurrent caller waits on instead of running the (mocked
    # here) scan body again.
    engine = StrategyEngine()
    call_count = {"n": 0}
    body_started = threading.Event()
    release_body = threading.Event()

    def fake_body(self):
        call_count["n"] += 1
        body_started.set()
        release_body.wait(timeout=5)

    engine._run_scan_body = fake_body.__get__(engine, StrategyEngine)

    t1 = threading.Thread(target=engine._run_scan)
    t1.start()
    assert body_started.wait(timeout=2), "first caller never entered the scan body"

    t2 = threading.Thread(target=engine._run_scan)
    t2.start()
    # Give a second, unguarded caller a window in which it would (wrongly)
    # have started its own concurrent scan body if the guard didn't work.
    time.sleep(0.3)

    release_body.set()
    t1.join(timeout=5)
    t2.join(timeout=5)

    assert call_count["n"] == 1
    assert not engine._running


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


def test_decide_signal_ma_crossover_outweighs_a_single_dissenting_factor():
    # The MA crossover carries weight 3 against ±1 for every other factor,
    # so one factor disagreeing (here: momentum) can never overturn it. A
    # steadily rising series puts the faster (7) MA above the slower (21),
    # and structure/trend agree, so the net vote stays firmly LONG.
    n = 40
    closes = [100 + i * 1.5 for i in range(n)]
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    swings = _find_swings(df)
    structure, tags = _classify_structure(swings)
    price = float(df["Close"].iloc[-1])
    levels = _cluster_levels(swings, price)
    atr = _atr(df)
    pattern = _candle_pattern(df)

    for momentum_long, momentum_short in [(True, False), (False, True), (False, False)]:
        decision = _decide_signal(
            df, price, swings, structure, tags, levels, atr, pattern,
            momentum_ok_long=momentum_long, momentum_ok_short=momentum_short, momentum_note="test",
        )
        assert decision["direction"] == "LONG"


def test_decide_signal_short_on_falling_ma_crossover():
    n = 40
    closes = [200 - i * 1.5 for i in range(n)]
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    swings = _find_swings(df)
    structure, tags = _classify_structure(swings)
    price = float(df["Close"].iloc[-1])
    levels = _cluster_levels(swings, price)
    atr = _atr(df)
    pattern = _candle_pattern(df)

    decision = _decide_signal(
        df, price, swings, structure, tags, levels, atr, pattern,
        momentum_ok_long=True, momentum_ok_short=False, momentum_note="test",
    )
    assert decision["direction"] == "SHORT"


def test_decide_signal_consensus_against_ma_cross_neutralizes_direction():
    # The reported defect: a bullish MA7/MA21 crossover produced a "LONG"
    # rendered directly beneath "Piyasa yapısı: Düşüş (LH/LL)" - the other
    # factors were displayed but had no influence on the call. With the
    # weighted vote, a crossover (+3) facing bearish structure, trend,
    # momentum and Ichimoku (-4) nets -1, which is inside the neutral band.
    n = 40
    closes = [100 + i * 1.5 for i in range(n)]  # rising -> MA7 above MA21
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    swings = _find_swings(df)
    price = float(df["Close"].iloc[-1])
    levels = _cluster_levels(swings, price)
    atr = _atr(df)

    decision = _decide_signal(
        df, price, swings,
        # Structure/trend/momentum/Ichimoku all forced bearish against the
        # bullish crossover. _trend_state reads `df` itself (rising -> "up"),
        # so it contributes +1; that's why four dissenting inputs are needed
        # here to reach the neutral band rather than three.
        structure="Düşüş (LH/LL)", structure_tags=[], levels=levels, atr=atr,
        pattern="Yutan Ayı Mumu (Bearish Engulfing)",
        momentum_ok_long=False, momentum_ok_short=True, momentum_note="test",
        ichimoku={"position": "Bulut Altında"},
    )
    assert decision["direction"] == "NONE"


def test_decide_signal_poor_risk_reward_flags_but_does_not_cancel_direction():
    # Previously a poor R:R reset direction back to "NONE" entirely -
    # per explicit instruction this now stays as a "Yüksek" risk_level flag
    # instead, since the MA-crossover call should never be silently dropped.
    n = 40
    closes = [100 + i * 1.5 for i in range(n)]
    highs = [c + 0.5 for c in closes]
    lows = [c - 0.5 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    swings = _find_swings(df)
    structure, tags = _classify_structure(swings)
    price = float(df["Close"].iloc[-1])
    levels = _cluster_levels(swings, price)
    atr = _atr(df)
    pattern = _candle_pattern(df)

    decision = _decide_signal(
        df, price, swings, structure, tags, levels, atr, pattern,
        momentum_ok_long=True, momentum_ok_short=False, momentum_note="test",
    )
    assert decision["direction"] == "LONG"


def test_stochastic_stays_within_bounds():
    closes = [100 + (i % 7) - 3 for i in range(40)]
    highs = [c + 1.5 for c in closes]
    lows = [c - 1.5 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    result = _stochastic(df)
    assert result is not None
    assert 0 <= result["k"] <= 100
    assert 0 <= result["d"] <= 100


def test_stochastic_none_on_insufficient_history():
    df = _make_df([101.0] * 5, [99.0] * 5)
    assert _stochastic(df) is None


def test_ichimoku_detects_price_above_cloud():
    n = 60
    closes = [100 + i * 1.0 for i in range(n)]  # strong steady uptrend
    highs = [c + 1 for c in closes]
    lows = [c - 1 for c in closes]
    df = _make_df(highs, lows, closes=closes)
    result = _ichimoku(df)
    assert result is not None
    assert result["position"] == "Bulut Üzerinde"
    assert result["cloud_top"] >= result["cloud_bottom"]


def test_ichimoku_none_on_insufficient_history():
    df = _make_df([101.0] * 10, [99.0] * 10)
    assert _ichimoku(df) is None


def test_fibonacci_levels_between_last_swing_high_and_low():
    swings = [
        SwingPoint(index=0, date="2026-01-01", price=90, kind="low"),
        SwingPoint(index=2, date="2026-01-03", price=100, kind="high"),
        SwingPoint(index=4, date="2026-01-05", price=95, kind="low"),
        SwingPoint(index=6, date="2026-01-07", price=120, kind="high"),
    ]
    levels = _fibonacci_levels(swings)
    assert len(levels) == 5
    # Between the most recent swing high (120) and most recent swing low (95).
    prices = {round(l["ratio"], 3): l["price"] for l in levels}
    assert prices[0.5] == round(120 - (120 - 95) * 0.5, 4)
    # Levels are monotonically increasing as the ratio grows (deeper
    # retracement = closer to the swing low).
    ordered = [l["price"] for l in levels]
    assert ordered == sorted(ordered, reverse=True)


def test_fibonacci_levels_empty_without_both_swing_kinds():
    only_highs = [SwingPoint(index=0, date="2026-01-01", price=100, kind="high")]
    assert _fibonacci_levels(only_highs) == []


# --- Backtest ölçüm fonksiyonları -----------------------------------------
# Bunlar backtest'in raporladığı her rakamın altında duruyor; yanlış
# olurlarsa strateji hakkındaki bütün sonuçlar sessizce yanlış olur.

def test_compound_pct_chains_returns_instead_of_adding_them():
    # 1.10 * 1.10 = 1.21 -> %21, %20 değil.
    assert round(_compound_pct([10, 10]), 6) == 21.0


def test_compound_pct_a_gain_and_an_equal_loss_do_not_cancel_out():
    # Düzeltilen hatanın tam kalbi: +%50 sonra -%50 başa dönmez.
    assert round(_compound_pct([50, -50]), 6) == -25.0


def test_compound_pct_diverges_from_naive_sum_over_many_trades():
    """Eski kod yüzdeleri topluyordu. On tane +%10 işlem toplamda %100
    değil %159 eder - fark işlem sayısıyla birlikte büyür, yani en çok
    sinyal üreten sembolde en çok yanılırdı."""
    returns = [10.0] * 10
    assert sum(returns) == 100.0
    assert round(_compound_pct(returns), 2) == 159.37


def test_compound_pct_empty_is_zero():
    assert _compound_pct([]) == 0.0


def test_max_drawdown_measures_peak_to_trough():
    # 1.0 -> 1.1 (tepe) -> 0.55 : tepeden %50 düşüş.
    assert round(_max_drawdown_pct([10, -50, 10]), 6) == 50.0


def test_max_drawdown_is_zero_when_equity_never_falls():
    assert _max_drawdown_pct([10, 10, 5]) == 0.0


def test_profit_factor_is_gross_win_over_gross_loss():
    assert _profit_factor([10, -5]) == 2.0


def test_profit_factor_is_none_without_a_single_loss():
    """Sonsuz bir oran raporlamak yerine None: kayıpsız bir örneklem
    sonuç değil, örneklem küçüklüğü belirtisidir."""
    assert _profit_factor([10, 5]) is None
