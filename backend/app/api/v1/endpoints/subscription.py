from typing import Optional
from fastapi import APIRouter, Depends, Header, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.models.user import User
from app.schemas.subscription import CheckoutSessionCreate, CheckoutSessionResponse, WebhookPayload

router = APIRouter()

@router.post("/checkout", response_model=CheckoutSessionResponse)
def create_checkout_session(
    checkout_in: CheckoutSessionCreate,
    current_user: User = Depends(deps.get_current_user)
):
    """Simulate creation of a payment checkout session (Stripe / Iyzico)."""
    mock_session_id = f"sess_mock_{current_user.id}_{checkout_in.tier}"
    mock_checkout_url = f"https://checkout.stripe.com/pay/{mock_session_id}"
    
    return CheckoutSessionResponse(
        checkout_url=mock_checkout_url,
        session_id=mock_session_id
    )

@router.post("/webhook", status_code=status.HTTP_200_OK)
def payment_webhook(
    payload: WebhookPayload,
    db: Session = Depends(deps.get_db),
    x_webhook_secret: Optional[str] = Header(default=None),
):
    """Receive async payment success webhooks to upgrade user tier.

    Requires a shared secret (STRIPE_WEBHOOK_SECRET) matching the
    X-Webhook-Secret header. There's no real payment gateway wired up yet
    (checkout is mocked above), so this previously had zero verification -
    anyone could POST {"user_id": <any>, "tier": "institutional", ...} here
    directly and upgrade any account for free. Fails closed: if the secret
    isn't configured, every call is rejected rather than trusted.
    """
    if not settings.STRIPE_WEBHOOK_SECRET or x_webhook_secret != settings.STRIPE_WEBHOOK_SECRET:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or missing webhook secret",
        )

    if payload.event_type != "payment_intent.succeeded":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Unsupported event type"
        )
        
    user = db.query(User).filter(User.id == payload.user_id).first()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )

    # Upgrade role
    user.role = payload.tier
    db.commit()
    return {"status": "success", "message": f"User upgraded to {payload.tier}"}

@router.post("/cancel")
def cancel_subscription(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Cancel subscription, reverting user tier back to free."""
    if current_user.role == "free":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="User is already on the free tier"
        )
        
    current_user.role = "free"
    db.commit()
    return {"status": "success", "message": "Subscription cancelled successfully."}

@router.get("/test-premium")
def test_premium_route(current_user: User = Depends(deps.get_current_premium_user)):
    """Test endpoint that only premium users can access."""
    return {"message": f"Welcome premium user {current_user.email}"}
