from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api import deps
from app.models.user import User
from app.services import trade_service
from app.services.trade_service import TradeError

router = APIRouter()


class AccountCreate(BaseModel):
    broker: Literal["info_yatirim", "midas"]
    starting_balance: float = trade_service.DEFAULT_STARTING_BALANCE


class BrokerChange(BaseModel):
    broker: Literal["info_yatirim", "midas"]


class DepositCreate(BaseModel):
    amount: float


class OrderCreate(BaseModel):
    instrument_type: Literal["stock", "viop"]
    symbol: str
    side: Literal["AL", "SAT"]
    lot: float


def _require_account(db: Session, current_user: User):
    account = trade_service.get_account(db, current_user.id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade hesabı bulunamadı. Önce broker seçimi yapılmalı."
        )
    return account


@router.get("/account")
def get_account(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Returns null if the user hasn't been through broker onboarding yet -
    the frontend uses this to decide whether to show the broker picker."""
    account = trade_service.get_account(db, current_user.id)
    if not account:
        return None
    return trade_service.serialize_account(db, account)


@router.post("/account")
def create_account(
    payload: AccountCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    try:
        account = trade_service.create_account(db, current_user.id, payload.broker, payload.starting_balance)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account)


@router.put("/account/broker")
def update_broker(
    payload: BrokerChange,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Change the broker card later without resetting balance/positions -
    both brokers run the identical simulated system, so this is cosmetic."""
    account = _require_account(db, current_user)
    try:
        account = trade_service.change_broker(db, account, payload.broker)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account)


@router.post("/account/deposit")
def deposit(
    payload: DepositCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Adds funds to the simulated cash balance (paper trading - no real
    money moves)."""
    account = _require_account(db, current_user)
    try:
        account = trade_service.deposit_funds(db, account, payload.amount)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account)


@router.post("/account/reset")
def reset_account(
    payload: AccountCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Deliberate full restart - wipes positions/history and reseeds cash."""
    account = _require_account(db, current_user)
    account = trade_service.reset_account(db, account, payload.starting_balance)
    if payload.broker:
        account = trade_service.change_broker(db, account, payload.broker)
    return trade_service.serialize_account(db, account)


@router.get("/watchlist")
def get_watchlist():
    """Live BIST30 quotes for the Trade module's stock watchlist."""
    return trade_service.get_watchlist()


@router.get("/viop-contracts")
def get_viop_contracts():
    """Live quotes for the VİOP tab's tracked contracts."""
    return trade_service.get_viop_watchlist()


@router.get("/positions")
def get_positions(
    instrument_type: Optional[Literal["stock", "viop"]] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user)
    return trade_service.get_positions(db, account, instrument_type)


@router.post("/order")
def place_order(
    payload: OrderCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user)
    try:
        return trade_service.place_order(
            db, account, payload.instrument_type, payload.symbol, payload.side, payload.lot
        )
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))


@router.get("/history")
def get_history(
    limit: int = 100,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user)
    return trade_service.get_history(db, account, limit)


@router.get("/performance")
def get_performance(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user)
    return trade_service.get_performance(db, account)
