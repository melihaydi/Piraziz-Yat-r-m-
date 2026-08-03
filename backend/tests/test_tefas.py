import pytest

from app.services.tefas import TefasService, BASE_FUNDS


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
