from typing import Optional
from pydantic import BaseModel, EmailStr, ConfigDict
from datetime import datetime

class UserBase(BaseModel):
    email: EmailStr
    full_name: Optional[str] = None
    is_active: Optional[bool] = True
    role: Optional[str] = "free"

class UserCreate(UserBase):
    password: str
    # Must be True - enforced in the /register endpoint, not just here,
    # since a bare Pydantic default wouldn't reject a request that omits
    # the field entirely (only one that sends terms_accepted: false).
    terms_accepted: bool = False

class UserUpdate(UserBase):
    password: Optional[str] = None

class UserInDBBase(UserBase):
    id: int
    is_superuser: bool
    totp_enabled: bool = False
    is_email_verified: bool = False
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class UserOut(UserInDBBase):
    # Server-wide (not per-user): whether SMTP credentials are actually
    # configured. Without it the UI can't tell a user who hasn't verified
    # their address that verification is impossible right now - it would
    # keep offering a "resend" button whose mail silently no-ops (see
    # core.email.send_email), which is exactly what made that banner look
    # permanently stuck. Not a leak: it says nothing about any account.
    email_delivery_enabled: bool = False
