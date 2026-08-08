import datetime

import pytest

from app.models.portfolio import PortfolioSnapshot


@pytest.fixture(scope="function")
def auth_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "historyuser@example.com", "password": "mypassword", "terms_accepted": True}
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "historyuser@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def test_history_empty_when_no_snapshots_yet(client, auth_headers):
    response = client.get("/api/v1/portfolio/history", headers=auth_headers)
    assert response.status_code == 200
    assert response.json() == {"history": []}


def test_history_returns_snapshots_sorted_by_date(client, db, auth_headers):
    me = client.get("/api/v1/auth/me", headers=auth_headers).json()
    user_id = me["id"]

    # Inserted out of order on purpose - the endpoint must sort ascending
    # by date regardless of insertion order (PortfolioSnapshotService
    # writes one row per day, not necessarily in date order across runs).
    db.add(PortfolioSnapshot(user_id=user_id, snapshot_date=datetime.date(2026, 7, 20), total_value=1000.0))
    db.add(PortfolioSnapshot(user_id=user_id, snapshot_date=datetime.date(2026, 7, 18), total_value=900.0))
    db.commit()

    response = client.get("/api/v1/portfolio/history", headers=auth_headers)
    assert response.status_code == 200
    history = response.json()["history"]
    assert history == [
        {"date": "2026-07-18", "total_value": 900.0},
        {"date": "2026-07-20", "total_value": 1000.0},
    ]
