import datetime
from unittest.mock import patch

import app.services.tefas as tefas_module
from app.services.tefas import tefas_order_cutoff_info, _TR_TZ


def _run_at(dt: datetime.datetime) -> dict:
    class FakeDatetime(datetime.datetime):
        @classmethod
        def now(cls, tz=None):
            return dt

    with patch.object(tefas_module.datetime, "datetime", FakeDatetime):
        return tefas_order_cutoff_info()


def test_before_cutoff_on_weekday_is_same_day():
    # Pazartesi 10:00 - kesme saatinden 3.5 saat once
    result = _run_at(datetime.datetime(2026, 8, 24, 10, 0, tzinfo=_TR_TZ))
    assert result == {"cutoff_time": "13:30", "same_day": True, "minutes_remaining": 210}


def test_exactly_at_cutoff_is_still_same_day():
    result = _run_at(datetime.datetime(2026, 8, 24, 13, 30, tzinfo=_TR_TZ))
    assert result["same_day"] is True
    assert result["minutes_remaining"] == 0


def test_one_minute_after_cutoff_is_next_day():
    result = _run_at(datetime.datetime(2026, 8, 24, 13, 31, tzinfo=_TR_TZ))
    assert result["same_day"] is False
    assert result["minutes_remaining"] == 0


def test_evening_on_weekday_is_next_day():
    result = _run_at(datetime.datetime(2026, 8, 24, 20, 0, tzinfo=_TR_TZ))
    assert result["same_day"] is False


def test_saturday_is_never_same_day():
    result = _run_at(datetime.datetime(2026, 8, 22, 10, 0, tzinfo=_TR_TZ))
    assert result["same_day"] is False


def test_sunday_is_never_same_day():
    result = _run_at(datetime.datetime(2026, 8, 23, 10, 0, tzinfo=_TR_TZ))
    assert result["same_day"] is False


def test_cutoff_time_field_is_always_1330():
    for dt in (
        datetime.datetime(2026, 8, 24, 6, 0, tzinfo=_TR_TZ),
        datetime.datetime(2026, 8, 22, 6, 0, tzinfo=_TR_TZ),
    ):
        assert _run_at(dt)["cutoff_time"] == "13:30"
