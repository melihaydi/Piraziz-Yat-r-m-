from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.db.session import SessionLocal
from app.models.user import User
from app.models.portfolio import Portfolio, PortfolioAsset
from app.schemas.portfolio import PortfolioCreate, PortfolioResponse, PortfolioAssetCreate, PortfolioAssetResponse
from app.services.market_data import market_data_service
from app.services.tefas import tefas_service

router = APIRouter()

def calculate_asset_metrics(asset: PortfolioAsset) -> dict:
    """Helper to compute real-time value and profit metrics for an asset."""
    ticker = asset.ticker.upper()
    live_price = None
    
    if len(ticker) == 3:
        # Fetch from TEFAS Mutual Funds Service
        fund = tefas_service.get_fund(ticker)
        if fund:
            live_price = fund["price"]
    else:
        # Fetch from BIST Stocks Service
        quote = market_data_service.get_quote(ticker)
        if quote:
            live_price = quote.get("last")
            
    if live_price is None or live_price == 0:
        live_price = asset.average_cost

    cost_value = asset.shares * asset.average_cost
    current_value = asset.shares * live_price
    profit = current_value - cost_value
    profit_pct = (profit / cost_value * 100) if cost_value > 0 else 0.0

    return {
        "id": asset.id,
        "portfolio_id": asset.portfolio_id,
        "ticker": asset.ticker,
        "shares": asset.shares,
        "average_cost": asset.average_cost,
        "current_price": live_price,
        "total_value": current_value,
        "total_profit": profit,
        "profit_percentage": profit_pct,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }

