from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base

class FinancialStatement(Base):
    id = Column(Integer, primary_key=True, index=True)
    ticker = Column(String(20), ForeignKey("company.ticker", ondelete="CASCADE"), nullable=False)
    period = Column(String(20), nullable=False)  # e.g., "2024-12", "2024-09" (YYYY-MM format standard)
    statement_type = Column(String(50), nullable=False)  # "balance_sheet", "income_statement", "cash_flow"
    data = Column(JSON, nullable=False)
    raw_data = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    company = relationship("Company", backref="financial_statements")
