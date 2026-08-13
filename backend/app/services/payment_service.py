"""
Paid-tier checkout via iyzico's hosted Checkout Form product.

Deliberately NOT iyzico's separate recurring-Subscription API - that
product requires pricing plans to be created first in iyzico's own
merchant dashboard (not something reachable purely through this codebase),
so it's a real prerequisite this integration can't satisfy on its own.
Instead: a Checkout Form payment buys PLAN_PERIOD_DAYS of a role, tracked
via Subscription.expires_at; renewing before expiry is just another
checkout. See subscription_expiry.py for the daily downgrade job.

Trust model: iyzico redirects the buyer's browser back to callbackUrl with
a `token` after payment - that token by itself proves nothing (a browser
redirect is fully client-controlled). The one thing that actually proves
the payment happened is confirm_payment() below calling iyzico's own
CheckoutForm.retrieve() *from our server*, authenticated with our own
secret key - iyzico's response to THAT call is the real authority. This is
the standard, safe pattern for this product (no separate webhook signature
to hand-verify, unlike a lot of other providers).

PLAN_PRICES_TRY below are placeholder numbers, not a researched pricing
decision - change them before taking real payments.
"""
import json
import logging
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, Optional

import iyzipay
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.audit import log_audit
from app.models.subscription import Subscription
from app.models.user import User

logger = logging.getLogger(__name__)

PLAN_PRICES_TRY: Dict[str, float] = {
    "starter": 99.0,
    "pro": 199.0,
    "premium": 399.0,
}
PLAN_PERIOD_DAYS = 30


class PaymentError(Exception):
    pass


def is_configured() -> bool:
    return bool(settings.IYZICO_API_KEY and settings.IYZICO_SECRET_KEY)


def _options() -> Dict[str, str]:
    return {
        "api_key": settings.IYZICO_API_KEY,
        "secret_key": settings.IYZICO_SECRET_KEY,
        "base_url": settings.IYZICO_BASE_URL,
    }


def _read_response(raw) -> Dict[str, Any]:
    return json.loads(raw.read().decode("utf-8"))


def initialize_checkout(db: Session, user: User, role: str, buyer: Dict[str, str]) -> str:
    """Starts a checkout for one PLAN_PERIOD_DAYS period of `role`. Returns
    the iyzico-hosted payment page URL to redirect the buyer's browser to.

    `buyer` must supply identity_number (T.C. Kimlik No) and city/address -
    iyzico requires these for every real-money Checkout Form request
    (fraud/KYC). Never persisted (see Subscription's docstring) - passed
    through to iyzico in this one request only."""
    if not is_configured():
        raise PaymentError("Ödeme sistemi henüz yapılandırılmamış. Lütfen daha sonra tekrar deneyin.")
    if role not in PLAN_PRICES_TRY:
        raise PaymentError("Geçersiz üyelik planı.")
    identity_number = (buyer.get("identity_number") or "").strip()
    if not identity_number or not identity_number.isdigit() or len(identity_number) != 11:
        raise PaymentError("Geçerli bir T.C. Kimlik Numarası girin.")

    price = PLAN_PRICES_TRY[role]
    conversation_id = uuid.uuid4().hex

    sub = Subscription(
        user_id=user.id, role=role, amount_try=price, period_days=PLAN_PERIOD_DAYS,
        status="pending", conversation_id=conversation_id,
    )
    db.add(sub)
    db.commit()
    db.refresh(sub)

    display_name = (user.full_name or "Kullanıcı").strip() or "Kullanıcı"
    name_parts = display_name.split(" ", 1)
    first_name, last_name = name_parts[0], (name_parts[1] if len(name_parts) > 1 else name_parts[0])
    city = buyer.get("city") or "Istanbul"
    address = buyer.get("address") or "Türkiye"
    gsm = buyer.get("gsm_number") or "+905000000000"
    ip = buyer.get("ip") or "85.34.78.112"

    price_str = f"{price:.2f}"
    request = {
        "locale": "tr",
        "conversationId": conversation_id,
        "price": price_str,
        "paidPrice": price_str,
        "currency": "TRY",
        "basketId": f"sub-{sub.id}",
        "paymentGroup": "PRODUCT",
        "callbackUrl": f"{settings.BACKEND_PUBLIC_URL}/api/v1/payment/callback",
        "enabledInstallments": [1],
        "buyer": {
            "id": str(user.id),
            "name": first_name,
            "surname": last_name,
            "gsmNumber": gsm,
            "email": user.email,
            "identityNumber": identity_number,
            "registrationAddress": address,
            "ip": ip,
            "city": city,
            "country": "Turkey",
        },
        "shippingAddress": {
            "contactName": display_name,
            "city": city,
            "country": "Turkey",
            "address": address,
        },
        "billingAddress": {
            "contactName": display_name,
            "city": city,
            "country": "Turkey",
            "address": address,
        },
        "basketItems": [{
            "id": role,
            "name": f"BIP Terminal - {role.capitalize()} Uyelik ({PLAN_PERIOD_DAYS} gun)",
            "category1": "Uyelik",
            "itemType": "VIRTUAL",
            "price": price_str,
        }],
    }

    response = _read_response(iyzipay.CheckoutFormInitialize().create(request, _options()))
    if response.get("status") != "success":
        sub.status = "failed"
        db.commit()
        logger.error(f"iyzico checkout initialize failed for user {user.id}: {response}")
        raise PaymentError(response.get("errorMessage") or "Ödeme başlatılamadı.")

    payment_page_url = response.get("paymentPageUrl")
    if not payment_page_url:
        sub.status = "failed"
        db.commit()
        raise PaymentError("Ödeme sayfası oluşturulamadı.")
    return payment_page_url


