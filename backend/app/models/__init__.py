# Import all models here so that Alembic can auto-detect them through Base.metadata
from app.db.base_class import Base
from app.models.user import User
from app.models.company import Company
from app.models.financial import FinancialStatement
from app.models.kap import KapNotification
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot
from app.models.alert import Alert
from app.models.fund_estimate_snapshot import FundEstimateSnapshot
from app.models.note import Note

__all__ = [
    "Base",
    "User",
    "Company",
    "FinancialStatement",
    "KapNotification",
    "Portfolio",
    "PortfolioAsset",
    "PortfolioSnapshot",
    "Alert",
    "FundEstimateSnapshot",
    "Note"
]
