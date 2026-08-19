from datetime import date
from typing import Literal, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from fastapi.responses import Response
from sqlalchemy.orm import Session
from pydantic import BaseModel

from app.api import deps
from app.core.audit import log_audit
from app.core.limiter import limiter
from app.models.user import User
from app.services import trade_service
from app.services.trade_service import TradeError

router = APIRouter(dependencies=[Depends(deps.get_current_premium_user)])


class AccountCreate(BaseModel):
    broker: Literal["info_yatirim", "midas"]
    starting_balance: float = trade_service.DEFAULT_STARTING_BALANCE
    name: Optional[str] = None


class AccountRename(BaseModel):
    name: str


class BrokerChange(BaseModel):
    broker: Literal["info_yatirim", "midas"]


class DepositCreate(BaseModel):
    amount: float


class OrderCreate(BaseModel):
    instrument_type: Literal["stock", "viop"]
    symbol: str
    side: Literal["AL", "SAT"]
    lot: float
    order_type: Literal["MARKET", "LIMIT", "STOP", "STOP_LIMIT"] = "MARKET"
    limit_price: Optional[float] = None
    stop_price: Optional[float] = None


def _require_account(db: Session, current_user: User, account_id: Optional[int] = None):
    """Without account_id, resolves to the user's default (first-created)
    account - every endpoint predating multi-account support keeps working
    exactly as before. With account_id, the lookup is ownership-checked
    (get_account_by_id), so one user can never act on another's account."""
    if account_id is not None:
        account = trade_service.get_account_by_id(db, current_user.id, account_id)
    else:
        account = trade_service.get_account(db, current_user.id)
    if not account:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Trade hesabı bulunamadı. Önce broker seçimi yapılmalı."
        )
    return account


@router.get("/accounts")
def list_accounts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """All of the user's paper-trading accounts (lightweight - no live
    valuation per account). The frontend's account switcher uses this;
    GET/POST /account (singular) keep working against the default account
    for anything not yet updated to pass account_id."""
    return [trade_service.account_summary_dict(a) for a in trade_service.get_accounts(db, current_user.id)]


