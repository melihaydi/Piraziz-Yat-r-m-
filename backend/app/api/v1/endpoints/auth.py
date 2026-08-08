import base64
import io
from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from jose import jwt, JWTError
from sqlalchemy.orm import Session

from app.core import security
from app.core.audit import log_audit
from app.core.config import settings
from app.core.email import send_email
from app.core.limiter import limiter
from app.api import deps
from app.models.user import User
from app.schemas.user import UserOut, UserCreate, UserUpdate
from app.schemas.token import Token
from app.schemas.auth import (
    ForgotPasswordRequest,
    ResetPasswordRequest,
    ResendVerificationRequest,
    VerifyEmailRequest,
)
from app.schemas.twofa import (
    TwoFactorSetupResponse,
    TwoFactorCodeRequest,
    TwoFactorLoginRequest,
    LoginResponse,
)

router = APIRouter()

# How long a "password was correct, now enter your code" temp token stays
# valid - short on purpose, this token proves nothing except "the password
# check passed a few minutes ago" (see security.create_access_token's
# scope="2fa_pending" docstring).
TWO_FA_PENDING_TOKEN_MINUTES = 5

# Same short-lived special-purpose-token pattern (scope check enforced in
# app/api/deps.py's get_current_user, which rejects anything whose scope
# isn't None/"access") reused for password reset and email verification.
PASSWORD_RESET_TOKEN_MINUTES = 15
EMAIL_VERIFY_TOKEN_HOURS = 24


def _send_verification_email(user: User) -> None:
    token = security.create_access_token(
        user.id, expires_delta=timedelta(hours=EMAIL_VERIFY_TOKEN_HOURS), scope="email_verify"
    )
    link = f"{settings.FRONTEND_URL}/verify-email?token={token}"
    send_email(
        user.email,
        "E-posta adresini doğrula - Piraziz Yatırım",
        f"""
        <p>Merhaba{f' {user.full_name}' if user.full_name else ''},</p>
        <p>Piraziz Yatırım hesabını kullanmaya başlamak için e-posta adresini doğrula:</p>
        <p><a href="{link}">E-postamı Doğrula</a></p>
        <p>Bu bağlantı {EMAIL_VERIFY_TOKEN_HOURS} saat geçerlidir. Bu isteği sen yapmadıysan bu e-postayı görmezden gelebilirsin.</p>
        """,
    )

# 5 attempts/minute per IP - generous enough for a real user who mistypes a
# password, tight enough to make credential-stuffing/brute-force impractical.
# Previously there was no limit at all on either endpoint.
@router.post("/register", response_model=UserOut, status_code=status.HTTP_201_CREATED)
@limiter.limit("5/minute")
def register_user(request: Request, user_in: UserCreate, db: Session = Depends(deps.get_db)):
    """Register a new user."""
    # Check if user already exists
    user = db.query(User).filter(User.email == user_in.email).first()
    if user:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The user with this email already exists in the system.",
        )
    
    # Hash password and create user. `role`/`is_active` are deliberately NOT
    # taken from user_in here even though UserCreate has those fields (they
    # exist for admin update flows) - self-registration must never be able
    # to grant itself a paid tier or pre-activate an account by just sending
    # {"role": "institutional"} in the request body.
    hashed_password = security.get_password_hash(user_in.password)
    db_user = User(
        email=user_in.email,
        hashed_password=hashed_password,
        full_name=user_in.full_name,
        role="free",
        is_active=True,
        is_superuser=False
    )
    db.add(db_user)
    db.commit()
    db.refresh(db_user)
    _send_verification_email(db_user)
    return db_user

