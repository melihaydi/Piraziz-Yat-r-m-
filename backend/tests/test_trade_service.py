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

    def _get_live_price(instrument_type, symbol, delay_minutes=0):
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


def test_create_account_allows_multiple_per_user(db, account):
    second = trade_service.create_account(db, user_id=1, broker="info_yatirim", starting_balance=50000.0)
    assert second.id != account.id
    accounts = trade_service.get_accounts(db, user_id=1)
    assert len(accounts) == 2


def test_create_account_auto_names_sequentially(db):
    first = trade_service.create_account(db, user_id=5, broker="midas", starting_balance=100000.0)
    second = trade_service.create_account(db, user_id=5, broker="midas", starting_balance=100000.0)
    assert first.name == "Portföy 1"
    assert second.name == "Portföy 2"


def test_create_account_accepts_custom_name(db):
    acc = trade_service.create_account(db, user_id=6, broker="midas", starting_balance=100000.0, name="Agresif Strateji")
    assert acc.name == "Agresif Strateji"


def test_get_account_returns_the_oldest_as_default(db):
    first = trade_service.create_account(db, user_id=7, broker="midas", starting_balance=100000.0)
    trade_service.create_account(db, user_id=7, broker="midas", starting_balance=100000.0)
    assert trade_service.get_account(db, user_id=7).id == first.id


def test_get_account_by_id_enforces_ownership(db, account):
    other_user_account = trade_service.create_account(db, user_id=999, broker="midas", starting_balance=100000.0)
    assert trade_service.get_account_by_id(db, user_id=1, account_id=other_user_account.id) is None
    assert trade_service.get_account_by_id(db, user_id=999, account_id=other_user_account.id) is not None


def test_rename_account(db, account):
    renamed = trade_service.rename_account(db, account, "Yeni İsim")
    assert renamed.name == "Yeni İsim"


def test_rename_account_rejects_blank_name(db, account):
    with pytest.raises(TradeError):
        trade_service.rename_account(db, account, "   ")


def test_delete_account_removes_it(db, account):
    second = trade_service.create_account(db, user_id=1, broker="info_yatirim", starting_balance=50000.0)
    trade_service.delete_account(db, second)
    remaining = trade_service.get_accounts(db, user_id=1)
    assert len(remaining) == 1
    assert remaining[0].id == account.id


def test_delete_account_rejects_the_last_remaining_account(db, account):
    with pytest.raises(TradeError):
        trade_service.delete_account(db, account)
    assert trade_service.get_accounts(db, user_id=1) == [account]


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


def test_get_performance_counts_viop_short_covers_not_just_sat_orders(db, account, fixed_price):
    # realized_pnl for a VİOP short-cover lands on the AL order, not a SAT
    # one - get_performance previously filtered by side=="SAT" only and
    # silently dropped every such trade from win-rate/realized P&L.
    trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    fixed_price["value"] = 80.0  # price falls - a winning short cover
    trade_service.place_order(db, account, "viop", "XU030F", "AL", 5, order_type="MARKET")

    perf = trade_service.get_performance(db, account)
    assert perf["closed_trades"] == 1
    assert perf["win_rate_pct"] == 100.0
    assert perf["realized_pnl"] > 0


# --- STOP / STOP_LIMIT orders --------------------------------------------

def test_stop_order_requires_positive_stop_price(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="STOP", stop_price=0)


def test_stop_limit_order_requires_both_prices(db, account, fixed_price):
    with pytest.raises(TradeError):
        trade_service.place_order(
            db, account, "stock", "AKBNK", "SAT", 10, order_type="STOP_LIMIT", stop_price=90.0, limit_price=None
        )


def test_stop_loss_sell_does_not_trigger_before_price_falls_to_stop(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="STOP", stop_price=90.0)
    fixed_price["value"] = 95.0  # still above the stop
    trade_service.serialize_account(db, account)
    assert len(trade_service.get_pending_orders(db, account)) == 1


def test_stop_loss_sell_fills_at_live_price_once_triggered(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="STOP", stop_price=90.0)
    fixed_price["value"] = 88.0  # gaps below the stop
    result = trade_service.serialize_account(db, account)
    assert trade_service.get_pending_orders(db, account) == []
    assert result["positions"] == []
    history = trade_service.get_history(db, account)
    fill = next(o for o in history if o["side"] == "SAT")
    # A STOP fills at the live price (88.0), not the stop trigger (90.0).
    assert fill["price"] == 88.0


def test_stop_buy_triggers_on_breakout_above_stop_price(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="STOP", stop_price=110.0)
    fixed_price["value"] = 115.0  # breaks out above the stop
    trade_service.serialize_account(db, account)
    assert trade_service.get_pending_orders(db, account) == []
    positions = trade_service.get_positions(db, account)
    assert len(positions) == 1
    assert positions[0]["avg_cost"] == 115.0


