import html
from typing import List
from fastapi import APIRouter, Depends, Request, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.email import send_email
from app.core.limiter import limiter
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support import SupportTicketCreate, SupportTicketResponse

router = APIRouter()

# Where a new ticket gets emailed - reuses the same address already shown
# as the "E-posta Desteği" mailto: link this replaces.
_SUPPORT_INBOX = "melihaydi@gmail.com"


@router.get("/tickets", response_model=List[SupportTicketResponse])
@limiter.limit("60/minute")
def list_my_tickets(
    request: Request,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """The current user's own support tickets, newest first."""
    return (
        db.query(SupportTicket)
        .filter(SupportTicket.user_id == current_user.id)
        .order_by(SupportTicket.created_at.desc())
        .all()
    )


# Tight on purpose: every ticket fires an email to the support inbox, so an
# unlimited endpoint is a direct way to flood that mailbox (and get the
# sending account flagged for spam). 5/min is far above what a real person
# filing a support request needs.
@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def create_ticket(
    request: Request,
    body: SupportTicketCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    ticket = SupportTicket(
        user_id=current_user.id,
        subject=body.subject,
        message=body.message,
        status="open",
    )
    db.add(ticket)
    db.commit()
    db.refresh(ticket)

    # Escaped before going into the HTML email body - subject/message are
    # free-text from the ticket submitter, so an unescaped "<img src=...>"
    # or link would render live in whatever mail client opens this.
    safe_subject = html.escape(body.subject)
    send_email(
        _SUPPORT_INBOX,
        f"Yeni Destek Talebi: {safe_subject}",
        f"<p><strong>{html.escape(current_user.email)}</strong> yeni bir destek talebi oluşturdu.</p>"
        f"<p><strong>Konu:</strong> {safe_subject}</p><p>{html.escape(body.message)}</p>",
    )
    return ticket
