from unittest.mock import patch


def _register_and_login(client, email="cutofftest@example.com", password="mypassword"):
    with patch("app.api.v1.endpoints.auth.send_email"):
        client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "terms_accepted": True},
        )
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_live_estimate_endpoint_returns_estimate_and_cutoff(client, db):
    headers = _register_and_login(client)

    fake_estimate = {"code": "PHE", "estimated_change_pct": 1.23, "resolved_weight_pct": 87.5, "holdings": []}
    fake_cutoff = {"cutoff_time": "13:30", "same_day": True, "minutes_remaining": 42}

    with patch("app.api.v1.endpoints.funds.tefas_service.get_fund", return_value={"code": "PHE", "name": "PHE Fonu"}), \
         patch("app.api.v1.endpoints.funds.tefas_service.get_live_estimated_return", return_value=fake_estimate), \
         patch("app.api.v1.endpoints.funds.tefas_order_cutoff_info", return_value=fake_cutoff), \
         patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=None), \
         patch("app.api.v1.endpoints.funds.cache_service.set_json", return_value=True):
        res = client.get("/api/v1/funds/PHE/live-estimate", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["code"] == "PHE"
    assert body["estimated_change_pct"] == 1.23
    assert body["resolved_weight_pct"] == 87.5
    assert body["order_cutoff"] == fake_cutoff


def test_live_estimate_endpoint_404_for_unknown_fund(client, db):
    headers = _register_and_login(client, "cutoff404@example.com")

    with patch("app.api.v1.endpoints.funds.tefas_service.get_fund", return_value=None), \
         patch("app.api.v1.endpoints.funds.tefas_service.get_live_estimated_return", return_value=None), \
         patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=None):
        res = client.get("/api/v1/funds/NOTAFUND/live-estimate", headers=headers)

    assert res.status_code == 404


def test_live_estimate_endpoint_null_estimate_when_unresolvable(client, db):
    # Fon var ama composition/quote şu an cozulemedi (get_live_estimated_return None
    # donuyor) - endpoint yine de 200 donmeli, sadece tahmin alanlari None olmali,
    # ve bu durum cache'lenmemeli (bir sonraki istekte tekrar denenebilsin diye).
    headers = _register_and_login(client, "cutoffnull@example.com")

    fake_cutoff = {"cutoff_time": "13:30", "same_day": False, "minutes_remaining": 0}

    with patch("app.api.v1.endpoints.funds.tefas_service.get_fund", return_value={"code": "XYZ"}), \
         patch("app.api.v1.endpoints.funds.tefas_service.get_live_estimated_return", return_value=None), \
         patch("app.api.v1.endpoints.funds.tefas_order_cutoff_info", return_value=fake_cutoff), \
         patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=None) as mock_get, \
         patch("app.api.v1.endpoints.funds.cache_service.set_json") as mock_set:
        res = client.get("/api/v1/funds/XYZ/live-estimate", headers=headers)

    assert res.status_code == 200
    body = res.json()
    assert body["estimated_change_pct"] is None
    assert body["resolved_weight_pct"] is None
    assert body["order_cutoff"] == fake_cutoff
    mock_set.assert_not_called()


def test_live_estimate_requires_auth(client, db):
    res = client.get("/api/v1/funds/PHE/live-estimate")
    assert res.status_code == 401
