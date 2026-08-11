import pytest

import app.services.tefas as tefas_module
from app.services.tefas import TefasService, BASE_FUNDS, FUND_DETAILS_MAP


@pytest.fixture
def service(monkeypatch):
    svc = TefasService()
    # Never let a test spawn a real network-fetching background thread -
    # get_funds() unconditionally kicks one off when _last_refresh is stale,
    # which it always is right after __init__.
    monkeypatch.setattr(svc, "_bg_fetch_prices", lambda: None)
    return svc


def test_init_seeds_all_base_funds_from_fallbacks(service):
    funds = service.get_funds()
    codes = {f["code"] for f in funds}
    assert codes == set(BASE_FUNDS.keys())


def test_get_fund_returns_none_for_unknown_code(service):
    assert service.get_fund("NOTAFUND") is None


def test_get_fund_is_case_insensitive(service):
    assert service.get_fund("phe") is not None


def test_get_fund_merges_known_details(service):
    fund = service.get_fund("PHE")
    assert fund["risk_level"] == 6
    assert fund["manager"] == "Ömer Faruk Kar / Pusula Portföy"
    assert fund["code"] == "PHE"
    assert fund["price"] > 0


def test_get_fund_falls_back_to_default_details_for_unlisted_fund(service):
    # Inject a fund that exists in _cached_funds but has no entry in
    # get_fund's internal details_map, to exercise that fallback branch.
    with service._lock:
        service._cached_funds["ZZZ"] = {
            "code": "ZZZ", "name": "Test Fund", "category": "Test",
            "price": 1.0, "daily_return": 0.0, "weekly_return": 0.0, "monthly_return": 0.0,
        }
    fund = service.get_fund("ZZZ")
    assert fund["risk_level"] == 3
    assert fund["manager"] == "Pusula Portföy Yönetimi"
    assert fund["assets_distribution"] == [{"name": "Nakit ve Benzeri", "value": 100}]


def test_get_funds_never_blocks_on_stale_cache(service):
    # _last_refresh is datetime.min right after __init__, so this is always
    # "stale" - get_funds must still return the seeded cache immediately
    # rather than waiting on the (mocked-out) background fetch.
    funds = service.get_funds()
    assert len(funds) == len(BASE_FUNDS)


def test_estimated_return_uses_static_weight_when_as_of_missing(service, monkeypatch):
    # No "as_of" on this fund - weight-drift must be a no-op, matching the
    # pre-drift behavior exactly (a fund whose composition date isn't known
    # yet shouldn't have its weights silently reshuffled).
    fake_details = {
        "fund_size": "₺1", "risk_level": 1, "manager": "Test",
        "assets_distribution": [{"name": "AAA", "value": 60.0}, {"name": "BBB", "value": 40.0}],
    }
    monkeypatch.setitem(FUND_DETAILS_MAP, "ZNODRIFT", fake_details)
    monkeypatch.setattr(tefas_module, "_KNOWN_STOCK_TICKERS", {"AAA", "BBB"})
    service._drift_factors = {"AAA": 2.0, "BBB": 0.5}  # should be ignored entirely
    monkeypatch.setattr(
        tefas_module.market_data_service, "get_quote",
        lambda ticker: {"change_percent": 1.0},
    )

    result = service.get_live_estimated_return("ZNODRIFT")

    holdings = {h["ticker"]: h for h in result["holdings"]}
    assert holdings["AAA"]["weight"] == 60.0
    assert holdings["BBB"]["weight"] == 40.0


def test_estimated_return_applies_weight_drift_and_renormalizes(service, monkeypatch):
    # AAA has drifted up 50% and BBB is flat since as_of - AAA's real share
    # of the fund should now be larger than its stale 60% snapshot weight,
    # and BBB's smaller, while the two still sum back to the original 100
    # (not 130) so the estimate doesn't silently overstate total exposure.
    fake_details = {
        "fund_size": "₺1", "risk_level": 1, "manager": "Test",
        "as_of": "2026-08-01",
        "assets_distribution": [{"name": "AAA", "value": 60.0}, {"name": "BBB", "value": 40.0}],
    }
    monkeypatch.setitem(FUND_DETAILS_MAP, "ZDRIFT", fake_details)
    monkeypatch.setattr(tefas_module, "_KNOWN_STOCK_TICKERS", {"AAA", "BBB"})
    service._drift_factors = {"AAA": 1.5, "BBB": 1.0}
    monkeypatch.setattr(
        tefas_module.market_data_service, "get_quote",
        lambda ticker: {"change_percent": 2.0 if ticker == "AAA" else -1.0},
    )

    result = service.get_live_estimated_return("ZDRIFT")

    # raw_total=100, drifted_total = 60*1.5 + 40*1.0 = 130, scale = 100/130
    expected_aaa_weight = 60 * 1.5 * (100 / 130)
    expected_bbb_weight = 40 * 1.0 * (100 / 130)
    holdings = {h["ticker"]: h for h in result["holdings"]}
    assert holdings["AAA"]["weight"] == pytest.approx(expected_aaa_weight, abs=0.01)
    assert holdings["BBB"]["weight"] == pytest.approx(expected_bbb_weight, abs=0.01)
    assert result["resolved_weight_pct"] == pytest.approx(100.0, abs=0.01)
    expected_change = (expected_aaa_weight / 100) * 2.0 + (expected_bbb_weight / 100) * (-1.0)
    assert result["estimated_change_pct"] == pytest.approx(round(expected_change, 2), abs=0.01)


def test_estimated_return_drift_defaults_to_no_change_for_unresolved_ticker(service, monkeypatch):
    # A holding with no entry in _drift_factors (e.g. drift couldn't be
    # computed for it yet) must fall back to factor 1.0, not be dropped or
    # treated as 0 - it should behave exactly like the no-drift case.
    fake_details = {
        "fund_size": "₺1", "risk_level": 1, "manager": "Test",
        "as_of": "2026-08-01",
        "assets_distribution": [{"name": "AAA", "value": 100.0}],
    }
    monkeypatch.setitem(FUND_DETAILS_MAP, "ZUNRESOLVED", fake_details)
    monkeypatch.setattr(tefas_module, "_KNOWN_STOCK_TICKERS", {"AAA"})
    service._drift_factors = {}  # AAA not present
    monkeypatch.setattr(
        tefas_module.market_data_service, "get_quote",
        lambda ticker: {"change_percent": 3.0},
    )

    result = service.get_live_estimated_return("ZUNRESOLVED")

    assert result["holdings"][0]["weight"] == pytest.approx(100.0, abs=0.01)
    assert result["estimated_change_pct"] == pytest.approx(3.0, abs=0.01)
