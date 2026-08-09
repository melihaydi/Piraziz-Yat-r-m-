from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.audit import log_audit
from app.core.limiter import limiter
from app.core.email import send_email
from app.models.audit_log import AuditLog
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support import SupportTicketAdminResponse, SupportTicketUpdate
from app.schemas.user import UserOut

router = APIRouter()

VALID_ROLES = {"free", "starter", "pro", "premium", "institutional"}


@router.get("/users", response_model=List[UserOut])
@limiter.limit("60/minute")
def list_users(
    request: Request,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """All registered users, newest first - superuser only."""
    return db.query(User).order_by(User.created_at.desc()).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
@limiter.limit("30/minute")
def update_user_role(
    request: Request,
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

    old_role = target.role
    target.role = role
    db.commit()
    db.refresh(target)
    log_audit(db, "role_change", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"old_role": old_role, "new_role": role, "target_email": target.email})
    return target


@router.put("/users/{user_id}/active", response_model=UserOut)
@limiter.limit("30/minute")
def set_user_active(
    request: Request,
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


@router.post("/users/{user_id}/reset-2fa", response_model=UserOut)
@limiter.limit("10/minute")
def reset_user_2fa(
    request: Request,
    user_id: int,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Last-resort account recovery: switches 2FA off for a user who has
    lost both their authenticator device and their recovery codes -
    superuser only, and audit-logged, because this deliberately strips a
    security control off someone else's account. The user can (and should)
    re-enable 2FA from Settings afterwards. Verify the requester's identity
    out-of-band before using this."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if not target.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bu hesapta 2FA zaten kapalı.")

    target.totp_enabled = False
    target.totp_secret = None
    target.totp_recovery_codes = None
    db.commit()
    db.refresh(target)
    log_audit(db, "admin_2fa_reset", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"target_email": target.email})
    return target


@router.get("/audit-log")
@limiter.limit("60/minute")
def get_audit_log(
    request: Request,
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


@router.get("/support/tickets", response_model=List[SupportTicketAdminResponse])
@limiter.limit("60/minute")
def list_support_tickets(
    request: Request,
    status_filter: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """All support tickets across all users, newest first - superuser only.
    Optionally filtered to status=open|closed."""
    query = db.query(SupportTicket).order_by(SupportTicket.created_at.desc())
    if status_filter:
        query = query.filter(SupportTicket.status == status_filter)
    tickets = query.all()
    return [
        SupportTicketAdminResponse(
            id=t.id, user_id=t.user_id, subject=t.subject, message=t.message,
            status=t.status, admin_reply=t.admin_reply, created_at=t.created_at,
            updated_at=t.updated_at, user_email=t.user.email,
        )
        for t in tickets
    ]


@router.put("/support/tickets/{ticket_id}", response_model=SupportTicketAdminResponse)
@limiter.limit("30/minute")
def update_support_ticket(
    request: Request,
    ticket_id: int,
    body: SupportTicketUpdate,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Answers/closes a ticket - superuser only. Emails the ticket's owner
    when a reply is added, same as a real support inbox."""
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Destek talebi bulunamadı.")

    reply_added = body.admin_reply is not None and body.admin_reply != ticket.admin_reply
    if body.admin_reply is not None:
        ticket.admin_reply = body.admin_reply
    if body.status is not None:
        if body.status not in ("open", "closed"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz durum.")
        ticket.status = body.status
    db.commit()
    db.refresh(ticket)

    if reply_added:
        send_email(
            ticket.user.email,
            f"Destek Talebinize Yanıt Verildi: {ticket.subject}",
            f"<p><strong>Konu:</strong> {ticket.subject}</p><p>{ticket.admin_reply}</p>",
        )

    return SupportTicketAdminResponse(
        id=ticket.id, user_id=ticket.user_id, subject=ticket.subject, message=ticket.message,
        status=ticket.status, admin_reply=ticket.admin_reply, created_at=ticket.created_at,
        updated_at=ticket.updated_at, user_email=ticket.user.email,
    )