@router.post("/accounts", status_code=status.HTTP_201_CREATED)
def create_additional_account(
    payload: AccountCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Opens another parallel paper-trading account (e.g. one per strategy) -
    unlike the old single-account model, this always succeeds rather than
    rejecting a second account."""
    try:
        account = trade_service.create_account(
            db, current_user.id, payload.broker, payload.starting_balance, payload.name
        )
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account, delay)


@router.put("/accounts/{account_id}")
def rename_account(
    account_id: int,
    payload: AccountRename,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user, account_id)
    try:
        account = trade_service.rename_account(db, account, payload.name)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.account_summary_dict(account)


@router.delete("/accounts/{account_id}", status_code=status.HTTP_204_NO_CONTENT)
def remove_account(
    account_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Permanently deletes an account and everything under it. Blocked if
    it's the user's only remaining account - there must always be one to
    fall back to (the default-account lookup, the exe's bootstrap flow,
    etc. all assume at least one exists). The "keep at least one" check
    itself is done inside delete_account, under a row lock, so it can't
    race a concurrent delete of a different account for the same user."""
    account = _require_account(db, current_user, account_id)
    try:
        trade_service.delete_account(db, account)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return None


@router.get("/account")
def get_account(
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Returns null if the user hasn't been through broker onboarding yet -
    the frontend uses this to decide whether to show the broker picker."""
    account = trade_service.get_account_by_id(db, current_user.id, account_id) if account_id is not None \
        else trade_service.get_account(db, current_user.id)
    if not account:
        return None
    return trade_service.serialize_account(db, account, delay)


@router.post("/account")
def create_account(
    payload: AccountCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    try:
        account = trade_service.create_account(
            db, current_user.id, payload.broker, payload.starting_balance, payload.name
        )
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account, delay)


@router.put("/account/broker")
def update_broker(
    payload: BrokerChange,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Change the broker card later without resetting balance/positions -
    both brokers run the identical simulated system, so this is cosmetic."""
    account = _require_account(db, current_user, account_id)
    try:
        account = trade_service.change_broker(db, account, payload.broker)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account, delay)


@router.post("/account/deposit")
@limiter.limit("30/minute")
def deposit(
    request: Request,
    payload: DepositCreate,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Adds funds to the simulated cash balance (paper trading - no real
    money moves)."""
    account = _require_account(db, current_user, account_id)
    try:
        account = trade_service.deposit_funds(db, account, payload.amount)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return trade_service.serialize_account(db, account, delay)


@router.post("/account/reset")
@limiter.limit("30/minute")
def reset_account(
    request: Request,
    payload: AccountCreate,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Deliberate full restart - wipes positions/history and reseeds cash."""
    account = _require_account(db, current_user, account_id)
    account = trade_service.reset_account(db, account, payload.starting_balance)
    if payload.broker:
        account = trade_service.change_broker(db, account, payload.broker)
    return trade_service.serialize_account(db, account, delay)


@router.get("/watchlist")
def get_watchlist(delay: int = Depends(deps.get_data_delay_minutes)):
    """BIST30 quotes for the Trade module's stock watchlist - live for
    premium, 15-minute-delayed otherwise."""
    return trade_service.get_watchlist(delay)


@router.get("/viop-contracts")
def get_viop_contracts(delay: int = Depends(deps.get_data_delay_minutes)):
    """Quotes for the VİOP tab's tracked contracts - same delay rule as
    /watchlist."""
    return trade_service.get_viop_watchlist(delay)


@router.get("/positions")
def get_positions(
    instrument_type: Optional[Literal["stock", "viop"]] = None,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    account = _require_account(db, current_user, account_id)
    return trade_service.get_positions(db, account, instrument_type, delay)


@router.post("/order")
@limiter.limit("30/minute")
def place_order(
    request: Request,
    payload: OrderCreate,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    account = _require_account(db, current_user, account_id)
    try:
        result = trade_service.place_order(
            db, account, payload.instrument_type, payload.symbol, payload.side, payload.lot,
            payload.order_type, payload.limit_price, payload.stop_price, delay,
        )
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    log_audit(db, "order_placed", request=request, user_id=current_user.id, resource_type="order",
              resource_id=result.get("id"), details={
                  "account_id": account.id, "symbol": payload.symbol, "side": payload.side,
                  "lot": payload.lot, "order_type": payload.order_type,
              })
    return result


@router.get("/pending-orders")
def get_pending_orders(
    instrument_type: Optional[Literal["stock", "viop"]] = None,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Resting LIMIT orders (order book) - the frontend polls this to render
    the order-book panel and the price line on the chart."""
    account = _require_account(db, current_user, account_id)
    return trade_service.get_pending_orders(db, account, instrument_type)


@router.delete("/pending-orders/{order_id}")
@limiter.limit("30/minute")
def cancel_pending_order(
    request: Request,
    order_id: int,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    account = _require_account(db, current_user, account_id)
    try:
        result = trade_service.cancel_pending_order(db, account, order_id, delay)
    except TradeError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    log_audit(db, "order_cancelled", request=request, user_id=current_user.id, resource_type="order",
              resource_id=order_id, details={"account_id": account.id})
    return result


@router.get("/history")
def get_history(
    limit: int = 100,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user, account_id)
    return trade_service.get_history(db, account, limit)


@router.get("/performance")
def get_performance(
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    account = _require_account(db, current_user, account_id)
    return trade_service.get_performance(db, account)


@router.get("/tax-report")
def get_tax_report(
    stock_stopaj_pct: float = 0.0,
    viop_stopaj_pct: float = 10.0,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Realized gain/loss by year and instrument type, for informational
    review only - not a tax filing, not advice. stock/viop_stopaj_pct are
    caller-supplied (see trade_service.get_tax_report's docstring for why
    these aren't hardcoded) and default to commonly-cited rates the
    frontend should present as editable, not fixed."""
    account = _require_account(db, current_user, account_id)
    return trade_service.get_tax_report(db, account, stock_stopaj_pct, viop_stopaj_pct)


@router.get("/statement")
def get_statement(
    from_date: Optional[date] = None,
    to_date: Optional[date] = None,
    account_id: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Downloadable PDF account statement for the given period (defaults to
    all-time) - see statement_service for what it contains."""
    from app.services.statement_service import generate_account_statement_pdf

    account = _require_account(db, current_user, account_id)
    pdf_bytes = generate_account_statement_pdf(db, account, from_date, to_date)
    filename = f"bip-terminal-ekstre-{account.id}-{date.today().isoformat()}.pdf"
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
