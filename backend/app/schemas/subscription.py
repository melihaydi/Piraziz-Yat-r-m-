from typing import Optional
from pydantic import BaseModel, ConfigDict


class CheckoutRequest(BaseModel):
    role: str
    # T.C. Kimlik No - required by iyzico for every real-money Checkout
    # Form request (KYC/fraud). Passed through to iyzico only, never
    # persisted - see Subscription's model docstring.
    identity_number: str
    city: Optional[str] = None
    address: Optional[str] = None
    gsm_number: Optional[str] = None


class CheckoutResponse(BaseModel):
    payment_page_url: str


class SubscriptionOut(BaseModel):
    id: int
    role: str
    amount_try: float
    period_days: int
    status: str
    expires_at: Optional[str] = None
    created_at: str

    model_config = ConfigDict(from_attributes=True)
