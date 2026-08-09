import pyotp
import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "2fauser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "2fauser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_login_without_2fa_returns_real_token_directly(client, auth_headers):
    # auth_headers fixture already did a plain login - just confirm the
    # response shape has no requires_2fa flag when 2FA was never set up.
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "2fauser@example.com", "password": "mypassword"}
    )
    data = login_response.json()
    assert data["access_token"]
    assert not data.get("requires_2fa")


def test_setup_then_verify_enables_2fa(client, auth_headers):
    setup_response = client.post("/api/v1/auth/2fa/setup", headers=auth_headers)
    assert setup_response.status_code == 200
    secret = setup_response.json()["secret"]
    assert setup_response.json()["qr_code_base64"].startswith("data:image/png;base64,")

    me_before = client.get("/api/v1/auth/me", headers=auth_headers).json()
    assert me_before["totp_enabled"] is False

    code = pyotp.TOTP(secret).now()
    verify_response = client.post(
        "/api/v1/auth/2fa/verify", json={"code": code}, headers=auth_headers
    )
    assert verify_response.status_code == 200
    # Enabling 2FA hands back the one-time recovery codes (and nothing else -
    # they're only ever visible in this response).
    codes = verify_response.json()["recovery_codes"]
    assert len(codes) == 10
    assert all("-" in c for c in codes)

    me_after = client.get("/api/v1/auth/me", headers=auth_headers).json()
    assert me_after["totp_enabled"] is True


def test_verify_rejects_wrong_code(client, auth_headers):
    client.post("/api/v1/auth/2fa/setup", headers=auth_headers)
    response = client.post(
        "/api/v1/auth/2fa/verify", json={"code": "000000"}, headers=auth_headers
    )
    assert response.status_code == 400


def test_login_with_2fa_enabled_requires_second_step(client, auth_headers):
    setup_response = client.post("/api/v1/auth/2fa/setup", headers=auth_headers)
    secret = setup_response.json()["secret"]
    client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=auth_headers)

    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "2fauser@example.com", "password": "mypassword"}
    )
    data = login_response.json()
    assert data["requires_2fa"] is True
    assert data.get("access_token") is None
    temp_token = data["temp_token"]

    # The temp_token must NOT work as a real bearer token on a protected
    # endpoint - this is the whole point of the scope="2fa_pending" check
    # in app/api/deps.py's get_current_user.
    blocked = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {temp_token}"})
    assert blocked.status_code == 401

    # Wrong code on the second step must be rejected.
    wrong = client.post("/api/v1/auth/login/2fa", json={"temp_token": temp_token, "code": "000000"})
    assert wrong.status_code == 400

    # Correct code completes the login and returns a real, working token.
    ok = client.post(
        "/api/v1/auth/login/2fa",
        json={"temp_token": temp_token, "code": pyotp.TOTP(secret).now()}
    )
    assert ok.status_code == 200
    real_token = ok.json()["access_token"]
    me = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {real_token}"})
    assert me.status_code == 200
    assert me.json()["email"] == "2fauser@example.com"


def test_disable_2fa_requires_current_code(client, auth_headers):
    setup_response = client.post("/api/v1/auth/2fa/setup", headers=auth_headers)
    secret = setup_response.json()["secret"]
    client.post("/api/v1/auth/2fa/verify", json={"code": pyotp.TOTP(secret).now()}, headers=auth_headers)

    wrong = client.post("/api/v1/auth/2fa/disable", json={"code": "000000"}, headers=auth_headers)
    assert wrong.status_code == 400

    ok = client.post(
        "/api/v1/auth/2fa/disable", json={"code": pyotp.TOTP(secret).now()}, headers=auth_headers
    )
    assert ok.status_code == 200
    assert ok.json()["totp_enabled"] is False

    # Plain login works again without a second step now.
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "2fauser@example.com", "password": "mypassword"}
    )
    assert login_response.json()["access_token"]
