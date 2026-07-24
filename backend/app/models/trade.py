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
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="trade_account", uselist=False)
    positions = relationship("TradePosition", backref="account", cascade="all, delete-orphan")
    orders = relationship("TradeOrder", backref="account", cascade="all, delete-orphan")
    snapshots = relationship("TradeDailySnapshot", backref="account", cascade="all, delete-orphan")


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
