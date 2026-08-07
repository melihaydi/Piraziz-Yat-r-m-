from datetime import datetime
from unittest.mock import patch
from zoneinfo import ZoneInfo

from app.services.market_data import _is_bist_session_open, _BIST_TZ


def _at(year, month, day, hour, minute):
    return datetime(year, month, day, hour, minute, tzinfo=_BIST_TZ)


def test_open_during_regular_session():
    # Wednesday, 2026-08-05, 12:00 - well within 09:30-18:15
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 5, 12, 0)
        assert _is_bist_session_open() is True


def test_closed_before_open():
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 5, 9, 0)
        assert _is_bist_session_open() is False


def test_closed_after_close():
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 5, 18, 30)
        assert _is_bist_session_open() is False


def test_closed_on_weekend():
    # Saturday
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 8, 12, 0)
        assert _is_bist_session_open() is False


def test_open_at_exact_boundaries():
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 5, 9, 30)
        assert _is_bist_session_open() is True
    with patch("app.services.market_data.datetime") as mock_dt:
        mock_dt.now.return_value = _at(2026, 8, 5, 18, 15)
        assert _is_bist_session_open() is True
