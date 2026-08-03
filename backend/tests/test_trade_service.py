import pytest

from app.services import trade_service
from app.services.trade_service import TradeError


@pytest.fixture
def account(db):
    return trade_service.create_account(db, user_id=1, broker="midas", starting_balance=100000.0)


@pytest.fixture
def fixed_price(monkeypatch):
    """Pins every price lookup trade_service can make (both get_live_price,
    used by order placement/positions, and market_data_service.get_quote,
    used directly by get_watchlist/get_viop_watchlist) to one controllable
    value, instead of hitting the real TradingView cache."""
    price = {"value": 100.0}

    def _get_live_price(instrument_type, symbol):
        return price["value"]

    def _get_quote(symbol):
        return {"last": price["value"], "change_percent": 0.0, "bid": None, "ask": None}

    monkeypatch.setattr(trade_service, "get_live_price", _get_live_price)
    monkeypatch.setattr(trade_service.market_data_service, "get_quote", _get_quote)
    return price


# --- account lifecycle -------------------------------------------------

def test_create_account_rejects_invalid_broker(db):
    with pytest.raises(TradeError):
        trade_service.create_account(db, user_id=1, broker="not_a_broker", starting_balance=100000.0)


def test_create_account_rejects_duplicate(db, account):
    with pytest.raises(TradeError):
        trade_service.create_account(db, user_id=1, broker="info_yatirim", starting_balance=50000.0)


def test_create_account_uses_default_balance_when_nonpositive(db):
    acc = trade_service.create_account(db, user_id=2, broker="midas", starting_balance=0.0)
    assert acc.starting_balance == trade_service.DEFAULT_STARTING_BALANCE
    assert acc.cash_balance == trade_service.DEFAULT_STARTING_BALANCE


def test_change_broker_rejects_invalid_broker(db, account):
    with pytest.raises(TradeError):
        trade_service.change_broker(db, account, "not_a_broker")


def test_change_broker_updates_in_place(db, account):
    updated = trade_service.change_broker(db, account, "info_yatirim")
    assert updated.broker == "info_yatirim"


def test_deposit_funds_rejects_nonpositive_amount(db, account):
    with pytest.raises(TradeError):
        trade_service.deposit_funds(db, account, 0.0)
    with pytest.raises(TradeError):
        trade_service.deposit_funds(db, account, -50.0)


def test_deposit_funds_increases_cash_and_starting_balance(db, account):
    trade_service.deposit_funds(db, account, 5000.0)
    assert account.cash_balance == 105000.0
    # starting_balance moves too, so return_pct isn't inflated by a deposit.
    assert account.starting_balance == 105000.0


