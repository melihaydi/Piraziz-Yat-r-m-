from sqlalchemy import Column, Integer, String, Text, DateTime, ForeignKey, JSON
from sqlalchemy.sql import func
from app.db.base_class import Base

class AuditLog(Base):
    """Append-only record of security/financial-relevant actions - trade
    orders, admin role changes, login attempts. Scoped to a small, high-value
    set of actions (see app/core/audit.py's call sites) rather than every
    endpoint, so it stays a useful trail instead of noise. user_id is
    nullable and SET NULL on delete since a failed login (wrong email) or a
    later-deleted account must still leave the log row intact."""
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True, index=True)
    action = Column(String(50), nullable=False, index=True)
    resource_type = Column(String(50), nullable=True)
    resource_id = Column(String(50), nullable=True)
    details = Column(JSON, nullable=True)
    ip_address = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), index=True)
