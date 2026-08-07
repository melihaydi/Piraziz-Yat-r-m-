import logging
from typing import Any, Dict, Optional

from fastapi import Request
from sqlalchemy.orm import Session

from app.models.audit_log import AuditLog

logger = logging.getLogger(__name__)


def log_audit(
    db: Session,
    action: str,
    request: Optional[Request] = None,
    user_id: Optional[int] = None,
    resource_type: Optional[str] = None,
    resource_id: Optional[Any] = None,
    details: Optional[Dict[str, Any]] = None,
) -> None:
    """Records one audit_log row (trade orders, admin role changes, login
    attempts - see call sites). Deliberately never raises: a logging failure
    must never break the real action it's recording. Uses its own commit, so
    it doesn't ride inside (or get rolled back by) the caller's own
    transaction."""
    try:
        ip_address = request.client.host if request and request.client else None
        entry = AuditLog(
            user_id=user_id,
            action=action,
            resource_type=resource_type,
            resource_id=str(resource_id) if resource_id is not None else None,
            details=details,
            ip_address=ip_address,
        )
        db.add(entry)
        db.commit()
    except Exception as e:
        logger.error(f"Audit log write failed for action={action}: {e}")
        try:
            db.rollback()
        except Exception:
            pass