def test_reset_account_wipes_positions_and_resets_balance(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    assert len(trade_service.get_positions(db, account)) == 1

    trade_service.reset_account(db, account, starting_balance=200000.0)
    assert account.cash_balance == 200000.0
    assert account.starting_balance == 200000.0
    assert trade_service.get_positions(db, account) == []
    assert trade_service.get_history(db, account) == []


# --- market orders: stock (long-only) -----------------------------------

def test_place_market_buy_opens_stock_position(db, account, fixed_price):
    result = trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    assert len(result["positions"]) == 1
    pos = result["positions"][0]
    assert pos["symbol"] == "AKBNK"
    assert pos["position_side"] == "LONG"
    assert pos["lot"] == 10
    assert pos["avg_cost"] == 100.0
    # 10 * 100 notional + 0.1% commission spent from cash.
    expected_cash = 100000.0 - (1000.0 + round(1000.0 * trade_service.COMMISSION_RATE, 2))
    assert result["cash_balance"] == pytest.approx(expected_cash)


def test_place_order_rejects_non_bist30_stock(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "NOTATICKER", "AL", 1, order_type="MARKET")


def test_place_order_rejects_nonpositive_lot(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "AL", 0, order_type="MARKET")


def test_place_market_buy_rejects_insufficient_balance(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "AL", 100000, order_type="MARKET")


def test_stock_sell_without_position_is_rejected(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 5, order_type="MARKET")


def test_stock_sell_more_than_held_is_rejected(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 11, order_type="MARKET")


def test_stock_buy_then_sell_realizes_pnl_on_price_move(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 120.0  # price rises 20%
    result = trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="MARKET")
    assert result["positions"] == []
    history = trade_service.get_history(db, account)
    sell = next(o for o in history if o["side"] == "SAT")
    # (120 - 100) * 10 - commission
    expected_pnl = round((120.0 - 100.0) * 10 - round(120.0 * 10 * trade_service.COMMISSION_RATE, 2), 2)
    assert sell["realized_pnl"] == expected_pnl


def test_partial_stock_sell_keeps_remaining_lot_and_avg_cost(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    result = trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 4, order_type="MARKET")
    assert len(result["positions"]) == 1
    pos = result["positions"][0]
    assert pos["lot"] == 6
    assert pos["avg_cost"] == 100.0  # unchanged by a partial sell


def test_buying_more_averages_cost(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 200.0
    result = trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    pos = result["positions"][0]
    assert pos["lot"] == 20
    assert pos["avg_cost"] == pytest.approx(150.0)  # (10*100 + 10*200) / 20


# --- market orders: VİOP (shortable) -------------------------------------

def test_viop_sell_without_position_opens_short(db, account, fixed_price):
    result = trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    pos = result["positions"][0]
    assert pos["position_side"] == "SHORT"
    assert pos["lot"] == 5


def test_viop_short_profits_when_price_falls(db, account, fixed_price):
    trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    fixed_price["value"] = 80.0  # price falls 20%
    result = trade_service.place_order(db, account, "viop", "XU030F", "AL", 5, order_type="MARKET")
    assert result["positions"] == []
    history = trade_service.get_history(db, account)
    cover = next(o for o in history if o["side"] == "AL")
    expected_pnl = round((100.0 - 80.0) * 5 - round(80.0 * 5 * trade_service.COMMISSION_RATE, 2), 2)
    assert cover["realized_pnl"] == expected_pnl


def test_viop_rejects_covering_more_than_short_size(db, account, fixed_price):
    trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "viop", "XU030F", "AL", 6, order_type="MARKET")


def test_place_order_rejects_unknown_viop_contract(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "viop", "NOTACONTRACT", "AL", 1, order_type="MARKET")


# --- limit orders ----------------------------------------------------

def test_limit_buy_locks_cash_and_creates_pending_order(db, account, fixed_price):
    result = trade_service.place_order(
        db, account, "stock", "AKBNK", "AL", 10, order_type="LIMIT", limit_price=90.0
    )
    assert result["positions"] == []
    pending = trade_service.get_pending_orders(db, account)
    assert len(pending) == 1
    assert pending[0]["limit_price"] == 90.0
    expected_reserved = round(90.0 * 10 + round(90.0 * 10 * trade_service.COMMISSION_RATE, 2), 2)
    assert result["locked_cash"] == expected_reserved
    assert result["available_cash"] == pytest.approx(result["cash_balance"] - expected_reserved)


def test_limit_order_requires_positive_limit_price(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="LIMIT", limit_price=0)


def test_limit_buy_rejects_when_reservation_exceeds_available_cash(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(
            db, account, "stock", "AKBNK", "AL", 100000, order_type="LIMIT", limit_price=90.0
        )


def test_pending_buy_fills_once_price_drops_to_limit(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="LIMIT", limit_price=90.0)
    fixed_price["value"] = 85.0  # crosses the limit
    result = trade_service.serialize_account(db, account)  # triggers _check_pending_orders
    assert trade_service.get_pending_orders(db, account) == []
    assert len(result["positions"]) == 1
    assert result["positions"][0]["avg_cost"] == 90.0  # filled at limit_price, not live price


def test_pending_order_does_not_fill_before_price_crosses_limit(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="LIMIT", limit_price=90.0)
    fixed_price["value"] = 95.0  # still above the buy limit
    trade_service.serialize_account(db, account)
    assert len(trade_service.get_pending_orders(db, account)) == 1


def test_cancel_pending_order_releases_locked_cash(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="LIMIT", limit_price=90.0)
    pending = trade_service.get_pending_orders(db, account)
    result = trade_service.cancel_pending_order(db, account, pending[0]["id"])
    assert result["locked_cash"] == 0.0
    assert trade_service.get_pending_orders(db, account) == []


def test_cancel_pending_order_rejects_unknown_id(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.cancel_pending_order(db, account, 999999)


# --- read-only views ---------------------------------------------------

def test_get_watchlist_returns_all_bist30_tickers(fixed_price):
    items = trade_service.get_watchlist()
    assert len(items) == len(trade_service.BIST30_TICKERS)
    assert all(item["price"] == 100.0 for item in items)


def test_get_performance_reports_win_rate_and_equity_curve(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 120.0
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="MARKET")

    perf = trade_service.get_performance(db, account)
    assert perf["closed_trades"] == 1
    assert perf["win_rate_pct"] == 100.0
    assert perf["realized_pnl"] > 0
    assert len(perf["equity_curve"]) >= 1


def test_get_performance_on_fresh_account_has_no_trades(db, account, fixed_price):
    perf = trade_service.get_performance(db, account)
    assert perf["closed_trades"] == 0
    assert perf["win_rate_pct"] == 0.0
    assert perf["avg_win"] == 0.0
    assert perf["avg_loss"] == 0.0
