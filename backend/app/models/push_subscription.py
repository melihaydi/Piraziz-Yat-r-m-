from sqlalchemy import Column, Integer, String, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base_class import Base


class PushSubscription(Base):
    """One row per browser/device the user has enabled Web Push
    notifications on (see Settings' 'Bildirimlere İzin Ver' toggle) -
    a user can have several (phone + desktop browser, etc.). `endpoint` is
    the push service URL the browser's PushManager.subscribe() returned;
    unique per subscription, used to dedupe re-subscribes and as the
    delete key when a subscription expires (see core/push.py's cleanup on
    a 404/410 from the push service)."""
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    endpoint = Column(String(500), nullable=False, unique=True, index=True)
    p256dh = Column(String(255), nullable=False)
    auth = Column(String(255), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
