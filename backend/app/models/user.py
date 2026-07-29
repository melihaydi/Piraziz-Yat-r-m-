from sqlalchemy import Column, Integer, String, Boolean, DateTime
from sqlalchemy.sql import func
from app.db.base_class import Base

class User(Base):
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    role = Column(String(50), default="free")  # free, starter, pro, premium, institutional
    # totp_secret is written by POST /auth/2fa/setup as soon as a QR is
    # generated, but totp_enabled only flips to True once the user proves
    # possession by submitting one real code to POST /auth/2fa/verify - so a
    # secret can exist without 2FA actually being active yet (someone who
    # scanned the QR but never entered a code).
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
