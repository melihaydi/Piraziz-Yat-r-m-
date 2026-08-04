from typing import List, Optional
from pydantic import BaseModel

class FundImpact(BaseModel):
    fund_code: str
    weight_pct: float
    # weight_pct/100 * this stock's own change_percent - how many points of
    # the fund's live estimate this single holding currently contributes.
    impact_pct: float

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
    # Only populated for stocks held by one of the "Popüler Fonlar" (TMV/
    # PBR/DFI) - empty list for everything else.
    fund_impacts: List[FundImpact] = []
