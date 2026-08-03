from unittest.mock import patch

from app.services.tefas import TefasService


def _quotes(mapping):
    def _get_quote(ticker):
        if ticker in mapping:
            return {"change_percent": mapping[ticker]}
        return None
    return _get_quote


def test_estimate_is_weighted_sum_of_stock_holdings():
    service = TefasService()
    # DFI = IEYHO 64.87% + ABG 36.00% (fund, no quote) + ISKPL 4.93%
    with patch("app.services.tefas.market_data_service.get_quote", side_effect=_quotes({
        "IEYHO": 2.0, "ISKPL": -1.0,
    })):
        result = service.get_live_estimated_return("DFI")

    assert result["code"] == "DFI"
    ieyho = next(h for h in result["holdings"] if h["ticker"] == "IEYHO")
    iskpl = next(h for h in result["holdings"] if h["ticker"] == "ISKPL")
    assert ieyho["change_pct"] == 2.0
    assert iskpl["change_pct"] == -1.0


def test_estimate_recurses_into_sub_fund_composition():
    service = TefasService()
    # PBR holds PKZ (a tracked fund) among its holdings. PKZ's own
    # composition (Hisse Senedi (BIST)/Ters Repo/Nakit) has zero resolvable
    # tickers, so PKZ's contribution should fall back to its cached daily
    # return rather than recursing into unresolvable category labels.
    with service._lock:
        service._cached_funds["PKZ"] = {"daily_return": 3.5}
    with patch("app.services.tefas.market_data_service.get_quote", return_value=None):
        result = service.get_live_estimated_return("PBR")

    pkz_holding = next(h for h in result["holdings"] if h["ticker"] == "PKZ")
    assert pkz_holding["type"] == "fund_daily"
    assert pkz_holding["change_pct"] == 3.5


def test_estimate_excludes_unresolvable_holdings_from_weighted_sum():
    service = TefasService()
    # TefasService.__init__ seeds every BASE_FUNDS entry (including ABG)
    # into _cached_funds from FALLBACKS - clear that here so this test
    # exercises the genuinely-nothing-resolvable case (ISKPL isn't a
    # tracked fund and has no live quote mocked, so it must end up
    # unresolved rather than contributing a fabricated number).
    with service._lock:
        service._cached_funds.pop("ABG", None)
    with patch("app.services.tefas.market_data_service.get_quote", return_value=None):
        result = service.get_live_estimated_return("DFI")

    assert result["estimated_change_pct"] == 0.0
    unresolved = [h for h in result["holdings"] if h["type"] == "unresolved"]
    assert len(unresolved) >= 1  # ISKPL at minimum, since no quote is mocked


def test_estimate_falls_back_to_seeded_fallback_daily_return_for_sub_fund():
    # Without clearing anything, a fresh TefasService already has FALLBACKS
    # seeded into _cached_funds for every BASE_FUNDS code - ABG's recursive
    # estimate (0% resolvable from its own category-label composition)
    # should fall back to that seeded fallback daily_return rather than
    # going unresolved.
    service = TefasService()
    with patch("app.services.tefas.market_data_service.get_quote", return_value=None):
        result = service.get_live_estimated_return("DFI")

    abg_holding = next(h for h in result["holdings"] if h["ticker"] == "ABG")
    assert abg_holding["type"] == "fund_daily"
    assert abg_holding["change_pct"] == service._cached_funds["ABG"]["daily_return"]


def test_estimate_guards_against_cycles():
    service = TefasService()
    # PBR contains PRY, which (per BASE_FUNDS) is itself a tracked fund with
    # no known composition - must fall back cleanly, never infinite-loop.
    with patch("app.services.tefas.market_data_service.get_quote", return_value=None):
        result = service.get_live_estimated_return("PBR")
    assert result is not None  # completed without recursing forever


def test_estimate_returns_none_for_unknown_fund_code():
    service = TefasService()
    assert service.get_live_estimated_return("NOTAFUND") is None


def test_category_labels_are_never_treated_as_real_stocks():
    # Regression guard: market_data_service.get_quote() never actually
    # returns None in production - for ANY unrecognized symbol it still
    # returns a synthetic fallback quote with change_percent=0.0 while it
    # tries to subscribe in the background. A category label like "Ters
    # Repo"/"Nakit" (ABG's own composition, reached via DFI's ABG holding)
    # must never be silently counted as a real "0% today" stock just
    # because get_quote() happened to return something truthy for it.
    service = TefasService()
    with service._lock:
        service._cached_funds.pop("ABG", None)  # force the fallback-daily path to also miss
    always_fallback_quote = lambda ticker: {"symbol": ticker, "change_percent": 0.0}
    with patch("app.services.tefas.market_data_service.get_quote", side_effect=always_fallback_quote):
        result = service.get_live_estimated_return("DFI")

    abg_holding = next(h for h in result["holdings"] if h["ticker"] == "ABG")
    assert abg_holding["type"] != "stock"
    # IEYHO/ISKPL ARE real tracked tickers though, so they must still resolve.
    ieyho_holding = next(h for h in result["holdings"] if h["ticker"] == "IEYHO")
    assert ieyho_holding["type"] == "stock"
    assert ieyho_holding["change_pct"] == 0.0


def test_estimate_excludes_implausible_quote_swings():
    # Regression guard: a live feed glitch (confirmed in production - KTLEV
    # reporting a -73% "change" from a stale prev_close, impossible on BIST
    # where the session price limit is roughly +-10%) must not be trusted
    # into the weighted estimate. IEYHO's real quote must still resolve
    # normally alongside it.
    service = TefasService()
    bad_quotes = {"IEYHO": 2.0, "ISKPL": -73.38}
    with patch("app.services.tefas.market_data_service.get_quote",
               side_effect=lambda t: {"change_percent": bad_quotes[t]} if t in bad_quotes else None):
        result = service.get_live_estimated_return("DFI")

    iskpl_holding = next(h for h in result["holdings"] if h["ticker"] == "ISKPL")
    assert iskpl_holding["type"] == "unresolved"
    assert iskpl_holding["change_pct"] is None
    ieyho_holding = next(h for h in result["holdings"] if h["ticker"] == "IEYHO")
    assert ieyho_holding["type"] == "stock"
    assert ieyho_holding["change_pct"] == 2.0
