from datetime import date, timedelta
from unittest.mock import patch


def _register_and_login(client, email="indexchangesuser@example.com", password="mypassword"):
    with patch("app.api.v1.endpoints.auth.send_email"):
        client.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "terms_accepted": True},
        )
    login = client.post("/api/v1/auth/login", data={"username": email, "password": password})
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_index_changes_requires_auth(client):
    res = client.get("/api/v1/screener/index-changes")
    assert res.status_code == 401


def test_index_changes_returns_events(client, db):
    from app.models.index_membership import IndexChangeEvent
    recent_date = date.today() - timedelta(days=2)
    db.add(IndexChangeEvent(index_code="XU030", ticker="ASELS", change_type="ADDED", detected_date=recent_date))
    db.commit()

    headers = _register_and_login(client)
    res = client.get("/api/v1/screener/index-changes", headers=headers)

    assert res.status_code == 200
    events = res.json()["events"]
    assert len(events) == 1
    assert events[0]["ticker"] == "ASELS"
    assert events[0]["change_type"] == "ADDED"
    assert events[0]["index_code"] == "XU030"
    assert events[0]["detected_date"] == recent_date.isoformat()


def test_index_changes_empty_when_none(client, db):
    headers = _register_and_login(client, "indexchangesempty@example.com")
    res = client.get("/api/v1/screener/index-changes", headers=headers)
    assert res.status_code == 200
    assert res.json()["events"] == []
