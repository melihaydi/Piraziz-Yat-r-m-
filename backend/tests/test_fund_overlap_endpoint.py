from unittest.mock import patch


def test_overlap_endpoint_requires_at_least_two_codes(client):
    res = client.get("/api/v1/funds/overlap?codes=PHE")
    assert res.status_code == 400


def test_overlap_endpoint_no_auth_required(client):
    fake_result = {"codes": ["PHE", "TMV"], "pairs": [{"code_a": "PHE", "code_b": "TMV", "overlap_pct": 12.5, "common_holdings": []}]}
    with patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=None), \
         patch("app.api.v1.endpoints.funds.cache_service.set_json", return_value=True), \
         patch("app.api.v1.endpoints.funds.portfolio_ledger.compute_fund_overlap_matrix", return_value=fake_result):
        res = client.get("/api/v1/funds/overlap?codes=PHE,TMV")

    assert res.status_code == 200
    assert res.json() == fake_result


def test_overlap_endpoint_dedups_and_caps_at_five_codes(client):
    captured = {}

    def fake_matrix(codes):
        captured["codes"] = codes
        return {"codes": codes, "pairs": []}

    with patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=None), \
         patch("app.api.v1.endpoints.funds.cache_service.set_json", return_value=True), \
         patch("app.api.v1.endpoints.funds.portfolio_ledger.compute_fund_overlap_matrix", side_effect=fake_matrix):
        res = client.get("/api/v1/funds/overlap?codes=A,A,B,C,D,E,F")

    assert res.status_code == 200
    assert captured["codes"] == ["A", "B", "C", "D", "E"]


def test_overlap_endpoint_serves_from_cache(client):
    cached_payload = {"codes": ["PHE", "TMV"], "pairs": []}
    with patch("app.api.v1.endpoints.funds.cache_service.get_json", return_value=cached_payload), \
         patch("app.api.v1.endpoints.funds.portfolio_ledger.compute_fund_overlap_matrix") as mock_matrix:
        res = client.get("/api/v1/funds/overlap?codes=PHE,TMV")

    assert res.status_code == 200
    assert res.json() == cached_payload
    mock_matrix.assert_not_called()
