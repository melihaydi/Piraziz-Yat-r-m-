from unittest.mock import patch

import pytest

from app.models.user import User
from app.models.fund_composition_override import FundCompositionOverride
from app.services.tefas import tefas_service


class _NoCloseSession:
    """Wraps a real session but ignores .close() - refresh_composition_override
    (called synchronously inside the PUT/DELETE endpoints under test) opens
    its own SessionLocal() and closes it when done; here that's patched to
    reuse the test's shared `db` fixture session instead (see
    tests/test_fund_estimate_snapshot.py for the same SessionLocal-patching
    pattern), so closing it would break the rest of the test that still
    needs that session afterward."""
    def __init__(self, real):
        self._real = real

    def __getattr__(self, name):
        return getattr(self._real, name)

    def close(self):
        pass


@pytest.fixture
def admin_headers(client, db):
    client.post(
        "/api/v1/auth/register",
        json={"email": "fcadmin@example.com", "password": "mypassword", "terms_accepted": True},
    )
    user = db.query(User).filter(User.email == "fcadmin@example.com").first()
    user.is_superuser = True
    db.commit()
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "fcadmin@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture
def plain_headers(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "fcplain@example.com", "password": "mypassword", "terms_accepted": True},
    )
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "fcplain@example.com", "password": "mypassword"},
    )
    token = login_response.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


@pytest.fixture(autouse=True)
def _clear_override_cache():
    """The in-memory override cache on the shared tefas_service singleton
    persists across tests (it's a module-level object, same reasoning as
    the tefas_service itself) - reset it before/after each test so one
    test's PUT doesn't leak into another's assertions."""
    tefas_service._composition_overrides.clear()
    yield
    tefas_service._composition_overrides.clear()


def test_non_superuser_cannot_list_fund_compositions(client, plain_headers):
    res = client.get("/api/v1/admin/fund-compositions", headers=plain_headers)
    assert res.status_code == 403


def test_superuser_can_list_fund_compositions(client, admin_headers):
    res = client.get("/api/v1/admin/fund-compositions", headers=admin_headers)
    assert res.status_code == 200
    codes = {f["fund_code"] for f in res.json()}
    assert "PBR" in codes
    assert "TMV" in codes


def test_get_fund_composition_without_override_reflects_default(client, admin_headers):
    res = client.get("/api/v1/admin/fund-compositions/TMV", headers=admin_headers)
    assert res.status_code == 200
    body = res.json()
    assert body["fund_code"] == "TMV"
    assert body["is_override"] is False
    assert len(body["assets_distribution"]) > 0


def test_unknown_fund_code_404s(client, admin_headers):
    res = client.get("/api/v1/admin/fund-compositions/NOPE", headers=admin_headers)
    assert res.status_code == 404


def test_non_superuser_cannot_save_fund_composition(client, plain_headers):
    res = client.put(
        "/api/v1/admin/fund-compositions/TMV",
        headers=plain_headers,
        json={"assets_distribution": [{"name": "THYAO", "value": 50.0}]},
    )
    assert res.status_code == 403


def test_save_fund_composition_rejects_empty_distribution(client, admin_headers):
    res = client.put(
        "/api/v1/admin/fund-compositions/TMV",
        headers=admin_headers,
        json={"assets_distribution": []},
    )
    assert res.status_code == 400


def test_save_fund_composition_rejects_negative_weight(client, admin_headers):
    res = client.put(
        "/api/v1/admin/fund-compositions/TMV",
        headers=admin_headers,
        json={"assets_distribution": [{"name": "THYAO", "value": -5.0}]},
    )
    assert res.status_code == 400


def test_admin_can_save_and_it_takes_effect_immediately(client, admin_headers, db):
    with patch("app.services.tefas.SessionLocal", return_value=_NoCloseSession(db)):
        res = client.put(
            "/api/v1/admin/fund-compositions/TMV",
            headers=admin_headers,
            json={
                "assets_distribution": [
                    {"name": "THYAO", "value": 60.0},
                    {"name": "AKBNK", "value": 40.0},
                ]
            },
        )
    assert res.status_code == 200
    body = res.json()
    assert body["is_override"] is True
    assert body["total_weight_pct"] == 100.0

    # Persisted in the DB.
    row = db.query(FundCompositionOverride).filter(FundCompositionOverride.fund_code == "TMV").first()
    assert row is not None
    assert len(row.assets_distribution) == 2

    # Takes effect immediately in the shared in-memory service, without a
    # restart - the whole point of refresh_composition_override().
    assert "TMV" in tefas_service._composition_overrides
    assert tefas_service._composition_overrides["TMV"]["assets_distribution"][0]["name"] == "THYAO"

    # A subsequent GET reflects the override too.
    get_res = client.get("/api/v1/admin/fund-compositions/TMV", headers=admin_headers)
    assert get_res.json()["is_override"] is True


def test_reset_fund_composition_reverts_to_default(client, admin_headers, db):
    with patch("app.services.tefas.SessionLocal", return_value=_NoCloseSession(db)):
        client.put(
            "/api/v1/admin/fund-compositions/TMV",
            headers=admin_headers,
            json={"assets_distribution": [{"name": "THYAO", "value": 100.0}]},
        )
        res = client.delete("/api/v1/admin/fund-compositions/TMV", headers=admin_headers)
    assert res.status_code == 200
    assert res.json()["is_override"] is False

    row = db.query(FundCompositionOverride).filter(FundCompositionOverride.fund_code == "TMV").first()
    assert row is None
    assert "TMV" not in tefas_service._composition_overrides


def test_reset_without_existing_override_404s(client, admin_headers):
    res = client.delete("/api/v1/admin/fund-compositions/TMV", headers=admin_headers)
    assert res.status_code == 404
