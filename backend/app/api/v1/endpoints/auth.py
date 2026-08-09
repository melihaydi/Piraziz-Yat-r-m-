import base64
import io
from datetime import datetime, timedelta, timezone
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
    DeleteAccountRequest,
)
from app.schemas.twofa import (
    TwoFactorSetupResponse,
    TwoFactorVerifyResponse,
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
    if not user_in.terms_accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Kullanım Koşulları ve KVKK Aydınlatma Metni'ni kabul etmeniz gerekiyor.",
        )

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
        is_superuser=False,
        terms_accepted_at=datetime.now(timezone.utc),
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
    /auth/login) plus either the current 6-digit authenticator code OR one
    of the account's single-use recovery codes for a real access token.

    The recovery-code path is what makes a lost/wiped authenticator device
    survivable - password reset alone doesn't help, since it leaves
    totp_enabled on and the second factor would still be demanded."""
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

    via = "2fa"
    if pyotp.TOTP(user.totp_secret).verify(body.code, valid_window=1):
        pass
    else:
        # Not a valid TOTP - fall back to trying it as a recovery code.
        remaining = security.consume_recovery_code(body.code, user.totp_recovery_codes or [])
        if remaining is None:
            log_audit(db, "login_failed", request=request, user_id=user.id, details={"reason": "bad_2fa_code"})
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")
        # Single-use: burn it before issuing the token, so a replay of the
        # same code can't work even if this request is repeated.
        user.totp_recovery_codes = remaining
        db.commit()
        via = "recovery_code"
        log_audit(db, "recovery_code_used", request=request, user_id=user.id,
                  details={"remaining": len(remaining)})

    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
    log_audit(db, "login_success", request=request, user_id=user.id, details={"via": via})
    return {
        "access_token": security.create_access_token(user.id, expires_delta=access_token_expires),
        "token_type": "bearer",
    }

@router.get("/me", response_model=UserOut)
@limiter.limit("120/minute")
def read_user_me(request: Request, current_user: User = Depends(deps.get_current_user)):
    """Get current user details."""
    return current_user

@router.put("/me", response_model=UserOut)
@limiter.limit("20/minute")
def update_user_me(
    request: Request,
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


@router.get("/me/export")
@limiter.limit("5/minute")
def export_my_data(request: Request, db: Session = Depends(deps.get_db), current_user: User = Depends(deps.get_current_user)):
    """KVKK madde 11 kapsamındaki 'verilerimi indir' hakkı - kullanıcının
    kendi hesabına ait tüm verileri (profil + simüle trading hesapları +
    portföyler + notlar + alarmlar) tek bir JSON olarak döner."""
    from app.models.trade import TradeAccount
    from app.models.portfolio import Portfolio
    from app.models.note import Note
    from app.models.alert import Alert

    def iso(dt):
        return dt.isoformat() if dt else None

    trade_accounts = []
    for acc in db.query(TradeAccount).filter(TradeAccount.user_id == current_user.id).all():
        trade_accounts.append({
            "id": acc.id,
            "name": acc.name,
            "broker": acc.broker,
            "starting_balance": acc.starting_balance,
            "cash_balance": acc.cash_balance,
            "created_at": iso(acc.created_at),
            "positions": [
                {"symbol": p.symbol, "instrument_type": p.instrument_type, "lot": p.lot, "avg_cost": p.avg_cost}
                for p in acc.positions
            ],
            "orders": [
                {
                    "symbol": o.symbol, "side": o.side, "lot": o.lot, "price": o.price,
                    "commission": o.commission, "total": o.total, "realized_pnl": o.realized_pnl,
                    "executed_at": iso(o.executed_at),
                }
                for o in acc.orders
            ],
        })

    portfolios = []
    for p in db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all():
        portfolios.append({
            "id": p.id,
            "name": p.name,
            "created_at": iso(p.created_at),
            "assets": [
                {"ticker": a.ticker, "shares": a.shares, "average_cost": a.average_cost}
                for a in p.assets
            ],
        })

    notes = [
        {
            "title": n.title, "content": n.content, "ticker": n.ticker,
            "category": n.category, "created_at": iso(n.created_at),
        }
        for n in db.query(Note).filter(Note.user_id == current_user.id).all()
    ]

    alerts = [
        {
            "ticker": a.ticker, "alert_type": a.alert_type, "trigger_condition": a.trigger_condition,
            "is_active": a.is_active, "created_at": iso(a.created_at),
        }
        for a in db.query(Alert).filter(Alert.user_id == current_user.id).all()
    ]

    return {
        "exported_at": datetime.now(timezone.utc).isoformat(),
        "profile": {
            "email": current_user.email,
            "full_name": current_user.full_name,
            "role": current_user.role,
            "is_email_verified": current_user.is_email_verified,
            "totp_enabled": current_user.totp_enabled,
            "created_at": iso(current_user.created_at),
            "terms_accepted_at": iso(current_user.terms_accepted_at),
        },
        "trade_accounts": trade_accounts,
        "portfolios": portfolios,
        "notes": notes,
        "alerts": alerts,
    }


@router.post("/me/delete")
@limiter.limit("5/minute")
def delete_my_account(
    request: Request,
    body: DeleteAccountRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """KVKK madde 11 kapsamındaki 'hesabımı sil' hakkı. Şifre tekrar
    istenerek (çalıntı bir oturum token'ının tek başına yeterli olmaması
    için, 2FA disable ile aynı desen) doğrulanır. Gerçek bir hard-delete
    yerine soft-delete + anonimleştirme yapılır - is_active=False zaten
    /auth/login ve get_current_user'da hesabı tamamen kullanılamaz hale
    getiriyor, ilişkili trade/portföy/not/alarm kayıtları veritabanında
    kalır (finansal/denetim izi için) ama artık kimseyle ilişkilendirilebilir
    kişisel veri (e-posta, isim) içermez."""
    if not security.verify_password(body.password, current_user.hashed_password):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Şifre hatalı.")

    user_id = current_user.id
    current_user.is_active = False
    current_user.email = f"deleted-user-{user_id}@piraziz.local"
    current_user.full_name = None
    current_user.totp_secret = None
    current_user.totp_enabled = False
    db.commit()

    log_audit(db, "account_deleted", request=request, user_id=user_id)
    return {"detail": "Hesabınız silindi."}


@router.post("/2fa/setup", response_model=TwoFactorSetupResponse)
@limiter.limit("10/minute")
def setup_2fa(
    request: Request,
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


@router.post("/2fa/verify", response_model=TwoFactorVerifyResponse)
@limiter.limit("10/minute")
def verify_2fa(
    request: Request,
    body: TwoFactorCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Confirms possession of the authenticator by checking one real code
    against the pending secret from /2fa/setup, then flips totp_enabled on
    and issues the account's single-use recovery codes.

    Those codes are returned here and nowhere else - only their hashes are
    stored, so this response is the user's one chance to save them."""
    import pyotp

    if not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Önce /2fa/setup ile bir QR kod oluşturulmalı.")
    if not pyotp.TOTP(current_user.totp_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")

    plaintext, hashed = security.generate_recovery_codes()
    current_user.totp_enabled = True
    current_user.totp_recovery_codes = hashed
    db.commit()
    return {"recovery_codes": plaintext}


@router.post("/2fa/recovery-codes/regenerate", response_model=TwoFactorVerifyResponse)
@limiter.limit("5/minute")
def regenerate_recovery_codes(
    request: Request,
    body: TwoFactorCodeRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Issues a fresh set of recovery codes, invalidating all previous ones.
    Requires a current authenticator code (same reasoning as /2fa/disable -
    a stolen session alone shouldn't mint working second factors)."""
    import pyotp

    if not current_user.totp_enabled or not current_user.totp_secret:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="2FA aktif değil.")
    if not pyotp.TOTP(current_user.totp_secret).verify(body.code, valid_window=1):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kod hatalı veya süresi dolmuş.")

    plaintext, hashed = security.generate_recovery_codes()
    current_user.totp_recovery_codes = hashed
    db.commit()
    return {"recovery_codes": plaintext}


@router.post("/2fa/disable", response_model=UserOut)
@limiter.limit("10/minute")
def disable_2fa(
    request: Request,
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
    current_user.totp_recovery_codes = None
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
@limiter.limit("10/minute")
def verify_email(request: Request, body: VerifyEmailRequest, db: Session = Depends(deps.get_db)):
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
