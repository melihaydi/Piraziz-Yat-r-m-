from fastapi import APIRouter, Depends, Request
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.core.limiter import limiter
from app.models.push_subscription import PushSubscription
from app.models.user import User
from app.schemas.notifications import PushSubscribeRequest, PushUnsubscribeRequest

router = APIRouter()


@router.get("/vapid-public-key")
@limiter.limit("60/minute")
def get_vapid_public_key(request: Request):
    """Public key the frontend passes to PushManager.subscribe() - safe to
    expose, it's the public half of the VAPID key pair (see core/push.py)."""
    return {"public_key": settings.VAPID_PUBLIC_KEY}


@router.post("/subscribe", status_code=201)
@limiter.limit("20/minute")
def subscribe(
    request: Request,
    body: PushSubscribeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Registers (or re-registers) a browser's push subscription. Upserts
    by endpoint - the same browser calling subscribe() again (e.g. after
    toggling notifications off/on) updates the existing row instead of
    erroring on the unique constraint."""
    existing = db.query(PushSubscription).filter(PushSubscription.endpoint == body.endpoint).first()
    if existing:
        existing.user_id = current_user.id
        existing.p256dh = body.keys.p256dh
        existing.auth = body.keys.auth
    else:
        db.add(PushSubscription(
            user_id=current_user.id,
            endpoint=body.endpoint,
            p256dh=body.keys.p256dh,
            auth=body.keys.auth,
        ))
    db.commit()
    return {"detail": "Bildirimler için abone olundu."}


@router.post("/unsubscribe")
@limiter.limit("20/minute")
def unsubscribe(
    request: Request,
    body: PushUnsubscribeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    db.query(PushSubscription).filter(
        PushSubscription.endpoint == body.endpoint,
        PushSubscription.user_id == current_user.id,
    ).delete(synchronize_session=False)
    db.commit()
    return {"detail": "Bildirim aboneliği kaldırıldı."}