@router.post("/login", response_model=LoginResponse)
@limiter.limit("5/minute")
def login_access_token(
    request: Request, db: Session = Depends(deps.get_db), form_data: OAuth2PasswordRequestForm = Depends()
):
    """OAuth2 compatible token login, get an access token for future requests.

    If the account has 2FA enabled, a correct password does not return a
    real access_token yet - it returns requires_2fa=True and a short-lived
    temp_token. The frontend must then call POST /auth/login/2fa with that
    temp_token plus the current authenticator code to get the real token."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        log_audit(db, "login_failed", request=request, user_id=user.id if user else None,
                   details={"email": form_data.username})
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    elif not user.is_active:
        log_audit(db, "login_failed", request=request, user_id=user.id, details={"reason": "inactive"})
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )

    if user.totp_enabled:
        temp_token = security.create_access_token(
            user.id,
            expires_delta=timedelta(minutes=TWO_FA_PENDING_TOKEN_MINUTES),
            scope="2fa_pending",
        )
        return {"requires_2fa": True, "temp_token": temp_token}

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    log_audit(db, "login_success", request=request, user_id=user.id)
    return {
        "access_token": security.create_access_token(user.id, expires_delta=access_token_expires),
        "token_type": "bearer",
    }


@router.post("/login/2fa", response_model=Token)
@limiter.limit("5/minute")
def login_verify_2fa(request: Request, body: TwoFactorLoginRequest, db: Session = Depends(deps.get_db)):
    """Second step of a 2FA login: exchanges a temp_token (from POST
    /auth/login) plus the current 6-digit authenticator code for a real
    access token."""
    import pyotp

    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED, detail="Geçersiz veya süresi dolmuş oturum, lütfen tekrar giriş yapın."
    )
    try:
        payload = jwt.decode(body.temp_token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise credentials_exception
    if payload.get("scope") != "2fa_pending" or not payload.get("sub"):
        raise credentials_exception

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user or not user.totp_enabled or not user.totp_secret:
        raise credentials_exception

    if not pyotp.TOTP(user.totp_secret).verify(body.code, valid_window=1):
        log_audit(db, "login_failed", request=request, user_id=user.id, details={"reason": "bad_2fa_code"})
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    log_audit(db, "login_success", request=request, user_id=user.id, details={"via": "2fa"})
    return {
        "access_token": security.create_access_token(user.id, expires_delta=access_token_expires),
        "token_type": "bearer",
    }

@router.get("/me", response_model=UserOut)
def read_user_me(current_user: User = Depends(deps.get_current_user)):
    """Get current user details."""
    return current_user

@router.put("/me", response_model=UserOut)
def update_user_me(
    user_in: UserUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Update the current user's own email/full_name/password. Like
    register, deliberately ignores role/is_active from the payload - this
    can only ever update the caller's own profile fields, never tier or
    account status."""
    if user_in.email and user_in.email != current_user.email:
        existing = db.query(User).filter(User.email == user_in.email).first()
        if existing:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bu e-posta adresi başka bir hesap tarafından kullanılıyor.",
            )
        current_user.email = user_in.email

    if user_in.full_name is not None:
        current_user.full_name = user_in.full_name

    if user_in.password:
        current_user.hashed_password = security.get_password_hash(user_in.password)

    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