def confirm_payment(db: Session, token: str, request=None) -> Optional[Subscription]:
    """Called from the /payment/callback endpoint once iyzico redirects the
    buyer back with `token`. Confirms the payment SERVER-SIDE against
    iyzico's own API (see module docstring for why this - not the redirect
    itself - is the trust boundary), then grants the role and extends
    expires_at. Idempotent: retrieving the same already-`paid` Subscription
    again does not grant a second period (a user refreshing the callback
    page, or iyzico retrying, can't double-extend)."""
    if not is_configured():
        raise PaymentError("Ödeme sistemi yapılandırılmamış.")

    response = _read_response(iyzipay.CheckoutForm().retrieve({"token": token}, _options()))
    conversation_id = response.get("conversationId")
    sub = (
        db.query(Subscription)
        .filter(Subscription.conversation_id == conversation_id)
        .first()
        if conversation_id else None
    )
    if not sub:
        logger.error(f"iyzico callback: no Subscription found for conversationId={conversation_id!r}")
        return None

    if sub.status == "paid":
        return sub  # already processed - don't grant a second period

    if response.get("status") != "success" or response.get("paymentStatus") != "SUCCESS":
        sub.status = "failed"
        db.commit()
        logger.warning(f"iyzico payment not successful for subscription {sub.id}: {response}")
        return sub

    # Timezone-aware, not datetime.utcnow() - Subscription.expires_at is a
    # DateTime(timezone=True) column, and subscription_expiry.py's daily
    # sweep compares it against a TR-aware now() too (see that module) -
    # comparing a naive datetime against a tz-aware one read back from
    # Postgres raises TypeError, even though SQLite silently lets it slide.
    now = datetime.now(timezone.utc)
    base = sub.expires_at if (sub.expires_at and sub.expires_at > now) else now
    sub.status = "paid"
    sub.iyzico_payment_id = response.get("paymentId")
    sub.expires_at = base + timedelta(days=sub.period_days)
    db.commit()
    db.refresh(sub)

    user = db.query(User).filter(User.id == sub.user_id).first()
    if user:
        old_role = user.role
        user.role = sub.role
        db.commit()
        log_audit(
            db, "subscription_paid", request=request, user_id=user.id,
            resource_type="subscription", resource_id=sub.id,
            details={"old_role": old_role, "new_role": sub.role, "amount_try": sub.amount_try,
                     "expires_at": sub.expires_at.isoformat()},
        )
    return sub
