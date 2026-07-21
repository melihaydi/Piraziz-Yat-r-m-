from typing import Optional, Any, Dict
from pydantic import BaseModel, ConfigDict
from datetime import datetime

class AlertBase(BaseModel):
    ticker: Optional[str] = None
    alert_type: str  # price, rsi, macd, kap, news, dividend, macro
    trigger_condition: Dict[str, Any]  # {"operator": ">", "value": 120.5}

class AlertCreate(AlertBase):
    pass

class AlertResponse(AlertBase):
    id: int
    user_id: int
    is_triggered: bool
    is_active: bool
    created_at: datetime
    triggered_at: Optional[datetime] = None

    model_config = ConfigDict(from_attributes=True)
