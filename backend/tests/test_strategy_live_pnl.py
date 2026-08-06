from unittest.mock import patch

from app.api.v1.endpoints.strategy import _enrich_with_live_pnl


def test_long_signal_captures_positive_pnl_when_price_rose():
    signal = {"ticker": "THYAO", "direction": "LONG", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["live_price"] == 315.0
    assert result["captured_pnl_pct"] == 5.0


def test_short_signal_captures_positive_pnl_when_price_fell():
    # A SHORT profits when price DROPS - captured_pnl_pct must flip sign
    # relative to a LONG for the same raw price move.
    signal = {"ticker": "THYAO", "direction": "SHORT", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 285.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["live_price"] == 285.0
    assert result["captured_pnl_pct"] == 5.0


def test_short_signal_shows_negative_pnl_when_price_rose_against_it():
    signal = {"ticker": "THYAO", "direction": "SHORT", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["captured_pnl_pct"] == -5.0


def test_none_direction_has_no_pnl():
    signal = {"ticker": "THYAO", "direction": "NONE", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["live_price"] == 315.0
    assert result["captured_pnl_pct"] is None


def test_unknown_ticker_never_calls_get_quote():
    # Same "check is_known_ticker before ever calling get_quote()" rule as
    # elsewhere - get_quote() always returns a truthy synthetic fallback for
    # unrecognized symbols, which would otherwise silently fabricate a price.
    signal = {"ticker": "NOTREAL", "direction": "LONG", "entry": 100.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=False), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote") as mock_get_quote:
        result = _enrich_with_live_pnl(signal)
        mock_get_quote.assert_not_called()

    assert result["live_price"] is None
    assert result["captured_pnl_pct"] is None


def test_missing_entry_has_no_pnl():
    signal = {"ticker": "THYAO", "direction": "LONG", "entry": None}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["captured_pnl_pct"] is None


def test_long_signal_captures_pnl_per_share_in_currency():
    signal = {"ticker": "THYAO", "direction": "LONG", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["captured_pnl_per_share"] == 15.0


def test_short_signal_pnl_per_share_flips_sign_vs_a_long_on_the_same_move():
    signal = {"ticker": "THYAO", "direction": "SHORT", "entry": 300.0}
    with patch("app.api.v1.endpoints.strategy.market_data_service.is_known_ticker", return_value=True), \
         patch("app.api.v1.endpoints.strategy.market_data_service.get_quote", return_value={"last": 315.0}):
        result = _enrich_with_live_pnl(signal)

    assert result["captured_pnl_per_share"] == -15.0
