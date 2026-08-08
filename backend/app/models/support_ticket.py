from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class SupportTicket(Base):
    """Lightweight support request/ticket - replaces the previous static
    mailto: link in Settings' "Yardım & Destek" card. A user creates one
    with a subject/message; a superuser answers it from the admin panel
    (admin_reply + status), which also emails the user (see support.py)."""
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    subject = Column(String(200), nullable=False)
    message = Column(Text, nullable=False)
    status = Column(String(10), nullable=False, default="open")  # open | closed
    admin_reply = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="support_tickets")
