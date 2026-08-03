from unittest.mock import patch, MagicMock

import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post("/api/v1/auth/register", json={"email": "alertcheck@example.com", "password": "mypassword"})
    login = client.post(
        "/api/v1/auth/login", data={"username": "alertcheck@example.com", "password": "mypassword"}
    )
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _candles_with_volume(*volumes):
    return [{"time": i, "open": 10, "high": 10, "low": 10, "close": 10, "volume": v} for i, v in enumerate(volumes)]


def test_volume_spike_alert_triggers_when_above_threshold(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "volume_spike", "trigger_condition": {"value": 2.0}},
        headers=auth_headers,
    )
    baseline = [1_000_000] * 20
    candles = _candles_with_volume(*baseline, 3_000_000)  # today = 3x the 1M average

    with patch("app.services.market_data.market_data_service.get_quote", return_value={"last": 41.0}), \
         patch("app.services.market_data.market_data_service.get_candles", return_value=candles):
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.status_code == 200
    triggered = result.json()
    assert len(triggered) == 1
    assert "3.0x" in triggered[0]["trigger_condition"]["current_val_desc"]


def test_volume_spike_alert_does_not_trigger_below_threshold(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "EREGL", "alert_type": "volume_spike", "trigger_condition": {"value": 2.0}},
        headers=auth_headers,
    )
    baseline = [1_000_000] * 20
    candles = _candles_with_volume(*baseline, 1_200_000)  # today = 1.2x, below the 2x threshold

    with patch("app.services.market_data.market_data_service.get_quote", return_value={"last": 41.0}), \
         patch("app.services.market_data.market_data_service.get_candles", return_value=candles):
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.json() == []


def test_strategy_signal_alert_triggers_on_matching_direction(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "THYAO", "alert_type": "strategy_signal", "trigger_condition": {"direction": "LONG"}},
        headers=auth_headers,
    )
    fake_signal = MagicMock(ticker="THYAO", direction="LONG", confidence="Yüksek")

    with patch("app.services.strategy_engine.strategy_engine.get_signals", return_value=[fake_signal]):
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.status_code == 200
    triggered = result.json()
    assert len(triggered) == 1
    assert "LONG" in triggered[0]["trigger_condition"]["current_val_desc"]


def test_strategy_signal_alert_does_not_trigger_on_mismatched_direction(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "THYAO", "alert_type": "strategy_signal", "trigger_condition": {"direction": "SHORT"}},
        headers=auth_headers,
    )
    fake_signal = MagicMock(ticker="THYAO", direction="LONG", confidence="Yüksek")

    with patch("app.services.strategy_engine.strategy_engine.get_signals", return_value=[fake_signal]):
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert result.json() == []


def test_strategy_signal_alert_any_direction_matches_long_or_short(client, auth_headers):
    client.post(
        "/api/v1/alert/",
        json={"ticker": "THYAO", "alert_type": "strategy_signal", "trigger_condition": {"direction": "ANY"}},
        headers=auth_headers,
    )
    fake_signal = MagicMock(ticker="THYAO", direction="SHORT", confidence="Orta")

    with patch("app.services.strategy_engine.strategy_engine.get_signals", return_value=[fake_signal]):
        result = client.post("/api/v1/alert/check", headers=auth_headers)

    assert len(result.json()) == 1
