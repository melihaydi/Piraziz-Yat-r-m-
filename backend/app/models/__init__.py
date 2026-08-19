# Import all models here so that Alembic can auto-detect them through Base.metadata
from app.db.base_class import Base
from app.models.user import User
from app.models.company import Company
from app.models.financial import FinancialStatement
from app.models.kap import KapNotification
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot
from app.models.portfolio_transaction import PortfolioTransaction
# Trade models were missing from this list for a long time. Since alembic's
# env.py builds target_metadata from `app.models`, autogenerate simply never
# saw these tables - which is why no migration ever created them, and why
# `alembic upgrade head` on an EMPTY database died at the migration that
# ALTERs trade_account ("no such table: trade_account"). Production only
# worked because the tables had been created out-of-band by create_all.
from app.models.trade import (
    TradeAccount, TradePosition, TradeOrder, TradeDailySnapshot, TradePendingOrder,
)
from app.models.watchlist import WatchlistItem
from app.models.alert import Alert
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.models.note import Note
from app.models.news_article import NewsArticle
from app.models.audit_log import AuditLog
from app.models.push_subscription import PushSubscription
from app.models.support_ticket import SupportTicket
from app.models.subscription import Subscription
from app.models.fund_composition_override import FundCompositionOverride

__all__ = [
    "Base",
    "User",
    "Company",
    "FinancialStatement",
    "KapNotification",
    "Portfolio",
    "PortfolioAsset",
    "PortfolioSnapshot",
    "PortfolioTransaction",
    "TradeAccount",
    "TradePosition",
    "TradeOrder",
    "TradeDailySnapshot",
    "TradePendingOrder",
    "WatchlistItem",
    "Alert",
    "FundEstimateSnapshot",
    "Note",
    "NewsArticle",
    "AuditLog"
]
