from unittest.mock import patch

import pytest


@pytest.fixture(scope="function")
def free_user_headers(client):
    """A plain "free" role user - the default for a fresh registration, and
    NOT in LIVE_DATA_ROLES, so get_data_delay_minutes() returns > 0 for it
    (see deps.py). This is the exact condition that triggered the
    UnboundLocalError regression below."""
    client.post(
        "/api/v1/auth/register",
        json={"email": "chartfreeuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "chartfreeuser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_chart_endpoint_does_not_crash_for_delay_gated_user_with_real_candles(client, free_user_headers):
    # Regression test: get_stock_chart() had a stray `import time` inside
    # its simulated-candle fallback block (only reached when candles is
    # empty). Because Python scopes `import` statements to the whole
    # function regardless of which branch they're nested in, this made
    # `time` local to the ENTIRE function - so the unrelated `if delay > 0:`
    # branch further down (which also calls time.time(), for delay-gated
    # free-tier users) raised UnboundLocalError whenever REAL candles were
    # returned (skipping the fallback block that would have "defined"
    # `time` locally). This crashed the chart endpoint - and therefore the
    # homepage index chart - for every free-tier user, which is most users
    # by default. Confirmed live in production logs (2026-08-13) and
    # reported by the user as the whole app being inaccessible.
    real_candles = [
        {"time": 1700000000 + i * 86400, "open": 100.0, "high": 101.0, "low": 99.0, "close": 100.5, "volume": 1000}
        for i in range(30)
    ]
    with patch(
        "app.api.v1.endpoints.screener.market_data_service.get_candles",
        return_value=real_candles,
    ):
        response = client.get("/api/v1/screener/chart/XU100?interval=1d", headers=free_user_headers)

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body, list)
    assert len(body) > 0
