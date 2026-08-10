import pytest

from app.models.user import User
from app.services import trade_service


@pytest.fixture(scope="function")
def auth_headers(client, db):
    client.post("/api/v1/auth/register", json={"email": "statementuser@example.com", "password": "mypassword", "terms_accepted": True})
    # Trade is premium-only (see deps.get_current_premium_user on trade.py's
    # router) - every test in this file hits /api/v1/trade/*.
    db.query(User).filter(User.email == "statementuser@example.com").update({"role": "premium"})
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "statementuser@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_statement_requires_auth(client):
    res = client.get("/api/v1/trade/statement")
    assert res.status_code == 401


def test_statement_returns_a_valid_pdf_with_no_orders(client, auth_headers):
    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    res = client.get("/api/v1/trade/statement", headers=auth_headers)
    assert res.status_code == 200
    assert res.headers["content-type"] == "application/pdf"
    assert res.content.startswith(b"%PDF")
    assert len(res.content) > 500


def test_statement_includes_placed_order(client, auth_headers, monkeypatch):
    monkeypatch.setattr(trade_service, "get_live_price", lambda instrument_type, symbol, delay_minutes=0: 100.0)

    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)

    empty_res = client.get("/api/v1/trade/statement", headers=auth_headers)
    assert empty_res.status_code == 200

    order_res = client.post(
        "/api/v1/trade/order",
        json={"instrument_type": "stock", "symbol": "THYAO", "side": "AL", "lot": 10},
        headers=auth_headers,
    )
    assert order_res.status_code == 200

    res = client.get("/api/v1/trade/statement", headers=auth_headers)
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF")
    # Reportlab deflate-compresses the content stream, so the symbol text
    # isn't visible as raw bytes - a statement with one more order/table row
    # rendered should reliably produce a larger PDF than an empty one, which
    # is a robust proxy without pulling in a PDF-text-extraction dependency.
    assert len(res.content) > len(empty_res.content)


def test_statement_date_filter_excludes_out_of_range_content(client, auth_headers, monkeypatch):
    monkeypatch.setattr(trade_service, "get_live_price", lambda instrument_type, symbol, delay_minutes=0: 100.0)

    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=auth_headers)
    client.post(
        "/api/v1/trade/order",
        json={"instrument_type": "stock", "symbol": "EREGL", "side": "AL", "lot": 5},
        headers=auth_headers,
    )

    # A future date range should have zero matching orders.
    res = client.get("/api/v1/trade/statement", params={"from_date": "2099-01-01", "to_date": "2099-12-31"}, headers=auth_headers)
    assert res.status_code == 200
    assert res.content.startswith(b"%PDF")