def test_stop_limit_converts_to_resting_limit_once_triggered(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    trade_service.place_order(
        db, account, "stock", "AKBNK", "SAT", 10, order_type="STOP_LIMIT", stop_price=90.0, limit_price=89.0
    )
    fixed_price["value"] = 89.5  # crosses the stop but not (yet) the limit
    trade_service.serialize_account(db, account)
    pending = trade_service.get_pending_orders(db, account)
    assert len(pending) == 1
    assert pending[0]["order_type"] == "LIMIT"  # converted, still resting

    fixed_price["value"] = 89.0  # now also satisfies the limit
    trade_service.serialize_account(db, account)
    assert trade_service.get_pending_orders(db, account) == []
    history = trade_service.get_history(db, account)
    fill = next(o for o in history if o["side"] == "SAT")
    assert fill["price"] == 89.0


def test_stop_order_reserves_cash_based_on_stop_price(db, account, fixed_price):
    result = trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="STOP", stop_price=120.0)
    expected_reserved = round(120.0 * 10 + round(120.0 * 10 * trade_service.COMMISSION_RATE, 2), 2)
    assert result["locked_cash"] == expected_reserved


def test_cancel_stop_order_releases_locked_cash(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="STOP", stop_price=120.0)
    pending = trade_service.get_pending_orders(db, account)
    result = trade_service.cancel_pending_order(db, account, pending[0]["id"])
    assert result["locked_cash"] == 0.0


# --- tax report -----------------------------------------------------

def test_tax_report_empty_account_has_no_years(db, account, fixed_price):
    report = trade_service.get_tax_report(db, account)
    assert report["years"] == []


def test_tax_report_groups_current_year_stock_gain(db, account, fixed_price):
    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 120.0
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="MARKET")

    from datetime import datetime
    report = trade_service.get_tax_report(db, account)
    assert len(report["years"]) == 1
    year_row = report["years"][0]
    assert year_row["year"] == datetime.now().year
    assert year_row["stock_trade_count"] == 1
    assert year_row["stock_realized_pnl"] > 0
    # Default stock stopaj is 0% - a gain still produces zero stopaj.
    assert year_row["stock_stopaj_estimate"] == 0.0
    assert year_row["net_after_stopaj_estimate"] == year_row["total_realized_pnl"]


def test_tax_report_applies_viop_stopaj_only_to_gains(db, account, fixed_price):
    # A losing VİOP trade: short then cover at a higher price (a loss).
    trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    fixed_price["value"] = 120.0  # price rose - a loss for the short
    trade_service.place_order(db, account, "viop", "XU030F", "AL", 5, order_type="MARKET")

    report = trade_service.get_tax_report(db, account, viop_stopaj_pct=10.0)
    year_row = report["years"][0]
    assert year_row["viop_realized_pnl"] < 0
    # Losses owe no stopaj (not netted/refunded against nothing).
    assert year_row["viop_stopaj_estimate"] == 0.0


def test_tax_report_computes_viop_stopaj_on_a_gain(db, account, fixed_price):
    trade_service.place_order(db, account, "viop", "XU030F", "SAT", 5, order_type="MARKET")
    fixed_price["value"] = 80.0  # price fell - a gain for the short
    trade_service.place_order(db, account, "viop", "XU030F", "AL", 5, order_type="MARKET")

    report = trade_service.get_tax_report(db, account, viop_stopaj_pct=10.0)
    year_row = report["years"][0]
    assert year_row["viop_realized_pnl"] > 0
    expected_stopaj = round(year_row["viop_realized_pnl"] * 0.10, 2)
    assert year_row["viop_stopaj_estimate"] == expected_stopaj
    assert year_row["net_after_stopaj_estimate"] == round(
        year_row["total_realized_pnl"] - expected_stopaj, 2
    )


def test_tax_report_splits_across_years(db, account, fixed_price):
    from datetime import datetime, timezone
    from app.models.trade import TradeOrder

    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 110.0
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="MARKET")

    # Backdate this sell order to the prior year to exercise year-bucketing -
    # executed_at is normally a DB server_default, not settable at placement.
    sell_order = db.query(TradeOrder).filter(TradeOrder.side == "SAT").first()
    last_year = datetime.now(timezone.utc).year - 1
    sell_order.executed_at = datetime(last_year, 12, 15, tzinfo=timezone.utc)
    db.commit()

    trade_service.place_order(db, account, "stock", "AKBNK", "AL", 10, order_type="MARKET")
    fixed_price["value"] = 130.0
    trade_service.place_order(db, account, "stock", "AKBNK", "SAT", 10, order_type="MARKET")

    report = trade_service.get_tax_report(db, account)
    assert len(report["years"]) == 2
    assert report["years"][0]["year"] == datetime.now().year  # newest first
    assert report["years"][1]["year"] == last_year
