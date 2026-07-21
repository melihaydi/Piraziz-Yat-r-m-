from typing import List, Optional
from pydantic import BaseModel

class ScreenerStockResponse(BaseModel):
    ticker: str
    name: str
    sector: str
    price: float
    change: float
    change_percent: float
    bid: float
    ask: float
    pe: float
    eps: float
    market_cap: float
    ai_score: int
    sentiment: str
