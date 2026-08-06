from app.api.v1.endpoints.funds import _with_impact_pct


def test_impact_pct_is_weight_times_change():
    holdings = [{"ticker": "OZATD", "weight": 34.27, "change_pct": 2.0, "type": "stock"}]
    out = _with_impact_pct(holdings)
    assert out[0]["impact_pct"] == round(34.27 / 100 * 2.0, 3)


def test_impact_pct_is_none_for_unresolved_holding():
    holdings = [{"ticker": "T3B", "weight": 0.01, "change_pct": None, "type": "unresolved"}]
    out = _with_impact_pct(holdings)
    assert out[0]["impact_pct"] is None


def test_impact_pct_preserves_original_fields():
    holdings = [{"ticker": "TERA", "weight": 4.11, "change_pct": -1.5, "type": "stock"}]
    out = _with_impact_pct(holdings)
    assert out[0]["ticker"] == "TERA"
    assert out[0]["weight"] == 4.11
    assert out[0]["change_pct"] == -1.5
