from pydantic import BaseModel

class CheckoutSessionCreate(BaseModel):
    tier: str  # e.g., "premium", "institutional"

class CheckoutSessionResponse(BaseModel):
    checkout_url: str
    session_id: str

class WebhookPayload(BaseModel):
    event_type: str  # e.g., "payment_intent.succeeded"
    user_id: int
    tier: str
