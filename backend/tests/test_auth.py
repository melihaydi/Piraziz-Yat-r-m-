def test_register_user(client):
    response = client.post(
        "/api/v1/auth/register",
        json={
            "email": "testuser@example.com",
            "password": "testpassword123",
            "full_name": "Test User",
            "role": "free"
        , "terms_accepted": True}
    )
    assert response.status_code == 201
    data = response.json()
    assert data["email"] == "testuser@example.com"
    assert "id" in data
    assert data["full_name"] == "Test User"
    assert data["role"] == "free"
    assert "password" not in data  # Ensure password is not exposed

def test_register_without_terms_accepted_is_rejected(client):
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "noconsent@example.com", "password": "password123"}
    )
    assert response.status_code == 400

    response = client.post(
        "/api/v1/auth/register",
        json={"email": "noconsent@example.com", "password": "password123", "terms_accepted": False}
    )
    assert response.status_code == 400

def test_register_duplicate_email(client):
    # First registration
    client.post(
        "/api/v1/auth/register",
        json={"email": "duplicate@example.com", "password": "password123", "terms_accepted": True}
    )
    # Duplicate registration
    response = client.post(
        "/api/v1/auth/register",
        json={"email": "duplicate@example.com", "password": "password123", "terms_accepted": True}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "The user with this email already exists in the system."

def test_login_user(client):
    # Register user
    client.post(
        "/api/v1/auth/register",
        json={"email": "loginuser@example.com", "password": "loginpassword", "terms_accepted": True}
    )
    # Login
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "loginuser@example.com", "password": "loginpassword"}
    )
    assert response.status_code == 200
    data = response.json()
    assert "access_token" in data
    assert data["token_type"] == "bearer"

def test_login_user_incorrect_password(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "wrongpwd@example.com", "password": "correctpassword", "terms_accepted": True}
    )
    response = client.post(
        "/api/v1/auth/login",
        data={"username": "wrongpwd@example.com", "password": "wrongpassword"}
    )
    assert response.status_code == 400
    assert response.json()["detail"] == "Incorrect email or password"

def test_read_user_me(client):
    client.post(
        "/api/v1/auth/register",
        json={"email": "me@example.com", "password": "mypassword", "terms_accepted": True}
    )
    # Get JWT
    login_response = client.post(
        "/api/v1/auth/login",
        data={"username": "me@example.com", "password": "mypassword"}
    )
    token = login_response.json()["access_token"]
    
    # Access protected /me endpoint
    response = client.get(
        "/api/v1/auth/me",
        headers={"Authorization": f"Bearer {token}"}
    )
    assert response.status_code == 200
    data = response.json()
    assert data["email"] == "me@example.com"
    
def test_read_user_me_unauthorized(client):
    response = client.get("/api/v1/auth/me")
    assert response.status_code == 401
