from app.services.tefas import TefasService


def test_ticker_held_by_one_popular_fund():
    service = TefasService()
    # THYAO is a real holding of PBR (see FUND_DETAILS_MAP) but not TMV/DFI.
    matches = service.get_funds_holding_ticker("THYAO", ["TMV", "PBR", "DFI"])
    assert len(matches) == 1
    assert matches[0]["fund_code"] == "PBR"
    assert matches[0]["weight_pct"] > 0


def test_ticker_held_by_no_popular_fund():
    service = TefasService()
    matches = service.get_funds_holding_ticker("AKBNK_NOT_A_REAL_HOLDING_XYZ", ["TMV", "PBR", "DFI"])
    assert matches == []


def test_ticker_lookup_is_case_insensitive():
    service = TefasService()
    upper = service.get_funds_holding_ticker("THYAO", ["PBR"])
    lower = service.get_funds_holding_ticker("thyao", ["pbr"])
    assert upper == lower


def test_ticker_held_by_multiple_popular_funds():
    service = TefasService()
    # ANELE appears in both PBR and TMV's disclosed compositions.
    matches = service.get_funds_holding_ticker("ANELE", ["TMV", "PBR", "DFI"])
    fund_codes = {m["fund_code"] for m in matches}
    assert fund_codes == {"TMV", "PBR"}


def test_respects_the_fund_codes_filter():
    service = TefasService()
    # ANELE is held by both TMV and PBR, but only PBR is asked about here.
    matches = service.get_funds_holding_ticker("ANELE", ["PBR"])
    assert {m["fund_code"] for m in matches} == {"PBR"}
