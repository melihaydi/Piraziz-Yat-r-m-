from typing import List
from fastapi import APIRouter, Depends, status
from sqlalchemy.orm import Session

from app.api import deps
from app.core.email import send_email
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support import SupportTicketCreate, SupportTicketResponse

router = APIRouter()

# Where a new ticket gets emailed - reuses the same address already shown
# as the "E-posta Desteği" mailto: link this replaces.
_SUPPORT_INBOX = "melihaydi@gmail.com"


@router.get("/tickets", response_model=List[SupportTicketResponse])
def list_my_tickets(
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


@router.post("/tickets", response_model=SupportTicketResponse, status_code=status.HTTP_201_CREATED)
def create_ticket(
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

    send_email(
        _SUPPORT_INBOX,
        f"Yeni Destek Talebi: {body.subject}",
        f"<p><strong>{current_user.email}</strong> yeni bir destek talebi oluşturdu.</p>"
        f"<p><strong>Konu:</strong> {body.subject}</p><p>{body.message}</p>",
    )
    return ticket
