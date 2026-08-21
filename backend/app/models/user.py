from sqlalchemy import Column, Integer, String, Boolean, DateTime, JSON
from sqlalchemy.sql import func
from app.db.base_class import Base

class User(Base):
    id = Column(Integer, primary_key=True, index=True)
    email = Column(String(255), unique=True, index=True, nullable=False)
    hashed_password = Column(String(255), nullable=False)
    full_name = Column(String(255), nullable=True)
    is_active = Column(Boolean, default=True)
    is_superuser = Column(Boolean, default=False)
    role = Column(String(50), default="free")  # free, premium
    is_email_verified = Column(Boolean, default=False)
    terms_accepted_at = Column(DateTime(timezone=True), nullable=True)
    # totp_secret is written by POST /auth/2fa/setup as soon as a QR is
    # generated, but totp_enabled only flips to True once the user proves
    # possession by submitting one real code to POST /auth/2fa/verify - so a
    # secret can exist without 2FA actually being active yet (someone who
    # scanned the QR but never entered a code).
    totp_secret = Column(String(64), nullable=True)
    totp_enabled = Column(Boolean, default=False)
    # Single-use 2FA recovery codes, stored bcrypt-hashed (they're
    # credentials - a DB leak must not hand out working second factors).
    # Generated when 2FA is switched on and shown to the user exactly once;
    # each one is removed from this list the moment it's redeemed. Without
    # these, losing the authenticator device meant being permanently locked
    # out: password reset doesn't clear totp_enabled, so the second factor
    # would still be demanded with no way to satisfy it.
    totp_recovery_codes = Column(JSON, nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())


# Soft-delete anonymizes the address rather than dropping the row (see
# admin_delete_user / delete_my_account). The domain lives here, in one
# place, because three call sites have to agree on it: both delete paths
# write it and the admin listing filters on it. They previously did NOT
# agree - the admin path wrote "@bipterminal.local" while the self-service
# path wrote "@piraziz.local", so any filter keyed to one silently missed
# the other. .local stays deliberately unroutable; note that it's an IANA
# special-use TLD, so no EmailStr-typed field may ever carry these values
# (that's why UserInDBBase.email is a plain str).
DELETED_EMAIL_DOMAIN = "bipterminal.local"

# Written by the self-service delete path before the two were unified.
# Rows created back then still exist, so the filter has to recognize them.
LEGACY_DELETED_EMAIL_DOMAINS = ("piraziz.local",)


def anonymized_email(user_id: int) -> str:
    """The placeholder address a soft-deleted account is renamed to."""
    return f"deleted-user-{user_id}@{DELETED_EMAIL_DOMAIN}"


def is_anonymized_email(email: str) -> bool:
    """True for an address written by either delete path, current or legacy."""
    return email.endswith(
        tuple(f"@{d}" for d in (DELETED_EMAIL_DOMAIN, *LEGACY_DELETED_EMAIL_DOMAINS))
    )
