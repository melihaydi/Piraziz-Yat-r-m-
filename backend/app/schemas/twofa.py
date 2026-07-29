from typing import Optional
from pydantic import BaseModel


class TwoFactorSetupResponse(BaseModel):
    secret: str
    qr_code_base64: str  # data URI - <img src="{qr_code_base64}"> renders it directly


class TwoFactorCodeRequest(BaseModel):
    code: str


class TwoFactorLoginRequest(BaseModel):
    temp_token: str
    code: str


class LoginResponse(BaseModel):
    """Returned by POST /auth/login. A totp_enabled account gets back
    requires_2fa=True + a short-lived temp_token instead of a real
    access_token - the frontend must then call POST /auth/login/2fa with
    that temp_token plus the user's current authenticator code to get the
    real access_token."""
    access_token: Optional[str] = None
    token_type: Optional[str] = None
    requires_2fa: bool = False
    temp_token: Optional[str] = None
