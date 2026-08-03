from datetime import datetime, timedelta

from app.services.news import format_date_tr


def test_format_date_tr_today():
    dt = datetime.now().replace(hour=14, minute=30, second=0, microsecond=0)
    assert format_date_tr(dt) == f"Bugün, {dt.strftime('%H:%M')}"


def test_format_date_tr_yesterday():
    dt = (datetime.now() - timedelta(days=1)).replace(hour=9, minute=5, second=0, microsecond=0)
    assert format_date_tr(dt) == f"Dün, {dt.strftime('%H:%M')}"


def test_format_date_tr_older_date_uses_turkish_month_name():
    dt = datetime(2026, 3, 5, 11, 0, 0)
    result = format_date_tr(dt)
    assert result == "5 Mart 2026, 11:00"