def setup_2fa(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Generates a new TOTP secret and QR code. This does NOT enable 2FA by
    itself - the secret is stored right away (so /2fa/verify can check
    against it) but totp_enabled stays False until the user proves they
    actually scanned the QR by submitting one real code to /2fa/verify.
    Calling this again before verifying replaces the pending secret (e.g.
    the user re-scans after losing the first QR)."""
    import pyotp
    import qrcode

    if current_user.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA zaten aktif.")

    secret = pyotp.random_base32()
    current_user.totp_secret = secret
    db.commit()

    uri = pyotp.TOTP(secret).provisioning_uri(name=current_user.email, issuer_name="Piraziz Yatırım")
    img = qrcode.make(uri)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    qr_base64 = base64.b64encode(buf.getvalue()).decode("utf-8")

    return {"secret": secret, "qr_code_base64": f"data:image/png;base64,{qr_base64}"}


@router.post("/2fa/verify", response_model=UserOut)
def verify_2fa(
    body: TwoFactorCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Confirms possession of the authenticator by checking one real code
    against the pending secret from /2fa/setup, then flips totp_enabled on."""
    import pyotp

    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Önce /2fa/setup ile bir QR kod oluşturulmalı.")
    if not pyotp.TOTP(current_user.totp_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")

    current_user.totp_enabled = True
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/2fa/disable", response_model=UserOut)
def disable_2fa(
    body: TwoFactorCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Requires a current authenticator code (not just an active session)
    to disable 2FA - a stolen session token alone shouldn't be enough to
    turn off the account's second factor."""
    import pyotp

    if not current_user.totp_enabled or not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA zaten kapalı.")
    if not pyotp.TOTP(current_user.totp_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")

    current_user.totp_enabled = False
    current_user.totp_secret = None
    db.commit()
    db.refresh(current_user)
    return current_user


@router.post("/forgot-password")
@limiter.limit("5/minute")
def forgot_password(request: Request, body: ForgotPasswordRequest, db: Session = Depends(deps.get_db)):
    """Always returns the same 200 response whether or not the email
    belongs to a real account - revealing that would let an attacker
    enumerate registered emails (OWASP guidance). The actual reset link is
    only ever sent if a matching, active account exists."""
    user = db.query(User).filter(User.email == body.email).first()
    if user and user.is_active:
        token = security.create_access_token(
            user.id, expires_delta=timedelta(minutes=PASSWORD_RESET_TOKEN_MINUTES), scope="password_reset"
        )
        link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
        send_email(
            user.email,
            "Şifre Sıfırlama - Piraziz Yatırım",
            f"""
            <p>Merhaba{f' {user.full_name}' if user.full_name else ''},</p>
            <p>Hesabın için bir şifre sıfırlama isteği aldık. Aşağıdaki bağlantıya tıklayarak yeni bir şifre belirleyebilirsin:</p>
            <p><a href="{link}">Şifremi Sıfırla</a></p>
            <p>Bu bağlantı {PASSWORD_RESET_TOKEN_MINUTES} dakika geçerlidir. Bu isteği sen yapmadıysan bu e-postayı görmezden gelebilirsin, şifren değişmeyecek.</p>
            """,
        )
    return {"detail": "E-posta adresine kayıtlıysa bir şifre sıfırlama bağlantısı gönderildi."}


@router.post("/reset-password", response_model=UserOut)
@limiter.limit("5/minute")
def reset_password(request: Request, body: ResetPasswordRequest, db: Session = Depends(deps.get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz veya süresi dolmuş bağlantı, lütfen tekrar deneyin."
    )
    try:
        payload = jwt.decode(body.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise credentials_exception
    if payload.get("scope") != "password_reset" or not payload.get("sub"):
        raise credentials_exception

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user or not user.is_active:
        raise credentials_exception

    user.hashed_password = security.get_password_hash(body.new_password)
    db.commit()
    db.refresh(user)
    log_audit(db, "password_reset", request=request, user_id=user.id)
    return user


@router.post("/verify-email", response_model=UserOut)
def verify_email(body: VerifyEmailRequest, db: Session = Depends(deps.get_db)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz veya süresi dolmuş doğrulama bağlantısı."
    )
    try:
        payload = jwt.decode(body.token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
    except JWTError:
        raise credentials_exception
    if payload.get("scope") != "email_verify" or not payload.get("sub"):
        raise credentials_exception

    user = db.query(User).filter(User.id == int(payload["sub"])).first()
    if not user:
        raise credentials_exception

    user.is_email_verified = True
    db.commit()
    db.refresh(user)
    return user


@router.post("/resend-verification")
@limiter.limit("5/minute")
def resend_verification(request: Request, body: ResendVerificationRequest, db: Session = Depends(deps.get_db)):
    """Same enumeration-safe 200-regardless response as /forgot-password."""
    user = db.query(User).filter(User.email == body.email).first()
    if user and user.is_active and not user.is_email_verified:
        _send_verification_email(user)
    return {"detail": "E-posta adresine kayıtlıysa yeni bir doğrulama bağlantısı gönderildi."}
