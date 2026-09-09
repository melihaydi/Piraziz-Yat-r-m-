# -*- coding: utf-8 -*-
"""Google ile Giriş - OAuth 2.0 authorization-code akışı.

Neden bu dosya var: uygulamada başka hiçbir Google entegrasyonu yoktu.
GOOGLE_CLIENT_ID/SECRET ayarlanmamışsa özellik TAMAMEN kapalıdır -
uçlar 503 döner, arayüzdeki buton hiç gösterilmez, şifreyle giriş
etkilenmez. (Aynı "yapılandırılmamışsa sessizce devre dışı" deseni
TV_SESSION ve TELEGRAM_* için de kullanılıyor.)

Güvenlik kararları - hepsi bilinçli:

1. `state` ZORUNLU ve TEK KULLANIMLIK. Redis'te tutuluyor, callback'te
   okunup hemen siliniyor. Redis erişilemezse akış BAŞARISIZ olur
   (fail-closed) - uygulamanın başka yerlerinde Redis yokluğu sessizce
   tolere ediliyor ama burada tolere etmek CSRF korumasını kapatmak
   demek olurdu.

2. id_token google-auth ile DOĞRULANIYOR (imza + issuer + audience +
   süre). Elle çözmek yerine kütüphane kullanılıyor.

3. `email_verified` şartı. Google'da e-postası doğrulanmamış bir hesap
   başkasının adresiyle açılabilir; bunu kabul etmek, o adrese ait
   mevcut hesabın ele geçirilmesi demek olurdu.

4. 2FA ATLANMIYOR. Hesapta TOTP açıksa Google girişi de tıpkı şifreyle
   giriş gibi temp_token döndürür, kullanıcı kodu girmek zorundadır.
   Aksi hâlde Google girişi 2FA'yı devre dışı bırakan bir arka kapı olurdu.

5. JWT URL'DE TAŞINMIYOR. Callback, frontend'e tek kullanımlık kısa ömürlü
   bir kod ile dönüyor; gerçek token o kodun POST ile değişilmesiyle
   veriliyor. Token'ı query string'e koymak onu tarayıcı geçmişine,
   sunucu loglarına ve Referer başlığına düşürürdü.
"""
import logging
import secrets
from typing import Any, Dict, Optional
from urllib.parse import urlencode

import requests

from app.core.config import settings
from app.core.redis import cache_service

logger = logging.getLogger(__name__)

AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth"
TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token"

_STATE_PREFIX = "google:oauth:state:"
_STATE_TTL_SECONDS = 10 * 60          # kullanicinin Google ekraninda gecirecegi sure
_EXCHANGE_PREFIX = "google:oauth:code:"
_EXCHANGE_TTL_SECONDS = 120           # frontend aninda degistiriyor; kisa tutuluyor


class GoogleAuthError(Exception):
    pass


def is_configured() -> bool:
    return bool(settings.GOOGLE_CLIENT_ID and settings.GOOGLE_CLIENT_SECRET)


def redirect_uri() -> str:
    """Google Cloud Console'da 'Authorized redirect URI' olarak birebir bu
    adres tanimlanmali."""
    return f"{settings.API_BASE_URL.rstrip('/')}/api/v1/auth/google/callback"


def build_authorization_url() -> str:
    """Google onay ekranina gidecek adres. state Redis'e yaziliyor;
    yazilamazsa akis BASLATILMIYOR (fail-closed)."""
    state = secrets.token_urlsafe(32)
    if not cache_service.set(_STATE_PREFIX + state, "1", expire_seconds=_STATE_TTL_SECONDS):
        raise GoogleAuthError(
            "Google girisi su an kullanilamiyor (oturum deposuna erisilemedi)."
        )
    params = {
        "client_id": settings.GOOGLE_CLIENT_ID,
        "redirect_uri": redirect_uri(),
        "response_type": "code",
        "scope": "openid email profile",
        "state": state,
        # Google hesap seciciyi her seferinde gostersin - kullanici yanlis
        # hesapla baglanip sonra degistiremez duruma dusmesin.
        "prompt": "select_account",
    }
    return f"{AUTH_ENDPOINT}?{urlencode(params)}"


def consume_state(state: str) -> bool:
    """state'i dogrular ve TEK KULLANIMLIK olacak sekilde siler."""
    if not state:
        return False
    key = _STATE_PREFIX + state
    if cache_service.get(key) is None:
        return False
    cache_service.delete(key)
    return True


def exchange_code_for_identity(code: str) -> Dict[str, Any]:
    """Yetkilendirme kodunu Google'la SUNUCU-SUNUCU degisir, donen
    id_token'i dogrula ve kimlik bilgilerini dondur.

    Donen: {"email", "email_verified", "full_name"}
    """
    resp = requests.post(
        TOKEN_ENDPOINT,
        data={
            "code": code,
            "client_id": settings.GOOGLE_CLIENT_ID,
            "client_secret": settings.GOOGLE_CLIENT_SECRET,
            "redirect_uri": redirect_uri(),
            "grant_type": "authorization_code",
        },
        timeout=10,
    )
    if resp.status_code != 200:
        logger.warning(f"Google token exchange failed: {resp.status_code} {resp.text[:200]}")
        raise GoogleAuthError("Google ile dogrulama tamamlanamadi.")

    raw_id_token = resp.json().get("id_token")
    if not raw_id_token:
        raise GoogleAuthError("Google yanitinda id_token yok.")

    # Imza + issuer + audience + sure kontrolu kutuphaneye birakiliyor.
    from google.auth.transport import requests as google_requests
    from google.oauth2 import id_token as google_id_token

    try:
        claims = google_id_token.verify_oauth2_token(
            raw_id_token, google_requests.Request(), settings.GOOGLE_CLIENT_ID
        )
    except Exception as e:
        logger.warning(f"Google id_token verification failed: {e}")
        raise GoogleAuthError("Google kimlik dogrulamasi gecersiz.")

    email = (claims.get("email") or "").strip().lower()
    if not email:
        raise GoogleAuthError("Google hesabinda e-posta bulunamadi.")

    # DOGRULANMAMIS e-posta kabul edilmiyor - bkz. modul basligindaki 3. madde.
    if not claims.get("email_verified"):
        raise GoogleAuthError(
            "Google hesabinizin e-postasi dogrulanmamis. Once Google'da dogrulayin."
        )

    return {
        "email": email,
        "email_verified": True,
        "full_name": (claims.get("name") or "").strip() or None,
    }


def issue_exchange_code(user_id: int, requires_2fa: bool) -> str:
    """Frontend'e URL ile donecek TEK KULLANIMLIK kod. Gercek JWT bu kodun
    POST ile degisilmesiyle veriliyor - bkz. modul basligindaki 5. madde."""
    code = secrets.token_urlsafe(32)
    ok = cache_service.set_json(
        _EXCHANGE_PREFIX + code,
        {"user_id": user_id, "requires_2fa": requires_2fa},
        expire_seconds=_EXCHANGE_TTL_SECONDS,
    )
    if not ok:
        raise GoogleAuthError("Giris tamamlanamadi (oturum deposuna erisilemedi).")
    return code


def consume_exchange_code(code: str) -> Optional[Dict[str, Any]]:
    """Kodu okur ve TEK KULLANIMLIK olacak sekilde siler."""
    if not code:
        return None
    key = _EXCHANGE_PREFIX + code
    data = cache_service.get_json(key)
    if data is None:
        return None
    cache_service.delete(key)
    return data
