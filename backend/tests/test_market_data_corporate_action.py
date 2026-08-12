from app.services.market_data import MarketDataService


def _service():
    # Avoids MarketDataService.__init__ (which starts a real background
    # WebSocket thread) - _correct_stale_corporate_action doesn't touch any
    # instance state, so a bare instance is fine.
    return MarketDataService.__new__(MarketDataService)


def test_corrects_implausible_change_for_known_ratio():
    # KTLEV's real %238.16 bedelsiz issue (ex-date 2026-08-03) left
    # TradingView's live feed reporting change against the pre-action
    # prev_close, producing a fake ~-73% "crash" (impossible under BIST's
    # ~+-10% daily limit). The corrected number should land close to -10%.
    item = {"last": 41.42, "change": -114.2, "change_percent": -73.38, "prev_close": 155.62}
    _service()._correct_stale_corporate_action("KTLEV", item)
    assert -11.0 < item["change_percent"] < -9.0
    assert item["prev_close"] == item["last"] - item["change"]


def test_leaves_plausible_change_untouched_even_for_known_symbol():
    # Once TradingView's own feed catches up (or on a day where the raw
    # change is already within plausible bounds), the correction must not
    # fire - guards against a double-correction once the feed self-heals.
    item = {"last": 46.0, "change": -0.5, "change_percent": -1.08, "prev_close": 46.5}
    _service()._correct_stale_corporate_action("KTLEV", item)
    assert item["change_percent"] == -1.08
    assert item["prev_close"] == 46.5


def test_is_known_ticker_recognizes_usdtry_and_gram_altin():
    # Needed so a portfolio holding USD/TRY or gram altın (added via
    # Yönetilen Portföyler) gets a real daily %change like a stock, not
    # just a price - see is_known_ticker's docstring.
    svc = _service()
    svc.tickers = [{"ticker": "THYAO"}]
    assert svc.is_known_ticker("USDTRY") is True
    assert svc.is_known_ticker("usdtry") is True
    assert svc.is_known_ticker("XAUTRYG") is True
    assert svc.is_known_ticker("THYAO") is True
    assert svc.is_known_ticker("NOTAREALTICKER") is False


def test_is_known_ticker_does_not_recognize_gold_viop_alias():
    # "GOLD" (TVC) is only the Trade module's VİOP-contract pricing alias
    # for XAUUSD, not a separately holdable portfolio symbol - see
    # _NON_STOCK_LIVE_SYMBOLS's comment for why it's deliberately excluded.
    svc = _service()
    svc.tickers = []
    assert svc.is_known_ticker("GOLD") is False


def test_ignores_symbols_with_no_known_corporate_action():
    item = {"last": 100.0, "change": -80.0, "change_percent": -80.0, "prev_close": 180.0}
    _service()._correct_stale_corporate_action("THYAO", item)
    assert item["change_percent"] == -80.0
    assert item["prev_close"] == 180.0
