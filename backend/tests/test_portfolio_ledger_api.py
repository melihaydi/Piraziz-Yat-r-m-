"""Hareket defteri endpoint'leri: satışta gerçekleşen K/Z, işlem geçmişi,
temettü kaydı ve gerçekleşen performans özeti."""
import pytest


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "ledgeruser@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login = client.post(
        "/api/v1/auth/login",
        data={"username": "ledgeruser@example.com", "password": "mypassword"},
    )
    return {"Authorization": f"Bearer {login.json()['access_token']}"}


@pytest.fixture(scope="function")
def portfolio_id(client, auth_headers):
    return client.post(
        "/api/v1/portfolio/", json={"name": "Ana Portföyüm"}, headers=auth_headers
    ).json()["id"]


def _add(client, headers, pid, ticker="THYAO", shares=10.0, cost=300.0):
    return client.post(
        f"/api/v1/portfolio/{pid}/assets",
        json={"ticker": ticker, "shares": shares, "average_cost": cost},
        headers=headers,
    )


def test_buy_appears_in_transaction_history(client, auth_headers, portfolio_id):
    _add(client, auth_headers, portfolio_id)

    res = client.get("/api/v1/portfolio/transactions", headers=auth_headers)
    assert res.status_code == 200
    rows = res.json()
    assert len(rows) == 1
    assert rows[0]["transaction_type"] == "BUY"
    assert rows[0]["ticker"] == "THYAO"


def test_sell_records_realized_pnl_at_given_price(client, auth_headers, portfolio_id):
    asset = _add(client, auth_headers, portfolio_id, shares=10, cost=300.0).json()

    res = client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 4, "price": 350.0},
        headers=auth_headers,
    )
    assert res.status_code == 200

    rows = client.get(
        "/api/v1/portfolio/transactions", headers=auth_headers
    ).json()
    sell = [r for r in rows if r["transaction_type"] == "SELL"][0]
    assert sell["realized_pnl"] == pytest.approx(200.0)
    assert sell["price"] == 350.0


def test_full_sell_keeps_history_after_position_is_gone(client, auth_headers, portfolio_id):
    asset = _add(client, auth_headers, portfolio_id, shares=10, cost=300.0).json()

    res = client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 10, "price": 400.0},
        headers=auth_headers,
    )
    assert res.status_code == 200

    portfolios = client.get("/api/v1/portfolio/", headers=auth_headers).json()
    assert portfolios[0]["assets"] == []

    rows = client.get("/api/v1/portfolio/transactions", headers=auth_headers).json()
    assert {r["transaction_type"] for r in rows} == {"BUY", "SELL"}


def test_sell_more_than_held_is_rejected(client, auth_headers, portfolio_id):
    asset = _add(client, auth_headers, portfolio_id, shares=5, cost=100.0).json()
    res = client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 50, "price": 100.0},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_dividend_endpoint_defaults_shares_to_position(client, auth_headers, portfolio_id):
    _add(client, auth_headers, portfolio_id, shares=100, cost=300.0)

    res = client.post(
        f"/api/v1/portfolio/{portfolio_id}/dividends",
        json={"ticker": "THYAO", "per_share": 2.5},
        headers=auth_headers,
    )
    assert res.status_code == 201
    body = res.json()
    assert body["shares"] == 100
    assert body["amount"] == pytest.approx(250.0)


def test_dividend_for_unheld_ticker_without_shares_is_rejected(client, auth_headers, portfolio_id):
    res = client.post(
        f"/api/v1/portfolio/{portfolio_id}/dividends",
        json={"ticker": "EREGL", "per_share": 1.0},
        headers=auth_headers,
    )
    assert res.status_code == 400


