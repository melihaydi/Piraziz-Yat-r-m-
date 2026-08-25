import datetime
from unittest.mock import MagicMock

import pandas as pd
import pytest

import app.services.inflation as inflation_module
from app.services import inflation


@pytest.fixture(autouse=True)
def no_redis(monkeypatch):
    # cache_service zaten Redis'e erişilemezse zarif düşüyor (None/False),
    # ama testlerde bir çalıştırmanın cache'lediği değeri sonraki testin
    # görmesini istemiyoruz - her testi taze başlatır.
    monkeypatch.setattr(inflation.cache_service, "get_json", lambda key: None)
    monkeypatch.setattr(inflation.cache_service, "set_json", lambda *a, **k: True)


@pytest.fixture
def latest_month_fixed(monkeypatch):
    # cumulative_tufe_pct her çağrıda önce "en son yayınlanmış ay"ı sorup
    # end_date'i ona clamp ediyor (bkz. _latest_available_year_month'un
    # docstring'i - TÜİK'in henüz veri yayınlamadığı bir ay istenince TCMB
    # 500 döndürüyor, confirmed live). Bu clamp'i test eden ikisi hariç,
    # aşağıdaki testlerin çoğu bu fixture'ı isteyerek clamp'i sabit, yüksek
    # bir ayla devre dışı bırakır.
    monkeypatch.setattr(inflation, "_latest_available_year_month", lambda: "2099-12")


def test_cumulative_tufe_pct_uses_tcmb_total_change(monkeypatch, latest_month_fixed):
    fake_inflation = MagicMock()
    fake_inflation.calculate.return_value = {"total_change": 112.28}
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    result = inflation.cumulative_tufe_pct(datetime.date(2024, 1, 15), datetime.date(2026, 7, 20))

    assert result == 112.28
    fake_inflation.calculate.assert_called_once_with(100000, "2024-01", "2026-07")


def test_cumulative_tufe_pct_same_month_returns_none_without_calling_tcmb(monkeypatch, latest_month_fixed):
    fake_inflation = MagicMock()
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    result = inflation.cumulative_tufe_pct(datetime.date(2026, 7, 1), datetime.date(2026, 7, 20))

    assert result is None
    fake_inflation.calculate.assert_not_called()


def test_cumulative_tufe_pct_returns_none_on_tcmb_error(monkeypatch, latest_month_fixed):
    fake_inflation = MagicMock()
    fake_inflation.calculate.side_effect = RuntimeError("network down")
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    result = inflation.cumulative_tufe_pct(datetime.date(2024, 1, 1), datetime.date(2024, 3, 1))

    assert result is None


def test_cumulative_tufe_pct_clamps_end_date_to_latest_published_month(monkeypatch):
    # Confirmed live (2026-08-25): TCMB henüz yayınlanmamış "2026-08" için
    # 500 Internal Server Error veriyor - en son yayınlanan ay Temmuz 2026.
    # end_date bugünü (Ağustos) verse bile, gerçekte istenen ay Temmuz olmalı.
    monkeypatch.setattr(inflation, "_latest_available_year_month", lambda: "2026-07")
    fake_inflation = MagicMock()
    fake_inflation.calculate.return_value = {"total_change": 112.28}
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    result = inflation.cumulative_tufe_pct(datetime.date(2024, 1, 15), datetime.date(2026, 8, 25))

    assert result == 112.28
    fake_inflation.calculate.assert_called_once_with(100000, "2024-01", "2026-07")


def test_latest_available_year_month_parses_tcmb_date(monkeypatch):
    fake_inflation = MagicMock()
    fake_inflation.latest.return_value = {"date": "2026-07-01", "yearly_inflation": 31.75}
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    result = inflation._latest_available_year_month()

    assert result == "2026-07"


def test_latest_available_year_month_none_on_error(monkeypatch):
    fake_inflation = MagicMock()
    fake_inflation.latest.side_effect = RuntimeError("network down")
    monkeypatch.setattr(inflation_module.borsapy, "Inflation", lambda: fake_inflation)

    assert inflation._latest_available_year_month() is None


def test_real_return_summary_deflates_nominal_by_tufe(monkeypatch):
    # %150 nominal, %112.28 TÜFE -> (2.5/2.1228 - 1)*100 ~= 17.77
    monkeypatch.setattr(inflation, "cumulative_tufe_pct", lambda start, end: 112.28)

    result = inflation.real_return_summary(150.0, datetime.date(2024, 1, 15), datetime.date(2026, 7, 20))

    assert result == {"nominal_pct": 150.0, "real_pct": 17.77, "tufe_pct": 112.28}


def test_real_return_summary_negative_when_nominal_below_inflation(monkeypatch):
    monkeypatch.setattr(inflation, "cumulative_tufe_pct", lambda start, end: 112.28)

    result = inflation.real_return_summary(50.0, datetime.date(2024, 1, 15), datetime.date(2026, 7, 20))

    assert result["real_pct"] < 0


def test_real_return_summary_none_when_tufe_unavailable(monkeypatch):
    monkeypatch.setattr(inflation, "cumulative_tufe_pct", lambda start, end: None)

    result = inflation.real_return_summary(10.0, datetime.date(2024, 1, 1), datetime.date(2024, 6, 1))

    assert result is None


def test_deposit_alt_return_pct_scales_with_days():
    start = datetime.date(2024, 1, 1)
    end = datetime.date(2025, 1, 1)  # 366 gün (2024 artık yıl)

    result = inflation.deposit_alt_return_pct(start, end)

    assert result == pytest.approx(inflation.DEPOSIT_ANNUAL_RATE_PCT * 366 / 365, abs=0.01)


def test_alt_asset_return_pct_computes_pct_change(monkeypatch):
    fake_fx = MagicMock()
    fake_fx.history.return_value = pd.DataFrame({"Close": [30.10, 48.08]})
    monkeypatch.setattr(inflation_module.borsapy, "FX", lambda asset: fake_fx)

    result = inflation.alt_asset_return_pct("USD", datetime.date(2024, 1, 15))

    assert result == pytest.approx((48.08 / 30.10 - 1) * 100, abs=0.01)
    fake_fx.history.assert_called_once_with(start="2024-01-15")


def test_alt_asset_return_pct_none_on_empty_history(monkeypatch):
    fake_fx = MagicMock()
    fake_fx.history.return_value = pd.DataFrame()
    monkeypatch.setattr(inflation_module.borsapy, "FX", lambda asset: fake_fx)

    result = inflation.alt_asset_return_pct("USD", datetime.date(2024, 1, 15))

    assert result is None


def test_alt_asset_return_pct_none_on_exception(monkeypatch):
    fake_fx = MagicMock()
    fake_fx.history.side_effect = RuntimeError("network down")
    monkeypatch.setattr(inflation_module.borsapy, "FX", lambda asset: fake_fx)

    result = inflation.alt_asset_return_pct("gram-altin", datetime.date(2024, 1, 15))

    assert result is None
