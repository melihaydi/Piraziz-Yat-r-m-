from datetime import timedelta
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy.orm import Session

from app.core import security
from app.core.config import settings
from app.core.limiter import limiter
from app.api import deps
from app.models.user import User
from app.schemas.user import UserOut, UserCreate, UserUpdate
from app.schemas.token import Token

router = APIRouter()

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
    return db_user

@router.post("/login", response_model=Token)
@limiter.limit("5/minute")
def login_access_token(
    request: Request, db: Session = Depends(deps.get_db), form_data: OAuth2PasswordRequestForm = Depends()
):
    """OAuth2 compatible token login, get an access token for future requests."""
    user = db.query(User).filter(User.email == form_data.username).first()
    if not user or not security.verify_password(form_data.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Incorrect email or password"
        )
    elif not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Inactive user"
        )
    
    access_token_expires = timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)
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
