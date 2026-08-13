from typing import Generator, Optional
from fastapi import Depends, HTTPException, status
from fastapi.security import OAuth2PasswordBearer
from jose import jwt, JWTError
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.config import settings
from app.db.session import SessionLocal
from app.models.user import User

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/v1/auth/login")

class TokenPayload(BaseModel):
    sub: Optional[str] = None
    scope: Optional[str] = None

def get_db() -> Generator[Session, None, None]:
    """Database session dependency generator."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

def get_current_user(db: Session = Depends(get_db), token: str = Depends(oauth2_scheme)) -> User:
    """Dependency to retrieve current authenticated user from JWT."""
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
        token_data = TokenPayload(**payload)
        if token_data.sub is None:
            raise credentials_exception
        # A scope="2fa_pending" token (issued mid-login, before the TOTP
        # code is verified - see /auth/login) proves the password was
        # correct but must never work as a real bearer token. Tokens
        # issued before this field existed have no "scope" claim at all,
        # so None is treated the same as "access" for backward compatibility.
        if token_data.scope not in (None, "access"):
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = db.query(User).filter(User.id == int(token_data.sub)).first()
    if not user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inactive user")
        
    return user

def get_current_active_superuser(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to verify active superuser."""
    if not current_user.is_superuser:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="The user doesn't have enough privileges"
        )
    return current_user

def get_current_premium_user(current_user: User = Depends(get_current_user)) -> User:
    """Dependency to verify premium user status."""
    if current_user.role == "free":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Bu işlem için Premium üyelik gereklidir."
        )
    return current_user

# Only premium gets live (undelayed) market data - free gets everything
# (both live stock/index data and fund return estimates) delayed by
# DELAYED_DATA_MINUTES. Only two tiers exist: free and premium.
LIVE_DATA_ROLES = {"premium"}
DELAYED_DATA_MINUTES = 15


def get_data_delay_minutes(current_user: User = Depends(get_current_user)) -> int:
    """0 for premium (live data), DELAYED_DATA_MINUTES for free - applied
    everywhere real-time BIST data is served: screener quotes/charts,
    funds/fund estimates, and Trade module order pricing (see
    trade_service.get_live_price's delay_minutes param)."""
    return 0 if current_user.role in LIVE_DATA_ROLES else DELAYED_DATA_MINUTES
