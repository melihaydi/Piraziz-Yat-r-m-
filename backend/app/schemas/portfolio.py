from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime

class PortfolioAssetBase(BaseModel):
    ticker: str
    shares: float
    average_cost: float

class PortfolioAssetCreate(PortfolioAssetBase):
    pass

class PortfolioAssetResponse(PortfolioAssetBase):
    id: int
    portfolio_id: int
    current_price: Optional[float] = None
    total_value: Optional[float] = None
    total_profit: Optional[float] = None
    profit_percentage: Optional[float] = None
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)

class PortfolioBase(BaseModel):
    name: str

class PortfolioCreate(PortfolioBase):
    pass

class PortfolioResponse(PortfolioBase):
    id: int
    user_id: int
    assets: List[PortfolioAssetResponse] = []
    total_cost: Optional[float] = 0.0
    total_value: Optional[float] = 0.0
    total_profit: Optional[float] = 0.0
    profit_percentage: Optional[float] = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
