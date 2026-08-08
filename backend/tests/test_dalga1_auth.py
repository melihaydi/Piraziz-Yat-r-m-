import pytest


@pytest.fixture
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "dalga1user@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "dalga1user@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.mark.parametrize("path", [
    "/api/v1/screener/",
    "/api/v1/screener/market-summary",
    "/api/v1/screener/kap",
    "/api/v1/funds/popular/live-estimate",
    "/api/v1/news/",
])
def test_previously_public_endpoints_now_require_auth(client, path):
    res = client.get(path)
    assert res.status_code == 401


@pytest.mark.parametrize("path", [
    "/api/v1/screener/",
    "/api/v1/screener/market-summary",
    "/api/v1/news/",
])
def test_previously_public_endpoints_work_with_a_valid_token(client, auth_headers, path):
    res = client.get(path, headers=auth_headers)
    assert res.status_code == 200


def test_login_rate_limit_kicks_in_after_five_attempts(client):
    # The existing 5/minute limit on /auth/login (auth.py) - a 6th rapid
    # attempt in the same window must be rejected with 429, not silently
    # let through.
    for _ in range(5):
        client.post(
            "/api/v1/auth/login",
            data={"username": "nobody@example.com", "password": "wrong"},
        )
    res = client.post(
        "/api/v1/auth/login",
        data={"username": "nobody@example.com", "password": "wrong"},
    )
    assert res.status_code == 429
