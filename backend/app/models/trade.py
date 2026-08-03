from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class TradeAccount(Base):
    """
    Paper-trading account for the Trade module. Fully separate from the
    existing Portfolio feature (app/models/portfolio.py) - Portfolio tracks a
    user's *real* holdings for informational P&L, while TradeAccount is a
    simulated brokerage account with its own cash balance, positions and
    order history, seeded from a broker-selection onboarding flow.
    """
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, unique=True)
    broker = Column(String(50), nullable=False)  # "info_yatirim" | "midas"
    starting_balance = Column(Float, nullable=False, default=325000.0)
    cash_balance = Column(Float, nullable=False, default=325000.0)
    # Cash reserved for resting LIMIT buy orders (see TradePendingOrder) - not
    # yet spent, but not free to use for a second order either. Released back
    # when the order fills or is cancelled.
    locked_cash = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="trade_account", uselist=False)
    positions = relationship("TradePosition", backref="account", cascade="all, delete-orphan")
    orders = relationship("TradeOrder", backref="account", cascade="all, delete-orphan")
    snapshots = relationship("TradeDailySnapshot", backref="account", cascade="all, delete-orphan")
    pending_orders = relationship("TradePendingOrder", backref="account", cascade="all, delete-orphan")


class TradePosition(Base):
    """An open position within a TradeAccount. Stock and VİOP positions are
    tracked separately via instrument_type, even for the same account."""
    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("trade_account.id", ondelete="CASCADE"), nullable=False, index=True)
    instrument_type = Column(String(10), nullable=False)  # "stock" | "viop"
    symbol = Column(String(30), nullable=False)
    lot = Column(Float, nullable=False, default=0.0)
    avg_cost = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


class TradeOrder(Base):
    """Immutable record of an executed (instant/market) buy or sell - this is
    trade *history*, not a pending-order queue, since orders always fill
    immediately at the live quote per the module's design."""
    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("trade_account.id", ondelete="CASCADE"), nullable=False, index=True)
    instrument_type = Column(String(10), nullable=False)
    symbol = Column(String(30), nullable=False)
    side = Column(String(4), nullable=False)  # "AL" | "SAT"
    lot = Column(Float, nullable=False)
    price = Column(Float, nullable=False)
    commission = Column(Float, nullable=False, default=0.0)
    total = Column(Float, nullable=False)
    # Only populated on SAT (sell) orders - realized P&L at the moment of the
    # sell, using the position's average cost *before* this sale reduced it.
    realized_pnl = Column(Float, nullable=True)
    executed_at = Column(DateTime(timezone=True), server_default=func.now())


class TradePendingOrder(Base):
    """A resting LIMIT, STOP, or STOP_LIMIT order. Unlike TradeOrder (always
    an instant fill at the live quote), this sits at status=PENDING until
    its trigger condition is met. There's no dedicated matching engine or
    cron job - the frontend already polls /trade/account every ~3s for
    positions/P&L, so pending-order fills are checked opportunistically on
    that same poll (see trade_service._check_pending_orders), which is
    precise enough for a paper-trading simulation.

    order_type semantics (see trade_service._check_pending_orders for the
    exact trigger logic):
      - LIMIT: fills at limit_price once the live price reaches it or
        better (AL: price <= limit_price, SAT: price >= limit_price).
      - STOP: fills at the *live* price (like a market order) once the
        live price crosses stop_price in the adverse/breakout direction
        (AL: price >= stop_price, SAT: price <= stop_price) - a stop-loss
        or breakout-entry trigger, not a price guarantee.
      - STOP_LIMIT: waits for the same stop_price trigger as STOP, then
        converts in place into a resting LIMIT order at limit_price
        instead of filling immediately.

    reserved_cash is only meaningful for AL (buy) orders: the notional +
    estimated commission at the order's *worst reasonable execution price*
    (limit_price for LIMIT/STOP_LIMIT, stop_price for a plain STOP, since
    that's the best estimate available before it actually fills at the
    market) is locked out of TradeAccount.cash_balance at placement time
    (via locked_cash) so several pending buys can't collectively overdraw
    the account, then released on fill/cancel. SAT orders reserve nothing -
    a stock SAT is only accepted if the position already covers the lot,
    re-validated again at fill time.
    """
    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("trade_account.id", ondelete="CASCADE"), nullable=False, index=True)
    instrument_type = Column(String(10), nullable=False)  # "stock" | "viop"
    symbol = Column(String(30), nullable=False)
    side = Column(String(4), nullable=False)  # "AL" | "SAT"
    lot = Column(Float, nullable=False)
    order_type = Column(String(12), nullable=False, default="LIMIT")  # LIMIT | STOP | STOP_LIMIT
    # Nullable because a plain STOP order has no limit constraint - it fills
    # at the live market price once triggered.
    limit_price = Column(Float, nullable=True)
    # Only set for STOP/STOP_LIMIT - the trigger price.
    stop_price = Column(Float, nullable=True)
    reserved_cash = Column(Float, nullable=False, default=0.0)
    status = Column(String(10), nullable=False, default="PENDING")  # PENDING | FILLED | CANCELLED
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    filled_at = Column(DateTime(timezone=True), nullable=True)


class TradeDailySnapshot(Base):
    """
    One equity snapshot per account per calendar day, used to compute an
    honest 'Günlük Kar/Zarar' figure and to build the Performans page's
    equity curve over time. Created lazily on the first request of a new day
    with that moment's total portfolio value as the day's opening baseline
    (there's no market-open-time trigger in this app, so this is a practical
    approximation rather than a true 09:30 opening snapshot).
    """
    id = Column(Integer, primary_key=True, index=True)
    account_id = Column(Integer, ForeignKey("trade_account.id", ondelete="CASCADE"), nullable=False)
    snapshot_date = Column(Date, nullable=False)
    equity_value = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("account_id", "snapshot_date", name="uq_trade_snapshot_account_date"),
    )
