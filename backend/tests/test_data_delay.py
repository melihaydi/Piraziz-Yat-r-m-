import time
from types import SimpleNamespace
from unittest.mock import patch

from app.api import deps
from app.services.market_data import MarketDataService


def _service():
    # Avoids MarketDataService.__init__'s real WebSocket thread - get_quote/
    # get_candles are monkeypatched directly below, so no real stream is needed.
    return MarketDataService.__new__(MarketDataService)


def test_get_delayed_quote_returns_live_when_delay_is_zero():
    svc = _service()
    live = {"last": 100.0, "prev_close": 95.0, "change_percent": 5.26}
    with patch.object(svc, "get_quote", return_value=live):
        assert svc.get_delayed_quote("THYAO", 0) is live


def test_get_delayed_quote_backdates_price_from_1m_candles():
    svc = _service()
    now = time.time()
    live = {"last": 110.0, "prev_close": 100.0, "change_percent": 10.0}
    candles = [
        {"time": now - 20 * 60, "close": 100.0},
        {"time": now - 16 * 60, "close": 103.0},
        {"time": now - 10 * 60, "close": 108.0},  # too recent for a 15min delay
    ]
    with patch.object(svc, "get_quote", return_value=live), \
         patch.object(svc, "get_candles", return_value=candles):
        delayed = svc.get_delayed_quote("THYAO", 15)

    assert delayed["is_delayed"] is True
    assert delayed["delay_minutes"] == 15
    # Only the 16-min-old bar is >= 15 minutes old, so its close is used.
    assert delayed["last"] == 103.0
    assert delayed["change_percent"] == 3.0


def test_get_delayed_quote_falls_back_to_live_with_no_candle_history():
    svc = _service()
    live = {"last": 100.0, "prev_close": 95.0, "change_percent": 5.26}
    with patch.object(svc, "get_quote", return_value=live), \
         patch.object(svc, "get_candles", return_value=[]):
        assert svc.get_delayed_quote("THYAO", 15) == live


def test_get_delayed_quote_falls_back_to_live_when_prev_close_missing():
    # Without a real prev_close to anchor against, fabricating a delayed
    # change_percent would silently produce a fake 0% instead of the real
    # delayed movement - safer to just serve the live quote as-is.
    svc = _service()
    now = time.time()
    live = {"last": 100.0, "change_percent": 5.26}  # no prev_close
    candles = [{"time": now - 20 * 60, "close": 90.0}]
    with patch.object(svc, "get_quote", return_value=live), \
         patch.object(svc, "get_candles", return_value=candles):
        assert svc.get_delayed_quote("THYAO", 15) == live


def test_get_delayed_candles_drops_bars_newer_than_delay():
    svc = _service()
    now = time.time()
    candles = [
        {"time": now - 20 * 60, "close": 100.0},
        {"time": now - 10 * 60, "close": 105.0},
        {"time": now - 2 * 60, "close": 108.0},
    ]
    with patch.object(svc, "get_candles", return_value=candles):
        result = svc.get_delayed_candles("THYAO", "1m", 15)

    assert result == candles[:1]


def test_get_delayed_candles_returns_all_when_delay_is_zero():
    svc = _service()
    candles = [{"time": time.time(), "close": 100.0}]
    with patch.object(svc, "get_candles", return_value=candles):
        assert svc.get_delayed_candles("THYAO", "1m", 0) == candles


def _user(role: str):
    return SimpleNamespace(role=role)


def test_get_data_delay_minutes_is_zero_for_premium():
    assert deps.get_data_delay_minutes(_user("premium")) == 0


def test_get_data_delay_minutes_is_delayed_for_free():
    assert deps.get_data_delay_minutes(_user("free")) == deps.DELAYED_DATA_MINUTES