def test_realized_summary_combines_sales_and_dividends(client, auth_headers, portfolio_id):
    asset = _add(client, auth_headers, portfolio_id, shares=10, cost=300.0).json()
    client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 5, "price": 400.0},
        headers=auth_headers,
    )
    client.post(
        f"/api/v1/portfolio/{portfolio_id}/dividends",
        json={"ticker": "THYAO", "shares": 10, "per_share": 3.0},
        headers=auth_headers,
    )

    res = client.get("/api/v1/portfolio/realized", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["realized_pnl"] == pytest.approx(500.0)   # (400-300)*5
    assert body["dividend_income"] == pytest.approx(30.0)  # 10 * 3
    assert body["total_realized"] == pytest.approx(530.0)
    assert body["by_ticker"][0]["ticker"] == "THYAO"


def test_transactions_can_be_filtered_by_ticker(client, auth_headers, portfolio_id):
    _add(client, auth_headers, portfolio_id, ticker="THYAO")
    _add(client, auth_headers, portfolio_id, ticker="EREGL")

    rows = client.get(
        "/api/v1/portfolio/transactions?ticker=eregl", headers=auth_headers
    ).json()
    assert len(rows) == 1
    assert rows[0]["ticker"] == "EREGL"


def test_transactions_are_scoped_to_the_owner(client, auth_headers, portfolio_id):
    """Başka bir kullanıcı bu portföyün geçmişini görememeli."""
    _add(client, auth_headers, portfolio_id)

    client.post(
        "/api/v1/auth/register",
        json={"email": "other@example.com", "password": "mypassword", "terms_accepted": True},
    )
    other = client.post(
        "/api/v1/auth/login",
        data={"username": "other@example.com", "password": "mypassword"},
    ).json()["access_token"]

    rows = client.get(
        "/api/v1/portfolio/transactions",
        headers={"Authorization": f"Bearer {other}"},
    ).json()
    assert rows == []


def test_annual_summary_reports_both_cost_methods(client, auth_headers, portfolio_id):
    """İki lot farklı fiyattan alınıp biri satılınca ortalama maliyet ve
    FIFO farklı kâr verir - rapor ikisini de göstermeli."""
    _add(client, auth_headers, portfolio_id, shares=10, cost=100.0)
    asset = _add(client, auth_headers, portfolio_id, shares=10, cost=200.0).json()

    client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 10, "price": 250.0},
        headers=auth_headers,
    )

    res = client.get("/api/v1/portfolio/annual-summary", headers=auth_headers)
    assert res.status_code == 200
    body = res.json()
    # Ortalama maliyet 150 -> (250-150)*10
    assert body["average_cost"]["realized_pnl"] == pytest.approx(1000.0)
    # FIFO ilk lotu (100) tüketir -> (250-100)*10
    assert body["fifo"]["realized_pnl"] == pytest.approx(1500.0)
    assert body["sell_count"] == 1


def test_annual_summary_filters_by_year(client, auth_headers, portfolio_id):
    asset = _add(client, auth_headers, portfolio_id, shares=10, cost=100.0).json()
    client.post(
        f"/api/v1/portfolio/assets/{asset['id']}/sell",
        json={"shares": 5, "price": 150.0},
        headers=auth_headers,
    )

    current = client.get("/api/v1/portfolio/annual-summary", headers=auth_headers).json()
    assert current["sell_count"] == 1

    old = client.get("/api/v1/portfolio/annual-summary?year=2020", headers=auth_headers).json()
    assert old["sell_count"] == 0
    assert old["average_cost"]["realized_pnl"] == 0.0


def test_annual_summary_includes_dividends(client, auth_headers, portfolio_id):
    _add(client, auth_headers, portfolio_id, shares=100, cost=10.0)
    client.post(
        f"/api/v1/portfolio/{portfolio_id}/dividends",
        json={"ticker": "THYAO", "per_share": 1.5},
        headers=auth_headers,
    )
    body = client.get("/api/v1/portfolio/annual-summary", headers=auth_headers).json()
    assert body["dividend_income"] == pytest.approx(150.0)
    assert body["dividend_count"] == 1