@router.get("/", response_model=List[PortfolioResponse])
def get_user_portfolios(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Retrieve all portfolios for the current user, calculating real-time valuations."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    
    response_list = []
    for p in portfolios:
        assets_responses = []
        total_cost = 0.0
        total_value = 0.0
        
        for asset in p.assets:
            metrics = calculate_asset_metrics(asset)
            assets_responses.append(PortfolioAssetResponse(**metrics))
            
            total_cost += asset.shares * asset.average_cost
            total_value += metrics["total_value"]

        total_profit = total_value - total_cost
        profit_pct = (total_profit / total_cost * 100) if total_cost > 0 else 0.0

        p_dict = {
            "id": p.id,
            "user_id": p.user_id,
            "name": p.name,
            "assets": assets_responses,
            "total_cost": total_cost,
            "total_value": total_value,
            "total_profit": total_profit,
            "profit_percentage": profit_pct,
            "created_at": p.created_at,
            "updated_at": p.updated_at
        }
        response_list.append(PortfolioResponse(**p_dict))

    return response_list

@router.post("/", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
def create_portfolio(
    portfolio_in: PortfolioCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new portfolio."""
    db_portfolio = Portfolio(name=portfolio_in.name, user_id=current_user.id)
    db.add(db_portfolio)
    db.commit()
    db.refresh(db_portfolio)
    
    # Return empty response shell
    return PortfolioResponse(
        id=db_portfolio.id,
        user_id=db_portfolio.user_id,
        name=db_portfolio.name,
        assets=[],
        total_cost=0.0,
        total_value=0.0,
        total_profit=0.0,
        profit_percentage=0.0,
        created_at=db_portfolio.created_at,
        updated_at=db_portfolio.updated_at
    )

@router.post("/{id}/assets", response_model=PortfolioAssetResponse, status_code=status.HTTP_201_CREATED)
def add_asset_to_portfolio(
    id: int,
    asset_in: PortfolioAssetCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Add a stock asset to the portfolio or recalculate weighted cost if it already exists."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    ticker_upper = asset_in.ticker.upper()
    existing_asset = db.query(PortfolioAsset).filter(
        PortfolioAsset.portfolio_id == id, 
        PortfolioAsset.ticker == ticker_upper
    ).first()

    if existing_asset:
        # Calculate weighted average cost
        total_shares = existing_asset.shares + asset_in.shares
        if total_shares > 0:
            weighted_cost = (
                (existing_asset.shares * existing_asset.average_cost) + 
                (asset_in.shares * asset_in.average_cost)
            ) / total_shares
            existing_asset.average_cost = weighted_cost
            existing_asset.shares = total_shares
        
        db.commit()
        db.refresh(existing_asset)
        asset_obj = existing_asset
    else:
        # Create new asset
        db_asset = PortfolioAsset(
            portfolio_id=id,
            ticker=ticker_upper,
            shares=asset_in.shares,
            average_cost=asset_in.average_cost
        )
        db.add(db_asset)
        db.commit()
        db.refresh(db_asset)
        asset_obj = db_asset

    metrics = calculate_asset_metrics(asset_obj)
    return PortfolioAssetResponse(**metrics)

@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_asset_from_portfolio(
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Remove an asset from portfolio."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    db.delete(asset)
    db.commit()
    return None

from pydantic import BaseModel

class AssetUpdate(BaseModel):
    shares: float
    average_cost: float

class AssetSell(BaseModel):
    shares: float

@router.put("/assets/{asset_id}", response_model=PortfolioAssetResponse)
def update_portfolio_asset(
    asset_id: int,
    asset_in: AssetUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update asset lot quantity and average cost."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    asset.shares = asset_in.shares
    asset.average_cost = asset_in.average_cost
    db.commit()
    db.refresh(asset)

    metrics = calculate_asset_metrics(asset)
    return PortfolioAssetResponse(**metrics)

@router.post("/assets/{asset_id}/sell", response_model=Optional[PortfolioAssetResponse])
def sell_portfolio_asset(
    asset_id: int,
    sell_in: AssetSell,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Sell a partial or complete amount of shares. Deletes asset if remaining shares <= 0."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    if sell_in.shares >= asset.shares:
        # Sell entire lot
        db.delete(asset)
        db.commit()
        return None
    else:
        # Partial sell
        asset.shares -= sell_in.shares
        db.commit()
        db.refresh(asset)
        metrics = calculate_asset_metrics(asset)
        return PortfolioAssetResponse(**metrics)

@router.get("/signals")
def get_portfolio_signals(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Generate technical analysis buy/sell alerts for portfolio assets."""
    from datetime import datetime
    assets = db.query(PortfolioAsset).join(Portfolio).filter(
        Portfolio.user_id == current_user.id
    ).all()

    # If the user has no assets, provide signals for BIST 30 popular stocks
    symbols_to_check = [asset.ticker for asset in assets]
    is_fallback = False
    if not symbols_to_check:
        symbols_to_check = ["THYAO", "EREGL", "TUPRS", "BIMAS", "ODINE"]
        is_fallback = True

    signals = []
    for ticker in symbols_to_check:
        ticker = ticker.upper()
        # Skip funds for MA crossover analysis (they have 3 characters)
        if len(ticker) == 3:
            continue
            
        candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False)
        if not candles or len(candles) < 20:
            continue

        closes = [c["close"] for c in candles]
        curr = closes[-1]
        sma20 = sum(closes[-20:]) / 20.0
        
        # Calculate Crossovers
        prev_c = closes[-2]
        prev_sma20 = sum(closes[-21:-1]) / 20.0
        
        sig = "TUT"
        desc = "Fiyat 20 günlük hareketli ortalamanın (SMA20) üzerinde seyretmeye devam ediyor. Yükseliş trendi korunuyor."
        color = "emerald"
        
        # Check Crossover UP (AL)
        if prev_c <= prev_sma20 and curr > sma20:
            sig = "AL"
            desc = "Fiyat 20 günlük hareketli ortalamayı (SMA20) yukarı yönlü kırdı. Güçlü boğa momentumu başlattı!"
            color = "green"
        # Check Crossover DOWN (SAT)
        elif prev_c >= prev_sma20 and curr < sma20:
            sig = "SAT"
            desc = "Fiyat 20 günlük hareketli ortalamayı (SMA20) aşağı yönlü kırdı. Satış baskısı artabilir!"
            color = "rose"
        # Check simple positions if no active crossover
        elif curr < sma20:
            sig = "ZAYIF"
            desc = "Fiyat 20 günlük hareketli ortalamanın (SMA20) altında hareket ediyor. Teknik görünüm zayıf."
            color = "amber"

        signals.append({
            "ticker": ticker,
            "price": round(curr, 2),
            "sma20": round(sma20, 2),
            "signal": sig,
            "description": desc,
            "color": color,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        })

    return {
        "is_fallback": is_fallback,
        "signals": signals
    }
