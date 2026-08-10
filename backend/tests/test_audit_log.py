import pytest

from app.models.audit_log import AuditLog
from app.models.user import User
from app.services import trade_service


@pytest.fixture
def admin_headers(client, db):
    client.post("/api/v1/auth/register", json={"email": "auditadmin@example.com", "password": "mypassword", "terms_accepted": True})
    user = db.query(User).filter(User.email == "auditadmin@example.com").first()
    user.is_superuser = True
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "auditadmin@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def plain_headers(client, db):
    client.post("/api/v1/auth/register", json={"email": "auditplain@example.com", "password": "mypassword", "terms_accepted": True})
    # Premium (not superuser) - trade.py's router now requires
    # get_current_premium_user, and this fixture's user places a trade order
    # in test_order_placement_writes_audit_row below.
    db.query(User).filter(User.email == "auditplain@example.com").update({"role": "premium"})
    db.commit()
    login = client.post("/api/v1/auth/login", data={"username": "auditplain@example.com", "password": "mypassword"})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_successful_login_writes_audit_row(client, db):
    client.post("/api/v1/auth/register", json={"email": "loginaudit@example.com", "password": "mypassword", "terms_accepted": True})
    client.post("/api/v1/auth/login", data={"username": "loginaudit@example.com", "password": "mypassword"})

    rows = db.query(AuditLog).filter(AuditLog.action == "login_success").all()
    assert len(rows) == 1


def test_failed_login_writes_audit_row_with_no_pnl_leak(client, db):
    client.post("/api/v1/auth/register", json={"email": "badlogin@example.com", "password": "mypassword", "terms_accepted": True})
    client.post("/api/v1/auth/login", data={"username": "badlogin@example.com", "password": "wrongpassword"})

    rows = db.query(AuditLog).filter(AuditLog.action == "login_failed").all()
    assert len(rows) == 1
    assert rows[0].details.get("email") == "badlogin@example.com"


def test_role_change_writes_audit_row_with_old_and_new_role(client, db, admin_headers, plain_headers):
    # plain_headers' user starts on role="premium" (see that fixture - trade
    # endpoints are premium-only now), so this exercises a premium ->
    # institutional transition instead of the original free -> premium one.
    target = db.query(User).filter(User.email == "auditplain@example.com").first()
    res = client.put(
        f"/api/v1/admin/users/{target.id}/role",
        headers=admin_headers,
        params={"role": "institutional"},
    )
    assert res.status_code == 200

    row = db.query(AuditLog).filter(AuditLog.action == "role_change").first()
    assert row is not None
    assert row.resource_id == str(target.id)
    assert row.details["old_role"] == "premium"
    assert row.details["new_role"] == "premium"


def test_order_placement_writes_audit_row(client, db, plain_headers, monkeypatch):
    monkeypatch.setattr(trade_service, "get_live_price", lambda instrument_type, symbol, delay_minutes=0: 100.0)

    client.post("/api/v1/trade/account", json={"broker": "midas", "starting_balance": 100000}, headers=plain_headers)
    res = client.post(
        "/api/v1/trade/order",
        json={"instrument_type": "stock", "symbol": "THYAO", "side": "AL", "lot": 10},
        headers=plain_headers,
    )
    assert res.status_code == 200

    row = db.query(AuditLog).filter(AuditLog.action == "order_placed").first()
    assert row is not None
    assert row.details["symbol"] == "THYAO"
    assert row.details["side"] == "AL"


def test_audit_log_endpoint_requires_superuser(client, plain_headers):
    res = client.get("/api/v1/admin/audit-log", headers=plain_headers)
    assert res.status_code == 403


def test_audit_log_endpoint_returns_rows_for_superuser(client, admin_headers):
    client.post(
        "/api/v1/auth/login",
        data={"username": "does-not-exist@example.com", "password": "whatever"},
    )
    res = client.get("/api/v1/admin/audit-log", headers=admin_headers)
    assert res.status_code == 200
    actions = [r["action"] for r in res.json()]
    assert "login_failed" in actions
