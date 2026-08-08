from typing import Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime


class SupportTicketCreate(BaseModel):
    subject: str
    message: str


class SupportTicketUpdate(BaseModel):
    status: Optional[str] = None
    admin_reply: Optional[str] = None


class SupportTicketResponse(BaseModel):
    id: int
    user_id: int
    subject: str
    message: str
    status: str
    admin_reply: Optional[str] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


class SupportTicketAdminResponse(SupportTicketResponse):
    user_email: str
