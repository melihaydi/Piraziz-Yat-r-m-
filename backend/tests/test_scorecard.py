from datetime import datetime, timedelta, timezone

from app.models.strategy_signal import StrategySignal


def _add_signal(db, **kwargs):
    defaults = dict(
        ticker="THYAO", direction="LONG", entry_price=300.0, stop_price=290.0,
        target_price=320.0, confidence="Yüksek",
        fired_at=datetime.now(timezone.utc) - timedelta(days=5),
    )
    defaults.update(kwargs)
    db.add(StrategySignal(**defaults))
    db.commit()


def test_scorecard_requires_no_auth(client, db):
    response = client.get("/api/v1/scorecard/")
    assert response.status_code == 200


def test_scorecard_empty_state(client, db):
    response = client.get("/api/v1/scorecard/")
    data = response.json()
    assert data["total_signals"] == 0
    assert data["win_rate"] is None
    assert data["best"] is None
    assert data["worst"] is None


def test_scorecard_computes_win_rate_and_averages(client, db):
    _add_signal(db, ticker="THYAO", outcome="WIN", return_pct=8.0, resolved_at=datetime.now(timezone.utc))
    _add_signal(db, ticker="GARAN", outcome="WIN", return_pct=4.0, resolved_at=datetime.now(timezone.utc))
    _add_signal(db, ticker="AKBNK", outcome="LOSS", return_pct=-3.0, resolved_at=datetime.now(timezone.utc))

    response = client.get("/api/v1/scorecard/")
    data = response.json()

    assert data["total_signals"] == 3
    # 2 win / 3 kapanmış = %66.67
    assert data["win_rate"] == 66.67
    assert data["avg_win_pct"] == 6.0
    assert data["avg_loss_pct"] == -3.0
    assert data["best"]["ticker"] == "THYAO"
    assert data["worst"]["ticker"] == "AKBNK"


def test_scorecard_excludes_open_signals_from_stats_but_counts_them(client, db):
    _add_signal(db, ticker="THYAO", outcome="WIN", return_pct=5.0, resolved_at=datetime.now(timezone.utc))
    _add_signal(db, ticker="GARAN", outcome=None, return_pct=None, resolved_at=None)

    response = client.get("/api/v1/scorecard/")
    data = response.json()

    assert data["total_signals"] == 1
    assert data["open_signals_count"] == 1


def test_scorecard_excludes_signals_outside_lookback_window(client, db):
    _add_signal(
        db, ticker="ESKI", outcome="WIN", return_pct=10.0,
        fired_at=datetime.now(timezone.utc) - timedelta(days=200),
        resolved_at=datetime.now(timezone.utc) - timedelta(days=195),
    )

    response = client.get("/api/v1/scorecard/")
    data = response.json()

    assert data["total_signals"] == 0


def test_scorecard_expired_counted_in_win_rate_denominator_but_not_averages(client, db):
    _add_signal(db, ticker="THYAO", outcome="WIN", return_pct=5.0, resolved_at=datetime.now(timezone.utc))
    _add_signal(db, ticker="GARAN", outcome="EXPIRED", return_pct=0.5, resolved_at=datetime.now(timezone.utc))

    response = client.get("/api/v1/scorecard/")
    data = response.json()

    assert data["total_signals"] == 2
    # EXPIRED win_rate paydasında (win+loss) sayılmıyor - burada loss yok,
    # win=1 -> win_rate 1/1 = %100
    assert data["win_rate"] == 100.0
    assert data["avg_win_pct"] == 5.0
    assert data["avg_loss_pct"] is None
