# -*- coding: utf-8 -*-
"""Google ile Giriş.

Buradaki testler öncelikle GÜVENLİK davranışını koruyor:
  - 2FA açık bir hesapta Google girişi 2FA'yı ATLAMAMALI (aksi hâlde
    Google girişi 2FA'yı devre dışı bırakan bir arka kapı olurdu)
  - `state` tek kullanımlık olmalı (CSRF)
  - Google'da e-postası DOĞRULANMAMIŞ hesap kabul edilmemeli (başkasının
    adresiyle açılmış bir Google hesabı, o adrese ait mevcut hesabı ele
    geçirebilirdi)
  - Tek kullanımlık değişim kodu ikinci kez çalışmamalı
  - Yapılandırılmamışken özellik kapalı olmalı, şifreyle giriş etkilenmemeli
"""
from unittest.mock import patch

import pytest

from app.services import google_oauth


@pytest.fixture
def configured():
    with patch.object(google_oauth.settings, "GOOGLE_CLIENT_ID", "cid.apps.googleusercontent.com"), \
         patch.object(google_oauth.settings, "GOOGLE_CLIENT_SECRET", "secret"):
        yield


class _Store:
    """cache_service yerine gecen basit bellek deposu."""
    def __init__(self): self.d = {}
    def set(self, k, v, expire_seconds=None): self.d[k] = v; return True
    def get(self, k): return self.d.get(k)
    def set_json(self, k, v, expire_seconds=None): self.d[k] = v; return True
    def get_json(self, k): return self.d.get(k)
    def delete(self, k): self.d.pop(k, None); return True


@pytest.fixture
def store():
    s = _Store()
    with patch.object(google_oauth, "cache_service", s):
        yield s


def test_disabled_when_not_configured(client):
    assert client.get("/api/v1/auth/google/enabled").json() == {"enabled": False}
    assert client.get("/api/v1/auth/google/login", follow_redirects=False).status_code == 503


def test_enabled_when_configured(client, configured):
    assert client.get("/api/v1/auth/google/enabled").json() == {"enabled": True}


def test_state_is_single_use(configured, store):
    url = google_oauth.build_authorization_url()
    state = url.split("state=")[1].split("&")[0]
    assert google_oauth.consume_state(state) is True
    # Ikinci kez CALISMAMALI - CSRF korumasi.
    assert google_oauth.consume_state(state) is False


def test_state_fails_closed_when_store_unavailable(configured):
    class Dead(_Store):
        def set(self, k, v, expire_seconds=None): return False
    with patch.object(google_oauth, "cache_service", Dead()):
        with pytest.raises(google_oauth.GoogleAuthError):
            google_oauth.build_authorization_url()


def test_unverified_google_email_is_rejected(configured):
    """Dogrulanmamis e-posta kabul edilseydi, baskasinin adresiyle acilmis
    bir Google hesabi o adrese ait mevcut hesabi ele gecirebilirdi."""
    class R:
        status_code = 200
        def json(self): return {"id_token": "x"}
    with patch.object(google_oauth.requests, "post", return_value=R()), \
         patch("google.oauth2.id_token.verify_oauth2_token",
               return_value={"email": "a@b.com", "email_verified": False, "name": "A"}):
        with pytest.raises(google_oauth.GoogleAuthError, match="dogrulanmamis"):
            google_oauth.exchange_code_for_identity("code")


def test_verified_email_is_accepted(configured):
    class R:
        status_code = 200
        def json(self): return {"id_token": "x"}
    with patch.object(google_oauth.requests, "post", return_value=R()), \
         patch("google.oauth2.id_token.verify_oauth2_token",
               return_value={"email": "A@B.com", "email_verified": True, "name": "Ad Soyad"}):
        out = google_oauth.exchange_code_for_identity("code")
    assert out["email"] == "a@b.com"          # kucuk harfe normalize
    assert out["full_name"] == "Ad Soyad"


def test_invalid_id_token_is_rejected(configured):
    class R:
        status_code = 200
        def json(self): return {"id_token": "x"}
    with patch.object(google_oauth.requests, "post", return_value=R()), \
         patch("google.oauth2.id_token.verify_oauth2_token", side_effect=ValueError("bad sig")):
        with pytest.raises(google_oauth.GoogleAuthError):
            google_oauth.exchange_code_for_identity("code")


def test_exchange_code_is_single_use(store):
    code = google_oauth.issue_exchange_code(42, requires_2fa=False)
    assert google_oauth.consume_exchange_code(code) == {"user_id": 42, "requires_2fa": False}
    assert google_oauth.consume_exchange_code(code) is None


def test_exchange_endpoint_rejects_bad_code(client, store):
    r = client.post("/api/v1/auth/google/exchange", json={"code": "yok"})
    assert r.status_code == 400


def test_google_login_does_not_bypass_2fa(client, store, db):
    """En kritik test: TOTP acik bir hesapta Google girisi de kod istemeli."""
    from app.models.user import User
    from app.core import security

    u = User(email="tfa@test.com", hashed_password=security.get_password_hash("x"),
             totp_enabled=True, totp_secret="ABC", is_active=True)
    db.add(u); db.commit(); db.refresh(u)

    code = google_oauth.issue_exchange_code(u.id, requires_2fa=True)
    r = client.post("/api/v1/auth/google/exchange", json={"code": code})
    assert r.status_code == 200, r.text
    body = r.json()
    assert body.get("requires_2fa") is True
    assert "access_token" not in body, "2FA acikken gercek token VERILMEMELI"
    assert body.get("temp_token")


def test_exchange_returns_token_without_2fa(client, store, db):
    from app.models.user import User
    from app.core import security

    u = User(email="plain@test.com", hashed_password=security.get_password_hash("x"), is_active=True)
    db.add(u); db.commit(); db.refresh(u)

    code = google_oauth.issue_exchange_code(u.id, requires_2fa=False)
    body = client.post("/api/v1/auth/google/exchange", json={"code": code}).json()
    assert body.get("access_token")
    assert body.get("token_type") == "bearer"
