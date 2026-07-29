from app.services.sectors import get_sector, SECTOR_MAP


def test_get_sector_known_ticker():
    assert get_sector("THYAO") == "Ulaştırma"
    assert get_sector("AKBNK") == "Bankacılık"
    assert get_sector("EREGL") == "Metal Sanayi"


def test_get_sector_unknown_ticker_falls_back_to_sinai():
    # A ticker with none of the fallback substrings ("FN", "BKO", "GR", "IS")
    # and not in SECTOR_MAP should land on the generic "Sınai" bucket.
    assert "ZZZZZ" not in SECTOR_MAP
    assert get_sector("ZZZZZ") == "Sınai"


def test_sector_map_has_no_duplicate_bist30_gaps():
    # Sanity check on the map itself, not just the lookup function - every
    # value should be a non-empty sector label (catches an accidental
    # empty-string or None entry breaking allocation grouping).
    for ticker, sector in SECTOR_MAP.items():
        assert isinstance(sector, str) and len(sector) > 0, f"{ticker} has an invalid sector value"
