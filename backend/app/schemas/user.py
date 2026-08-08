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
    pass
