import pyotp
import pytest

from app.models.user import User


def _enable_2fa(client, headers):
    """Turns 2FA on for the logged-in user, returning (secret, recovery_codes)."""
    secret = client.post("/api/v1/auth/2fa/setup", headers=headers).json()["secret"]
    res = client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=headers)
    return secret, res.json()["recovery_codes"]


@pytest.fixture
def auth_headers(client):
    client.post("/api/v1/auth/register", json={"email": "rec@example.com", "password": "mypassword", "terms_accepted": True})
    login = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture
def admin_headers(client, db):
    client.post("/api/v1/auth/register", json={"email": "recadmin@example.com", "password": "mypassword", "terms_accepted": True})
    user = db.query(User).filter(User.email == "recadmin@example.com").first()
    user.is_superuser = True
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "recadmin@example.com", "password": "mypassword"})
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


def test_recovery_codes_are_stored_hashed_not_plaintext(client, auth_headers, db):
    _, codes = _enable_2fa(client, auth_headers)
    user = db.query(User).filter(User.email == "rec@example.com").first()

    assert len(user.totp_recovery_codes) == 10
    # Nothing the user was shown may appear verbatim in the database.
    for stored in user.totp_recovery_codes:
        assert stored.startswith("$2b$")
        assert stored not in codes


def test_recovery_code_completes_login_when_authenticator_is_lost(client, auth_headers):
    _, codes = _enable_2fa(client, auth_headers)

    login = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"})
    temp_token = login.json()["temp_token"]

    # No access to the authenticator at all - only the printed recovery code.
    res = client.post("/api/v1/auth/login/2fa", json={"temp_token": temp_token, "code": codes[0]})
    assert res.status_code == 200
    real_token = res.json()["access_token"]

    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {real_token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "rec@example.com"


def test_recovery_code_is_single_use(client, auth_headers, db):
    _, codes = _enable_2fa(client, auth_headers)

    def login_with(code):
        temp = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"}).json()["temp_token"]
        return client.post("/api/v1/auth/login/2fa", json={"temp_token": temp, "code": code})

    assert login_with(codes[0]).status_code == 200
    # Replaying the same code must fail - it was burned on first use.
    assert login_with(codes[0]).status_code == 400
    # A different, unused code still works.
    assert login_with(codes[1]).status_code == 200

    user = db.query(User).filter(User.email == "rec@example.com").first()
    assert len(user.totp_recovery_codes) == 8


def test_recovery_code_accepted_regardless_of_formatting(client, auth_headers):
    _, codes = _enable_2fa(client, auth_headers)
    temp = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"}).json()["temp_token"]

    # Typed back lowercase, without the display hyphen, with stray spaces.
    messy = f"  {codes[0].replace('-', '').lower()}  "
    assert client.post("/api/v1/auth/login/2fa", json={"temp_token": temp, "code": messy}).status_code == 200


def test_wrong_recovery_code_is_rejected(client, auth_headers):
    _enable_2fa(client, auth_headers)
    temp = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"}).json()["temp_token"]

    assert client.post("/api/v1/auth/login/2fa", json={"temp_token": temp, "code": "AAAAA-BBBBB"}).status_code == 400


def test_regenerate_invalidates_the_old_codes(client, auth_headers):
    secret, old_codes = _enable_2fa(client, auth_headers)

    res = client.post(
        "/api/v1/auth/2fa/recovery-codes/regenerate",
        json={"code": pyotp.TOTP(secret).now()},
        headers=auth_headers,
    )
    assert res.status_code == 200
    new_codes = res.json()["recovery_codes"]
    assert set(new_codes).isdisjoint(set(old_codes))

    temp = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"}).json()["temp_token"]
    assert client.post("/api/v1/auth/login/2fa", json={"temp_token": temp, "code": old_codes[0]}).status_code == 400


def test_disabling_2fa_clears_recovery_codes(client, auth_headers, db):
    secret, _ = _enable_2fa(client, auth_headers)
    client.post("/api/v1/auth/2fa/disable", json={"code": pyotp.TOTP(secret).now()}, headers=auth_headers)

    user = db.query(User).filter(User.email == "rec@example.com").first()
    assert user.totp_recovery_codes is None


def test_admin_can_reset_2fa_for_a_locked_out_user(client, auth_headers, admin_headers, db):
    _enable_2fa(client, auth_headers)
    target = db.query(User).filter(User.email == "rec@example.com").first()

    res = client.post(f"/api/v1/admin/users/{target.id}/reset-2fa", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["totp_enabled"] is False

    # The user can now log in with password alone again.
    login = client.post("/api/v1/auth/login", data={"username": "rec@example.com", "password": "mypassword"})
    assert login.json()["access_token"]


def test_regular_user_cannot_reset_someone_elses_2fa(client, auth_headers, db):
    _enable_2fa(client, auth_headers)
    target = db.query(User).filter(User.email == "rec@example.com").first()

    res = client.post(f"/api/v1/admin/users/{target.id}/reset-2fa", headers=auth_headers)
    assert res.status_code == 403
