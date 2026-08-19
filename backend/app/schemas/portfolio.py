from typing import List, Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime

class PortfolioAssetBase(BaseModel):
    ticker: str
    shares: float
    average_cost: float

class PortfolioAssetCreate(PortfolioAssetBase):
    # Geçmişe dönük işlem girişi için - verilmezse "şimdi" kabul edilir.
    # Sadece hareket defterindeki kaydın tarihini etkiler, pozisyonun
    # kendisini değil (maliyet birleştirme sıraya değil tutara bakar).
    executed_at: Optional[datetime] = None


class AssetSell(BaseModel):
    shares: float
    # Satış fiyatı: gerçekleşen kâr/zararı hesaplamak için gerekli. Eski
    # istemcilerle uyum için opsiyonel - verilmezse endpoint canlı fiyatı
    # kullanır (bkz. sell_portfolio_asset).
    price: Optional[float] = None
    executed_at: Optional[datetime] = None


class DividendCreate(BaseModel):
    ticker: str
    # Temettünün ödendiği lot adedi - verilmezse mevcut pozisyonun lotu.
    shares: Optional[float] = None
    per_share: float
    # Stopaj kesintisi (brüt tutardan düşülür).
    tax: float = 0.0
    executed_at: Optional[datetime] = None


class PortfolioTransactionResponse(BaseModel):
    id: int
    portfolio_id: int
    ticker: str
    transaction_type: str
    shares: float
    price: float
    amount: float
    commission: float
    realized_pnl: Optional[float] = None
    executed_at: datetime
    note: Optional[str] = None

    model_config = ConfigDict(from_attributes=True)

class PortfolioAssetResponse(PortfolioAssetBase):
    id: int
    portfolio_id: int
    current_price: Optional[float] = None
    total_value: Optional[float] = None
    total_profit: Optional[float] = None
    profit_percentage: Optional[float] = None
    # Daily %change/gain - real for a stock (live quote), a live intraday
    # estimate for a fund (same idea as the funds page) - kept STRICTLY
    # SEPARATE from current_price/total_value above, which always stay the
    # real, officially published NAV/price - see _daily_change in the
    # endpoint. daily_change_is_estimate is only True for the fund case;
    # None/False when nothing could be resolved yet.
    daily_change_pct: Optional[float] = None
    daily_gain_value: Optional[float] = None
    daily_change_is_estimate: Optional[bool] = False
    # Official-only counterpart of the pair above (real stock quote / real
    # published TEFAS daily_return, NEVER a fund estimate) - powers the
    # portfolio-wide "Bugün" headline gain, which must be settled data.
    official_daily_change_pct: Optional[float] = None
    official_daily_gain_value: Optional[float] = None
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
    cash_balance: Optional[float] = 0.0
    viop_margin: Optional[float] = 0.0
    usd_cash_balance: Optional[float] = 0.0
    # Live TL equivalent of usd_cash_balance at read time - not a stored
    # column, computed fresh on every response (see portfolio.py's
    # _usd_try_rate()).
    usd_cash_value_try: Optional[float] = 0.0
    total_cost: Optional[float] = 0.0
    total_value: Optional[float] = 0.0
    total_profit: Optional[float] = 0.0
    profit_percentage: Optional[float] = 0.0
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
