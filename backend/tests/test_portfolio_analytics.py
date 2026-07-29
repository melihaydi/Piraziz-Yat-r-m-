from app.services.portfolio_analytics import _pct_breakdown, _compute_allocation


def test_pct_breakdown_basic():
    totals = {"Bankacılık": 6000.0, "Ulaştırma": 4000.0}
    rows = _pct_breakdown(totals, total_value=10000.0)

    assert rows[0]["name"] == "Bankacılık"
    assert rows[0]["percentage"] == 60.0
    assert rows[1]["name"] == "Ulaştırma"
    assert rows[1]["percentage"] == 40.0


def test_pct_breakdown_zero_total_returns_empty():
    assert _pct_breakdown({"Bankacılık": 100.0}, total_value=0.0) == []


def test_pct_breakdown_excludes_zero_and_negative_values():
    totals = {"Bankacılık": 5000.0, "Boş Kategori": 0.0}
    rows = _pct_breakdown(totals, total_value=5000.0)
    assert len(rows) == 1
    assert rows[0]["name"] == "Bankacılık"


def test_compute_allocation_mixed_stock_and_fund():
    # THYAO (stock, real sector) + a 3-letter fund code (always "Yatırım
    # Fonu"/"Yatırım Fonları" regardless of what it actually is - the
    # len(ticker) == 3 heuristic used throughout this codebase).
    assets = [
        {"ticker": "THYAO", "total_value": 7000.0},
        {"ticker": "PHE", "total_value": 3000.0},
    ]
    result = _compute_allocation(assets, total_value=10000.0)

    sector_names = {row["name"] for row in result["sector_breakdown"]}
    assert "Ulaştırma" in sector_names
    assert "Yatırım Fonları" in sector_names

    type_by_name = {row["name"]: row["percentage"] for row in result["asset_type_breakdown"]}
    assert type_by_name["Hisse Senedi"] == 70.0
    assert type_by_name["Yatırım Fonu"] == 30.0


def test_compute_allocation_groups_same_sector_tickers_together():
    # Two different bank stocks should be summed into ONE "Bankacılık" row,
    # not two separate rows.
    assets = [
        {"ticker": "AKBNK", "total_value": 5000.0},
        {"ticker": "GARAN", "total_value": 5000.0},
    ]
    result = _compute_allocation(assets, total_value=10000.0)
    assert len(result["sector_breakdown"]) == 1
    assert result["sector_breakdown"][0]["name"] == "Bankacılık"
    assert result["sector_breakdown"][0]["percentage"] == 100.0
