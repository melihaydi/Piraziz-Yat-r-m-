from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class Subscription(Base):
    """One row per checkout attempt for a paid tier - NOT a recurring
    iyzico subscription (that's a separate iyzico product requiring
    pricing plans pre-created in their merchant dashboard, out of scope
    for this first pass). Instead: a single iyzico Checkout Form payment
    buys `period_days` of `role`, tracked here via expires_at; a daily
    scheduler (see subscription_service.py) downgrades the user back to
    "free" once expires_at passes, and a "yenile" checkout before then
    just resets expires_at forward again. Deliberately does NOT store the
    buyer's identityNumber/address used at checkout - those are passed
    through to iyzico in the API request only, never persisted here
    (KVKK data minimization - see legal/privacy's "İşlenen Kişisel
    Veriler" list, which doesn't list them either)."""
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    role = Column(String(20), nullable=False)  # the tier being purchased - starter | pro | premium
    amount_try = Column(Float, nullable=False)
    period_days = Column(Integer, nullable=False)
    # pending: checkout form initialized, awaiting the user to pay.
    # paid: iyzico confirmed payment (see CheckoutForm.retrieve in the
    # callback endpoint) - the only status that ever granted `role`.
    # failed: iyzico reported the payment did not succeed.
    status = Column(String(10), nullable=False, default="pending")
    # iyzico's own conversationId - a UUID we generate at initialize time
    # and iyzico echoes back in the callback, used to look up which
    # Subscription row a given callback token belongs to. Not their
    # payment id (that's paymentId, stored separately once confirmed).
    conversation_id = Column(String(64), nullable=False, unique=True, index=True)
    iyzico_payment_id = Column(String(64), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user = relationship("User", backref="subscriptions")
