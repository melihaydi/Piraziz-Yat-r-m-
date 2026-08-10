from sqlalchemy import Column, Integer, String, Float, Date, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base

class Portfolio(Base):
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    name = Column(String(255), nullable=False)
    # Uninvested cash sitting in the portfolio - deliberately NOT a
    # PortfolioAsset row (that table's ticker column is a real FK into
    # `company`, and cash has no price to look up/fluctuate; see
    # admin.py's managed-portfolio cash endpoint for why get_quote() on an
    # arbitrary ticker like "NAKIT" would silently serve a fake ₺150
    # fallback price instead of failing loudly). Managed by an admin via
    # the Yönetilen Portföyler page for now.
    cash_balance = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="portfolios")
    assets = relationship("PortfolioAsset", backref="portfolio", cascade="all, delete-orphan")

class PortfolioAsset(Base):
    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolio.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(20), ForeignKey("company.ticker", ondelete="CASCADE"), nullable=False)
    shares = Column(Float, nullable=False, default=0.0)
    average_cost = Column(Float, nullable=False, default=0.0)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company", backref="portfolio_assets")


class PortfolioSnapshot(Base):
    """One row per (user, day): the user's total portfolio value across all
    their portfolios, recorded once daily by PortfolioSnapshotService (see
    app/services/portfolio_snapshot.py). This is what powers the equity
    curve on the Portföyüm page - there was no historical value tracking
    before this, so the curve only starts accumulating from whenever this
    table starts getting written to; it cannot be backfilled."""
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    total_value = Column(Float, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="portfolio_snapshots")

    __table_args__ = (
        UniqueConstraint("user_id", "snapshot_date", name="uq_portfolio_snapshot_user_date"),
    )
