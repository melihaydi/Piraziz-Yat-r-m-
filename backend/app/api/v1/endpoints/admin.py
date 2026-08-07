from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.audit import log_audit
from app.models.audit_log import AuditLog
from app.models.user import User
from app.schemas.user import UserOut

router = APIRouter()

VALID_ROLES = {"free", "starter", "pro", "premium", "institutional"}


@router.get("/users", response_model=List[UserOut])
def list_users(
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """All registered users, newest first - superuser only."""
    return db.query(User).order_by(User.created_at.desc()).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: int,
    role: str,
    request: Request,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Sets a user's subscription tier - superuser only. This is the manual
    equivalent of what a real payment webhook would do (see subscription.py)
    - there's no real Stripe integration behind this app yet, so tier
    changes happen here until there is one."""
    if role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Geçersiz rol. Geçerli roller: {', '.join(sorted(VALID_ROLES))}",
        )
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")

    old_role = target.role
    target.role = role
    db.commit()
    db.refresh(target)
    log_audit(db, "role_change", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"old_role": old_role, "new_role": role, "target_email": target.email})
    return target


@router.put("/users/{user_id}/active", response_model=UserOut)
def set_user_active(
    user_id: int,
    is_active: bool,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Activates/deactivates an account (deactivated accounts can't log in -
    see get_current_user) - superuser only."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if target.id == admin.id and not is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kendi hesabınızı devre dışı bırakamazsınız.")

    target.is_active = is_active
    db.commit()
    db.refresh(target)
    return target


@router.get("/audit-log")
def get_audit_log(
    limit: int = 100,
    action: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Recent audit trail (trade orders, role changes, login attempts),
    newest first - superuser only. Optionally filtered to one action type."""
    query = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.filter(AuditLog.action == action)
    rows = query.limit(min(limit, 500)).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "details": r.details,
            "ip_address": r.ip_address,
            "created_at": r.created_at,
        }
        for r in rows
    ]
