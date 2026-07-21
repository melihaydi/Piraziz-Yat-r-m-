from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, JSON
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base

class KapNotification(Base):
    id = Column(String(50), primary_key=True)  # KAP notification ID
    ticker = Column(String(20), ForeignKey("company.ticker", ondelete="SET NULL"), nullable=True)
    title = Column(String(500), nullable=False)
    summary = Column(String, nullable=True)
    content = Column(String, nullable=True)
    category = Column(String(100), nullable=True)
    publish_date = Column(DateTime(timezone=True), nullable=False)
    sentiment = Column(String(20), nullable=True)  # positive, neutral, negative
    impact_score = Column(Integer, nullable=True)  # 0 to 100
    importance = Column(String(20), default="medium")  # low, medium, high
    ai_analysis = Column(JSON, nullable=True)  # Detailed AI analysis results
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    company = relationship("Company", backref="kap_notifications")
