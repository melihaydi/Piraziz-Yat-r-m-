from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
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

    target.role = role
    db.commit()
    db.refresh(target)
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
