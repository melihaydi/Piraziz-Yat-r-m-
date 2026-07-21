import pytest

@pytest.fixture(scope="function")
def auth_headers_user(client):
    # Register user 1
    client.post(
        "/api/v1/auth/register",
        json={"email": "subuser@example.com", "password": "subpassword"}
    )
    # Login to get token
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "subuser@example.com", "password": "subpassword"}
    )
    res_data = login_response.json()
    token = res_data["access_token"]
    
    # Also fetch user ID
    me_resp = client.get("/api/v1/auth/me", headers={"Authorization": f"Bearer {token}"})
    user_id = me_resp.json()["id"]

    return {
        "headers": {"Authorization": f"Bearer {token}"},
        "user_id": user_id
    }

def test_subscription_workflow(client, auth_headers_user):
    headers = auth_headers_user["headers"]
    user_id = auth_headers_user["user_id"]

    # 1. Create Checkout Session
    checkout_response = client.post(
        "/api/v1/subscription/checkout",
        json={"tier": "premium"},
        headers=headers
    )
    assert checkout_response.status_code == 200
    checkout_data = checkout_response.json()
    assert "checkout_url" in checkout_data
    assert "stripe.com" in checkout_data["checkout_url"]

    # 2. Try accessing Premium endpoint as free user -> Should get 403 Forbidden
    test_prem_free = client.get("/api/v1/subscription/test-premium", headers=headers)
    assert test_prem_free.status_code == 403
    assert "Premium üyelik gereklidir" in test_prem_free.json()["detail"]

    # 3. Simulate Webhook Upgrade from Stripe
    webhook_response = client.post(
        "/api/v1/subscription/webhook",
        json={
            "event_type": "payment_intent.succeeded",
            "user_id": user_id,
            "tier": "premium"
        }
    )
    assert webhook_response.status_code == 200
    assert webhook_response.json()["status"] == "success"

    # 4. Try accessing Premium endpoint as upgraded premium user -> Should get 200 OK
    test_prem_upgraded = client.get("/api/v1/subscription/test-premium", headers=headers)
    assert test_prem_upgraded.status_code == 200
    assert "Welcome premium user" in test_prem_upgraded.json()["message"]

    # 5. Cancel subscription
    cancel_response = client.post("/api/v1/subscription/cancel", headers=headers)
    assert cancel_response.status_code == 200
    assert cancel_response.json()["status"] == "success"

    # 6. Try accessing Premium endpoint after cancellation -> Should get 403 Forbidden
    test_prem_after_cancel = client.get("/api/v1/subscription/test-premium", headers=headers)
    assert test_prem_after_cancel.status_code == 403
