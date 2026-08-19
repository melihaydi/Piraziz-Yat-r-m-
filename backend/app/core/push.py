import json
import logging

from pywebpush import webpush, WebPushException
from sqlalchemy.orm import Session

from app.core.config import settings
from app.models.push_subscription import PushSubscription

logger = logging.getLogger(__name__)


def send_push_to_subscriptions(
    subscriptions: list, title: str, body: str, url: str = "/"
) -> list:
    """Session'sız push gönderimi: abonelikleri düz sözlük olarak alır
    ({"id", "endpoint", "p256dh", "auth"}) ve ölü bulduklarının id
    listesini döner.

    Ayrı bir fonksiyon olarak var çünkü alarm bildirimleri bir thread
    havuzunda gönderiliyor (websocket akışını bloklamamak için) ve
    SQLAlchemy oturumları thread'ler arasında taşınamaz - worker'a ORM
    nesnesi değil düz veri veriliyor. send_push() aşağıda bunun DB'li
    sarmalayıcısı.
    """
    if not subscriptions:
        return []

    payload = {"title": title, "body": body, "url": url}
    dead_ids = []

    for sub in subscriptions:
        try:
            webpush(
                subscription_info={
                    "endpoint": sub["endpoint"],
                    "keys": {"p256dh": sub["p256dh"], "auth": sub["auth"]},
                },
                data=json.dumps(payload),
                vapid_private_key=settings.VAPID_PRIVATE_KEY,
                vapid_claims={"sub": settings.VAPID_CLAIM_EMAIL},
            )
        except WebPushException as e:
            status_code = e.response.status_code if e.response is not None else None
            if status_code in (404, 410):
                dead_ids.append(sub["id"])
            else:
                logger.warning(f"Web Push failed for subscription {sub['id']}: {e}")
        except Exception as e:
            logger.error(f"Unexpected Web Push error for subscription {sub['id']}: {e}")

    return dead_ids


def send_push(db: Session, user_id: int, title: str, body: str, url: str = "/") -> None:
    """Best-effort Web Push to every browser/device the user has subscribed
    on, same pattern as core/notify.py's send_telegram_alert and
    core/email.py's send_email: never raises, so a broken push send can't
    break whatever triggered it (see alert.py's /check). A subscription the
    push service reports as gone (410 Gone / 404, e.g. the user cleared
    site data or uninstalled) is deleted here instead of being retried
    forever."""
    rows = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    dead_ids = send_push_to_subscriptions(
        [{"id": r.id, "endpoint": r.endpoint, "p256dh": r.p256dh, "auth": r.auth} for r in rows],
        title, body, url,
    )

    if dead_ids:
        db.query(PushSubscription).filter(PushSubscription.id.in_(dead_ids)).delete(synchronize_session=False)
        db.commit()
