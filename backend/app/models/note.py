from sqlalchemy import Column, Integer, String, Text, Boolean, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base

class Note(Base):
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(200), nullable=False)
    content = Column(Text, nullable=False, default="")
    # Free-text, not FK-constrained to company.ticker - a note's subject can
    # also be a fund code (TMV, PBR...) which isn't in the company table.
    ticker = Column(String(20), nullable=True, index=True)
    category = Column(String(20), nullable=False, default="genel")  # hisse, fon, genel
    color = Column(String(20), nullable=False, default="amber")
    is_pinned = Column(Boolean, default=False, nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="notes")
