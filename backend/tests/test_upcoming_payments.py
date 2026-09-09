# -*- coding: utf-8 -*-
"""Kullanıcının kendi eklediği yaklaşan ödeme kayıtları.

En önemli kontrol IDOR: kayıt id'si tahmin edilebilir bir tamsayı, bu yüzden
silme/listeleme mutlaka kullanıcıya bağlı olmalı - aksi hâlde bir kullanıcı
başkasının kaydını silebilirdi.
"""
import datetime as dt

import pytest


def _auth(client, email):
    # Alan adi terms_accepted - tests/test_note.py'deki mevcut desenle ayni.
    client.post("/api/v1/auth/register", json={
        "email": email, "password": "mypassword", "terms_accepted": True,
    })
    r = client.post("/api/v1/auth/login", data={"username": email, "password": "mypassword"})
    assert r.status_code == 200, r.text
    return {"Authorization": f"Bearer {r.json()['access_token']}"}


def test_create_list_delete_roundtrip(client):
    h = _auth(client, "up1@test.com")
    due = (dt.date.today() + dt.timedelta(days=5)).isoformat()

    r = client.post("/api/v1/portfolio/upcoming-payments",
                    json={"title": "THYAO temettü", "due_date": due, "ticker": "thyao", "amount_try": 1250.5},
                    headers=h)
    assert r.status_code == 201, r.text
    created = r.json()
    assert created["ticker"] == "THYAO"          # buyuk harfe cevriliyor
    assert created["amount_try"] == 1250.5

    rows = client.get("/api/v1/portfolio/upcoming-payments", headers=h).json()
    assert [x["id"] for x in rows] == [created["id"]]

    assert client.delete(f"/api/v1/portfolio/upcoming-payments/{created['id']}", headers=h).status_code == 204
    assert client.get("/api/v1/portfolio/upcoming-payments", headers=h).json() == []


def test_sorted_by_due_date_and_past_kept(client):
    """Geçmiş tarihliler LISTEDE KALMALI - hatırlatıcı bir panelde kaçırılmış
    bir ödemeyi sessizce yok saymak tam olarak yanlış davranış olurdu."""
    h = _auth(client, "up2@test.com")
    past = (dt.date.today() - dt.timedelta(days=3)).isoformat()
    soon = (dt.date.today() + dt.timedelta(days=1)).isoformat()
    later = (dt.date.today() + dt.timedelta(days=30)).isoformat()

    for t, d in [("gec", later), ("dun", past), ("yarin", soon)]:
        client.post("/api/v1/portfolio/upcoming-payments", json={"title": t, "due_date": d}, headers=h)

    rows = client.get("/api/v1/portfolio/upcoming-payments", headers=h).json()
    assert [x["title"] for x in rows] == ["dun", "yarin", "gec"]


def test_user_cannot_delete_another_users_payment(client):
    """IDOR koruması."""
    h1 = _auth(client, "up3@test.com")
    h2 = _auth(client, "up4@test.com")
    due = (dt.date.today() + dt.timedelta(days=2)).isoformat()

    created = client.post("/api/v1/portfolio/upcoming-payments",
                          json={"title": "gizli", "due_date": due}, headers=h1).json()

    assert client.delete(f"/api/v1/portfolio/upcoming-payments/{created['id']}", headers=h2).status_code == 404
    # Sahibinde hala duruyor
    assert len(client.get("/api/v1/portfolio/upcoming-payments", headers=h1).json()) == 1


def test_other_users_records_are_not_listed(client):
    h1 = _auth(client, "up5@test.com")
    h2 = _auth(client, "up6@test.com")
    due = (dt.date.today() + dt.timedelta(days=2)).isoformat()
    client.post("/api/v1/portfolio/upcoming-payments", json={"title": "benim", "due_date": due}, headers=h1)
    assert client.get("/api/v1/portfolio/upcoming-payments", headers=h2).json() == []


def test_validation(client):
    h = _auth(client, "up7@test.com")
    due = (dt.date.today() + dt.timedelta(days=2)).isoformat()
    assert client.post("/api/v1/portfolio/upcoming-payments",
                       json={"title": "   ", "due_date": due}, headers=h).status_code == 400
    assert client.post("/api/v1/portfolio/upcoming-payments",
                       json={"title": "x", "due_date": due, "amount_try": -5}, headers=h).status_code == 400


def test_requires_auth(client):
    assert client.get("/api/v1/portfolio/upcoming-payments").status_code == 401
