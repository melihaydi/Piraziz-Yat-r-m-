from app.api.v1.endpoints.screener import _resample_candles


def test_resample_candles_merges_pairs_into_2h():
    hourly = [
        {"time": 1000, "open": 10.0, "high": 11.0, "low": 9.5, "close": 10.5, "volume": 100},
        {"time": 4600, "open": 10.5, "high": 12.0, "low": 10.0, "close": 11.8, "volume": 150},
        {"time": 8200, "open": 11.8, "high": 12.5, "low": 11.5, "close": 12.0, "volume": 200},
        {"time": 11800, "open": 12.0, "high": 12.2, "low": 11.0, "close": 11.2, "volume": 120},
    ]

    result = _resample_candles(hourly, group_size=2)

    assert len(result) == 2
    first, second = result

    assert first["time"] == 1000
    assert first["open"] == 10.0
    assert first["high"] == 12.0
    assert first["low"] == 9.5
    assert first["close"] == 11.8
    assert first["volume"] == 250

    assert second["time"] == 8200
    assert second["open"] == 11.8
    assert second["high"] == 12.5
    assert second["low"] == 11.0
    assert second["close"] == 11.2
    assert second["volume"] == 320


def test_resample_candles_keeps_odd_trailing_candle_as_partial_group():
    hourly = [
        {"time": 1000, "open": 10.0, "high": 11.0, "low": 9.5, "close": 10.5, "volume": 100},
        {"time": 4600, "open": 10.5, "high": 12.0, "low": 10.0, "close": 11.8, "volume": 150},
        {"time": 8200, "open": 11.8, "high": 12.5, "low": 11.5, "close": 12.0, "volume": 200},
    ]

    result = _resample_candles(hourly, group_size=2)

    # An odd trailing 1h candle becomes its own 2h bar rather than being
    # dropped - it's a forming/partial period, same as how a real 2h bar
    # looks mid-way through its second hour.
    assert len(result) == 2
    assert result[1]["time"] == 8200
    assert result[1]["close"] == 12.0
    assert result[1]["volume"] == 200


def test_resample_candles_empty_input():
    assert _resample_candles([], group_size=2) == []
