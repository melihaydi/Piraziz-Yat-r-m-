from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base

class Alert(Base):
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(20), ForeignKey("company.ticker", ondelete="CASCADE"), nullable=True)
    alert_type = Column(String(50), nullable=False)  # price, rsi, macd, kap, news, dividend, macro
    trigger_condition = Column(JSON, nullable=False)  # {"operator": ">", "value": 120.5} or similar
    is_triggered = Column(Boolean, default=False)
    is_active = Column(Boolean, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    triggered_at = Column(DateTime(timezone=True), nullable=True)

    user = relationship("User", backref="alerts")
    company = relationship("Company", backref="alerts")
