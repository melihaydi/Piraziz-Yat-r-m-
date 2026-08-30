from unittest.mock import patch

import pytest

from app.services import portfolio_ledger


def _fake_get_live_estimated_return(overrides):
    def fn(code, _visited=None, delay_minutes=0):
        return overrides.get(code.upper())
    return fn


def test_compute_fund_overlap_known_holdings():
    # Fon A: %50 THYAO + %30 GARAN. Fon B: %20 THYAO + %40 AKBNK.
    # Ortak: THYAO -> min(50,20) = 20 puan overlap.
    overrides = {
        "AAA": {
            "code": "AAA", "estimated_change_pct": 1.0, "resolved_weight_pct": 80.0,
            "holdings": [
                {"ticker": "THYAO", "weight": 50.0, "change_pct": 1.0, "type": "stock"},
                {"ticker": "GARAN", "weight": 30.0, "change_pct": 1.0, "type": "stock"},
            ],
        },
        "BBB": {
            "code": "BBB", "estimated_change_pct": 1.0, "resolved_weight_pct": 60.0,
            "holdings": [
                {"ticker": "THYAO", "weight": 20.0, "change_pct": 1.0, "type": "stock"},
                {"ticker": "AKBNK", "weight": 40.0, "change_pct": 1.0, "type": "stock"},
            ],
        },
    }

    with patch(
        "app.services.tefas.tefas_service.get_live_estimated_return",
        side_effect=_fake_get_live_estimated_return(overrides),
    ):
        result = portfolio_ledger.compute_fund_overlap("AAA", "BBB")

    assert result is not None
    assert result["overlap_pct"] == pytest.approx(20.0)
    assert result["resolved_a_pct"] == pytest.approx(80.0)
    assert result["resolved_b_pct"] == pytest.approx(60.0)
    assert len(result["common_holdings"]) == 1
    common = result["common_holdings"][0]
    assert common["ticker"] == "THYAO"
    assert common["weight_a_pct"] == pytest.approx(50.0)
    assert common["weight_b_pct"] == pytest.approx(20.0)


def test_compute_fund_overlap_no_common_holdings_is_zero_not_none():
    overrides = {
        "AAA": {
            "code": "AAA", "estimated_change_pct": 1.0, "resolved_weight_pct": 50.0,
            "holdings": [{"ticker": "THYAO", "weight": 50.0, "change_pct": 1.0, "type": "stock"}],
        },
        "BBB": {
            "code": "BBB", "estimated_change_pct": 1.0, "resolved_weight_pct": 50.0,
            "holdings": [{"ticker": "AKBNK", "weight": 50.0, "change_pct": 1.0, "type": "stock"}],
        },
    }
    with patch(
        "app.services.tefas.tefas_service.get_live_estimated_return",
        side_effect=_fake_get_live_estimated_return(overrides),
    ):
        result = portfolio_ledger.compute_fund_overlap("AAA", "BBB")

    assert result is not None
    assert result["overlap_pct"] == 0.0
    assert result["common_holdings"] == []


def test_compute_fund_overlap_returns_none_when_unresolvable():
    with patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=None):
        result = portfolio_ledger.compute_fund_overlap("AAA", "BBB")
    assert result is None


def test_compute_fund_overlap_identical_funds_is_full_overlap():
    fund = {
        "code": "AAA", "estimated_change_pct": 1.0, "resolved_weight_pct": 90.0,
        "holdings": [
            {"ticker": "THYAO", "weight": 60.0, "change_pct": 1.0, "type": "stock"},
            {"ticker": "GARAN", "weight": 30.0, "change_pct": 1.0, "type": "stock"},
        ],
    }
    with patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=fund):
        result = portfolio_ledger.compute_fund_overlap("AAA", "BBB")

    assert result["overlap_pct"] == pytest.approx(90.0)


def test_compute_fund_overlap_matrix_builds_all_pairs():
    overrides = {
        "AAA": {
            "code": "AAA", "estimated_change_pct": 1.0, "resolved_weight_pct": 50.0,
            "holdings": [{"ticker": "THYAO", "weight": 50.0, "change_pct": 1.0, "type": "stock"}],
        },
        "BBB": {
            "code": "BBB", "estimated_change_pct": 1.0, "resolved_weight_pct": 50.0,
            "holdings": [{"ticker": "THYAO", "weight": 30.0, "change_pct": 1.0, "type": "stock"}],
        },
        "CCC": None,  # kompozisyonu çözülemeyen bir fon
    }
    with patch(
        "app.services.tefas.tefas_service.get_live_estimated_return",
        side_effect=_fake_get_live_estimated_return(overrides),
    ):
        result = portfolio_ledger.compute_fund_overlap_matrix(["AAA", "BBB", "CCC"])

    assert result["codes"] == ["AAA", "BBB", "CCC"]
    assert len(result["pairs"]) == 3  # C(3,2)

    ab = next(p for p in result["pairs"] if {p["code_a"], p["code_b"]} == {"AAA", "BBB"})
    assert ab["overlap_pct"] == pytest.approx(30.0)

    ac = next(p for p in result["pairs"] if {p["code_a"], p["code_b"]} == {"AAA", "CCC"})
    assert ac["overlap_pct"] is None


def test_compute_fund_overlap_matrix_dedups_codes():
    with patch("app.services.tefas.tefas_service.get_live_estimated_return", return_value=None):
        result = portfolio_ledger.compute_fund_overlap_matrix(["AAA", "aaa", "BBB"])
    assert result["codes"] == ["AAA", "BBB"]
    assert len(result["pairs"]) == 1
