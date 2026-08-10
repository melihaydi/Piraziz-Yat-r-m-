from typing import List
from fastapi import APIRouter, Depends, Form, HTTPException, Request, status
from fastapi.responses import RedirectResponse
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.core.limiter import limiter
from app.models.subscription import Subscription
from app.models.user import User
from app.schemas.subscription import CheckoutRequest, CheckoutResponse, SubscriptionOut
from app.services import payment_service
from app.services.payment_service import PaymentError

router = APIRouter()


@router.get("/plans")
def list_plans():
    """Placeholder prices, not a researched pricing decision - see
    payment_service.py's module docstring."""
    return {
        "plans": [
            {"role": role, "price_try": price, "period_days": payment_service.PLAN_PERIOD_DAYS}
            for role, price in payment_service.PLAN_PRICES_TRY.items()
        ],
        "configured": payment_service.is_configured(),
    }


@router.post("/checkout", response_model=CheckoutResponse)
@limiter.limit("10/minute")
def checkout(
    request: Request,
    payload: CheckoutRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Starts a real iyzico Checkout Form payment - see payment_service.py
    for why the role upgrade only ever happens from the /callback
    confirmation below, never from this response directly."""
    ip = request.client.host if request.client else None
    try:
        payment_page_url = payment_service.initialize_checkout(
            db, current_user, payload.role,
            {
                "identity_number": payload.identity_number,
                "city": payload.city,
                "address": payload.address,
                "gsm_number": payload.gsm_number,
                "ip": ip,
            },
        )
    except PaymentError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"payment_page_url": payment_page_url}


@router.post("/callback")
@limiter.limit("60/minute")
def payment_callback(request: Request, token: str = Form(...), db: Session = Depends(deps.get_db)):
    """iyzico redirects the buyer's browser here (POST, form-encoded) after
    they complete or cancel payment - see payment_service.confirm_payment
    for why the `token` itself isn't trusted, only the server-to-server
    retrieve() call it triggers. Redirects back into the app either way."""
    try:
        sub = payment_service.confirm_payment(db, token, request=request)
    except PaymentError:
        sub = None
    outcome = "success" if (sub and sub.status == "paid") else "failed"
    return RedirectResponse(
        url=f"{settings.FRONTEND_URL}/settings?payment={outcome}",
        status_code=status.HTTP_302_FOUND,
    )


@router.get("/history", response_model=List[SubscriptionOut])
def payment_history(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    rows = (
        db.query(Subscription)
        .filter(Subscription.user_id == current_user.id)
        .order_by(Subscription.created_at.desc())
        .all()
    )
    return [
        SubscriptionOut(
            id=r.id, role=r.role, amount_try=r.amount_try, period_days=r.period_days,
            status=r.status, expires_at=r.expires_at.isoformat() if r.expires_at else None,
            created_at=r.created_at.isoformat() if r.created_at else "",
        )
        for r in rows
    ]


@router.post("/cancel")
def cancel_subscription(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Immediately reverts to the free tier and marks any still-`paid`
    Subscription rows as canceled, so the daily expiry sweep (see
    subscription_expiry.py) doesn't also try to act on them later. This is
    NOT a refund and doesn't credit back remaining paid days - a one-time
    Checkout Form payment (not an auto-renewing subscription) has nothing
    to "stop charging"; this only exists so a user isn't stuck on a paid
    tier they no longer want to see/use."""
    if current_user.role == "free":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Zaten ücretsiz üyeliktesiniz.")

    current_user.role = "free"
    db.query(Subscription).filter(
        Subscription.user_id == current_user.id, Subscription.status == "paid"
    ).update({"status": "canceled"})
    db.commit()
    return {"status": "success", "message": "Üyelik iptal edildi, ücretsiz plana geçtiniz."}
