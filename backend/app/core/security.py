import bcrypt
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, List, Tuple, Union
from jose import jwt
from app.core.config import settings

# How many single-use 2FA recovery codes are handed out when 2FA is enabled.
RECOVERY_CODE_COUNT = 10
# Unambiguous alphabet - no 0/O or 1/I/L, since these get written down on
# paper and typed back in by hand, often months later.
_RECOVERY_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"

def get_password_hash(password: str) -> str:
    """Hash password using bcrypt."""
    pwd_bytes = password.encode('utf-8')
    salt = bcrypt.gensalt()
    hashed = bcrypt.hashpw(pwd_bytes, salt)
    return hashed.decode('utf-8')

def verify_password(plain_password: str, hashed_password: str) -> bool:
    """Verify password using bcrypt."""
    try:
        pwd_bytes = plain_password.encode('utf-8')
        hashed_bytes = hashed_password.encode('utf-8')
        return bcrypt.checkpw(pwd_bytes, hashed_bytes)
    except Exception:
        return False

def create_access_token(subject: Union[str, Any], expires_delta: timedelta = None, scope: str = "access") -> str:
    """Create a JWT. `scope` defaults to "access" (a normal, fully-authenticated
    bearer token) - the 2FA login flow (see /auth/login, /auth/login/2fa)
    issues a short-lived scope="2fa_pending" token instead after a correct
    password, which proves "this password was right" without granting real
    API access; app/api/deps.py's get_current_user rejects anything whose
    scope isn't "access" so a pending-2FA token can never be used as a
    substitute for actually completing the second factor."""
    if expires_delta:
        expire = datetime.now(timezone.utc) + expires_delta
    else:
        expire = datetime.now(timezone.utc) + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES)

    to_encode = {"exp": expire, "sub": str(subject), "scope": scope}
    encoded_jwt = jwt.encode(to_encode, settings.SECRET_KEY, algorithm=settings.ALGORITHM)
    return encoded_jwt


def _normalize_recovery_code(code: str) -> str:
    """Strips formatting so a code is accepted however the user types it
    back - with or without the display hyphen, any case, stray spaces."""
    return code.strip().upper().replace("-", "").replace(" ", "")


def generate_recovery_codes() -> Tuple[List[str], List[str]]:
    """Returns (plaintext_codes, hashed_codes). The plaintext half is shown
    to the user exactly once at generation time and never stored; only the
    hashes are persisted (User.totp_recovery_codes)."""
    plaintext = []
    hashed = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = "".join(secrets.choice(_RECOVERY_ALPHABET) for _ in range(10))
        # Displayed hyphenated (ABCDE-FGHIJ) purely for readability; the
        # hyphen is stripped before hashing and before any comparison.
        plaintext.append(f"{raw[:5]}-{raw[5:]}")
        hashed.append(get_password_hash(raw))
    return plaintext, hashed


def consume_recovery_code(code: str, hashed_codes: List[str]) -> Union[List[str], None]:
    """Checks `code` against the stored hashes. On a match, returns the
    remaining hashes with the used one removed (recovery codes are
    single-use); returns None if nothing matched, so callers can tell
    "wrong code" from "correct, here's the new list"."""
    if not hashed_codes:
        return None
    candidate = _normalize_recovery_code(code)
    for stored in hashed_codes:
        if verify_password(candidate, stored):
            return [h for h in hashed_codes if h != stored]
    return None
