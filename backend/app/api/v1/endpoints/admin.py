import html
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.api.v1.endpoints.portfolio import calculate_asset_metrics, _daily_change, _usd_try_rate
from app.core.audit import log_audit
from app.core.limiter import limiter
from app.core.email import send_email
from app.models.audit_log import AuditLog
from app.models.portfolio import Portfolio, PortfolioAsset
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support import SupportTicketAdminResponse, SupportTicketUpdate
from app.schemas.user import UserOut

router = APIRouter()

VALID_ROLES = {"free", "premium"}


@router.get("/users", response_model=List[UserOut])
@limiter.limit("60/minute")
def list_users(
    request: Request,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """All registered users, newest first - superuser only."""
    return db.query(User).order_by(User.created_at.desc()).all()


@router.put("/users/{user_id}/role", response_model=UserOut)
@limiter.limit("30/minute")
def update_user_role(
    request: Request,
    user_id: int,
    role: str,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Sets a user's subscription tier - superuser only. This is the manual
    equivalent of what a real payment webhook would do (see subscription.py)
    - there's no real Stripe integration behind this app yet, so tier
    changes happen here until there is one."""
    if role not in VALID_ROLES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Geçersiz rol. Geçerli roller: {', '.join(sorted(VALID_ROLES))}",
        )
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")

    old_role = target.role
    target.role = role
    db.commit()
    db.refresh(target)
    log_audit(db, "role_change", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"old_role": old_role, "new_role": role, "target_email": target.email})
    return target


@router.put("/users/{user_id}/active", response_model=UserOut)
@limiter.limit("30/minute")
def set_user_active(
    request: Request,
    user_id: int,
    is_active: bool,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Activates/deactivates an account (deactivated accounts can't log in -
    see get_current_user) - superuser only."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if target.id == admin.id and not is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kendi hesabınızı devre dışı bırakamazsınız.")

    target.is_active = is_active
    db.commit()
    db.refresh(target)
    return target


@router.post("/users/{user_id}/reset-2fa", response_model=UserOut)
@limiter.limit("10/minute")
def reset_user_2fa(
    request: Request,
    user_id: int,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Last-resort account recovery: switches 2FA off for a user who has
    lost both their authenticator device and their recovery codes -
    superuser only, and audit-logged, because this deliberately strips a
    security control off someone else's account. The user can (and should)
    re-enable 2FA from Settings afterwards. Verify the requester's identity
    out-of-band before using this."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if not target.totp_enabled:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bu hesapta 2FA zaten kapalı.")

    target.totp_enabled = False
    target.totp_secret = None
    target.totp_recovery_codes = None
    db.commit()
    db.refresh(target)
    log_audit(db, "admin_2fa_reset", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"target_email": target.email})
    return target


@router.get("/audit-log")
@limiter.limit("60/minute")
def get_audit_log(
    request: Request,
    limit: int = 100,
    action: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Recent audit trail (trade orders, role changes, login attempts),
    newest first - superuser only. Optionally filtered to one action type."""
    query = db.query(AuditLog).order_by(AuditLog.created_at.desc())
    if action:
        query = query.filter(AuditLog.action == action)
    rows = query.limit(min(limit, 500)).all()
    return [
        {
            "id": r.id,
            "user_id": r.user_id,
            "action": r.action,
            "resource_type": r.resource_type,
            "resource_id": r.resource_id,
            "details": r.details,
            "ip_address": r.ip_address,
            "created_at": r.created_at,
        }
        for r in rows
    ]


@router.get("/support/tickets", response_model=List[SupportTicketAdminResponse])
@limiter.limit("60/minute")
def list_support_tickets(
    request: Request,
    status_filter: Optional[str] = None,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """All support tickets across all users, newest first - superuser only.
    Optionally filtered to status=open|closed."""
    query = db.query(SupportTicket).order_by(SupportTicket.created_at.desc())
    if status_filter:
        query = query.filter(SupportTicket.status == status_filter)
    tickets = query.all()
    return [
        SupportTicketAdminResponse(
            id=t.id, user_id=t.user_id, subject=t.subject, message=t.message,
            status=t.status, admin_reply=t.admin_reply, created_at=t.created_at,
            updated_at=t.updated_at, user_email=t.user.email,
        )
        for t in tickets
    ]


@router.put("/support/tickets/{ticket_id}", response_model=SupportTicketAdminResponse)
@limiter.limit("30/minute")
def update_support_ticket(
    request: Request,
    ticket_id: int,
    body: SupportTicketUpdate,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Answers/closes a ticket - superuser only. Emails the ticket's owner
    when a reply is added, same as a real support inbox."""
    ticket = db.query(SupportTicket).filter(SupportTicket.id == ticket_id).first()
    if not ticket:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Destek talebi bulunamadı.")

    reply_added = body.admin_reply is not None and body.admin_reply != ticket.admin_reply
    if body.admin_reply is not None:
        ticket.admin_reply = body.admin_reply
    if body.status is not None:
        if body.status not in ("open", "closed"):
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Geçersiz durum.")
        ticket.status = body.status
    db.commit()
    db.refresh(ticket)

    if reply_added:
        # Escaped before going into the HTML email body - subject/admin_reply
        # are free-text (subject from the ticket submitter, admin_reply from
        # whoever's logged into the admin panel), so an unescaped
        # "<img src=...>" or link would render live in the recipient's mail
        # client (see support.py's create_ticket for the matching subject/
        # message escaping).
        send_email(
            ticket.user.email,
            f"Destek Talebinize Yanıt Verildi: {html.escape(ticket.subject)}",
            f"<p><strong>Konu:</strong> {html.escape(ticket.subject)}</p><p>{html.escape(ticket.admin_reply)}</p>",
        )

    return SupportTicketAdminResponse(
        id=ticket.id, user_id=ticket.user_id, subject=ticket.subject, message=ticket.message,
        status=ticket.status, admin_reply=ticket.admin_reply, created_at=ticket.created_at,
        updated_at=ticket.updated_at, user_email=ticket.user.email,
    )


# --- Yönetilen Portföyler (managed portfolios) -----------------------------
# Lets an admin record stock/fund holdings directly into another user's
# portfolio (e.g. a friend who signed up but wants the admin to enter what
# was actually bought on their behalf) WITHOUT logging into that user's
# account. Deliberately reuses the same Portfolio/PortfolioAsset model the
# self-service "Portföyüm" page writes to (see portfolio.py) - an admin-added
# holding shows up for the target user exactly like one they entered
# themselves, just attributed via the audit log instead of self-service.
# No live pricing here on purpose: this is a data-entry surface, not a
# monitoring one - the target user's own Portföyüm page already shows live
# valuation for whatever gets recorded here.

class ManagedAssetIn(BaseModel):
    ticker: str
    shares: float
    average_cost: float


class ManagedCashAdjustIn(BaseModel):
    # Signed delta, not an absolute balance - positive deposits, negative
    # withdraws/corrects. Mirrors trade_service.deposit_funds's shape
    # conceptually, but that one is deposit-only; an admin correcting
    # another user's real portfolio needs to walk a mistaken entry back too.
    amount: float


class ManagedViopMarginAdjustIn(BaseModel):
    # Same signed-delta shape as ManagedCashAdjustIn - see that class's
    # docstring.
    amount: float


class ManagedUsdCashAdjustIn(BaseModel):
    # Same signed-delta shape as ManagedCashAdjustIn, but in raw USD, not
    # TL - see Portfolio.usd_cash_balance's docstring.
    amount: float


def _asset_dict(asset: PortfolioAsset) -> dict:
    return {
        "id": asset.id,
        "portfolio_id": asset.portfolio_id,
        "ticker": asset.ticker,
        "shares": asset.shares,
        "average_cost": asset.average_cost,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }


@router.get("/managed-portfolios/{user_id}")
@limiter.limit("60/minute")
def get_managed_portfolio(
    request: Request,
    user_id: int,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """The target user's portfolio and its holdings - auto-creates an "Ana
    Portföy" for them if they don't have one yet (same default-portfolio
    convenience the self-service flow assumes), so the admin can start
    entering holdings immediately without a separate "create portfolio"
    step. Superuser only."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")

    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)

    # Live valuation reuses portfolio.py's own helpers rather than
    # recomputing any of it here, so an admin viewing a managed portfolio
    # sees exactly the figures its owner sees - including the fund intraday
    # estimate kept strictly separate from the official NAV (see
    # _fund_estimated_daily_change_pct's docstring for why that separation
    # matters). Admins are not delay-gated (delay_minutes=0): this is an
    # operational view for someone entering trades on the user's behalf.
    assets = []
    total_cost = 0.0
    total_value = 0.0
    for asset in portfolio.assets:
        metrics = calculate_asset_metrics(asset)
        daily_change_pct, is_estimate = _daily_change(asset.ticker.upper())
        metrics["daily_change_pct"] = daily_change_pct
        metrics["daily_change_is_estimate"] = is_estimate
        metrics["daily_gain_value"] = (
            metrics["total_value"] * daily_change_pct / 100 if daily_change_pct is not None else None
        )
        metrics["cost_value"] = asset.shares * asset.average_cost
        assets.append(metrics)
        total_cost += metrics["cost_value"]
        total_value += metrics["total_value"]

    # Cash, VİOP teminatı and USD cash all fold 1:1 into total_cost and
    # total_value (never just one side) - none has profit/loss of its own,
    # so adding them equally to both keeps total_profit exactly what the
    # priced holdings made/lost, while still correctly diluting
    # profit_percentage as a real blended portfolio return would (₺10 profit
    # on ₺100 stock + ₺100 idle cash is a 5% portfolio return, not 10%). USD
    # cash converts to TL at the CURRENT live rate on every read, not the
    # rate at deposit time - see Portfolio.usd_cash_balance's docstring.
    usd_cash_value_try = portfolio.usd_cash_balance * _usd_try_rate()
    total_cost += portfolio.cash_balance + portfolio.viop_margin + usd_cash_value_try
    total_value += portfolio.cash_balance + portfolio.viop_margin + usd_cash_value_try
    total_profit = total_value - total_cost

    return {
        "user_id": target.id,
        "user_email": target.email,
        "user_name": target.full_name,
        "portfolio_id": portfolio.id,
        "usd_cash_balance": portfolio.usd_cash_balance,
        "usd_cash_value_try": round(usd_cash_value_try, 2),
        "portfolio_name": portfolio.name,
        "assets": assets,
        "cash_balance": portfolio.cash_balance,
        "viop_margin": portfolio.viop_margin,
        "total_cost": total_cost,
        "total_value": total_value,
        "total_profit": total_profit,
        "profit_percentage": (total_profit / total_cost * 100) if total_cost > 0 else 0.0,
    }


@router.post("/managed-portfolios/{user_id}/cash")
@limiter.limit("30/minute")
def adjust_managed_cash(
    request: Request,
    user_id: int,
    payload: ManagedCashAdjustIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Deposits (positive amount) or withdraws/corrects (negative amount)
    cash held in the target user's portfolio - NOT a priced holding (see
    Portfolio.cash_balance's docstring for why this can't just be another
    managed asset row). Superuser only, audit-logged."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if payload.amount == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutar sıfır olamaz.")

    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)

    new_balance = portfolio.cash_balance + payload.amount
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Yetersiz nakit: mevcut bakiye ₺{portfolio.cash_balance:.2f}, "
                   f"₺{-payload.amount:.2f} çıkarılamaz.",
        )
    portfolio.cash_balance = new_balance
    db.commit()
    db.refresh(portfolio)

    log_audit(db, "managed_portfolio_cash_adjusted", request=request, user_id=admin.id, resource_type="portfolio",
              resource_id=portfolio.id, details={
                  "target_user_id": user_id, "target_email": target.email,
                  "amount": payload.amount, "new_balance": portfolio.cash_balance,
              })
    return {"cash_balance": portfolio.cash_balance}


@router.post("/managed-portfolios/{user_id}/viop-margin")
@limiter.limit("30/minute")
def adjust_managed_viop_margin(
    request: Request,
    user_id: int,
    payload: ManagedViopMarginAdjustIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Deposits (positive amount) or withdraws/corrects (negative amount)
    VİOP teminatı (futures/options margin) held in the target user's
    portfolio - mirrors adjust_managed_cash above exactly, just tracked as
    its own balance (Portfolio.viop_margin) since it's conceptually a
    separate, blocked-for-collateral amount rather than free cash. Superuser
    only, audit-logged."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if payload.amount == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutar sıfır olamaz.")

    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)

    new_balance = portfolio.viop_margin + payload.amount
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Yetersiz VİOP teminatı: mevcut bakiye ₺{portfolio.viop_margin:.2f}, "
                   f"₺{-payload.amount:.2f} çıkarılamaz.",
        )
    portfolio.viop_margin = new_balance
    db.commit()
    db.refresh(portfolio)

    log_audit(db, "managed_portfolio_viop_margin_adjusted", request=request, user_id=admin.id, resource_type="portfolio",
              resource_id=portfolio.id, details={
                  "target_user_id": user_id, "target_email": target.email,
                  "amount": payload.amount, "new_balance": portfolio.viop_margin,
              })
    return {"viop_margin": portfolio.viop_margin}


@router.post("/managed-portfolios/{user_id}/usd-cash")
@limiter.limit("30/minute")
def adjust_managed_usd_cash(
    request: Request,
    user_id: int,
    payload: ManagedUsdCashAdjustIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Deposits (positive amount) or withdraws/corrects (negative amount)
    cash held directly in USD in the target user's portfolio - mirrors
    adjust_managed_cash above, but the amount is raw dollars (not TL) and
    is stored as such; its TL value is computed fresh at the live USD/TRY
    rate on every read (see Portfolio.usd_cash_balance's docstring), not
    converted once at deposit time. Superuser only, audit-logged."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if payload.amount == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutar sıfır olamaz.")

    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)

    new_balance = portfolio.usd_cash_balance + payload.amount
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Yetersiz döviz nakti: mevcut bakiye ${portfolio.usd_cash_balance:.2f}, "
                   f"${-payload.amount:.2f} çıkarılamaz.",
        )
    portfolio.usd_cash_balance = new_balance
    db.commit()
    db.refresh(portfolio)

    log_audit(db, "managed_portfolio_usd_cash_adjusted", request=request, user_id=admin.id, resource_type="portfolio",
              resource_id=portfolio.id, details={
                  "target_user_id": user_id, "target_email": target.email,
                  "amount": payload.amount, "new_balance": portfolio.usd_cash_balance,
              })
    return {"usd_cash_balance": portfolio.usd_cash_balance, "usd_cash_value_try": round(portfolio.usd_cash_balance * _usd_try_rate(), 2)}


@router.post("/managed-portfolios/{user_id}/assets", status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def add_managed_asset(
    request: Request,
    user_id: int,
    asset_in: ManagedAssetIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Adds a holding to the target user's portfolio, or folds it into an
    existing position at a weighted average cost if that ticker is already
    held - identical merge logic to the self-service add-asset endpoint
    (see portfolio.py's add_asset_to_portfolio). Superuser only, audit-logged
    since this is one user's money being entered by someone else."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")

    portfolio = db.query(Portfolio).filter(Portfolio.user_id == user_id).first()
    if not portfolio:
        portfolio = Portfolio(user_id=user_id, name="Ana Portföy")
        db.add(portfolio)
        db.commit()
        db.refresh(portfolio)

    ticker_upper = asset_in.ticker.upper()
    existing = db.query(PortfolioAsset).filter(
        PortfolioAsset.portfolio_id == portfolio.id,
        PortfolioAsset.ticker == ticker_upper,
    ).first()

    if existing:
        total_shares = existing.shares + asset_in.shares
        if total_shares > 0:
            existing.average_cost = (
                (existing.shares * existing.average_cost) + (asset_in.shares * asset_in.average_cost)
            ) / total_shares
            existing.shares = total_shares
        db.commit()
        db.refresh(existing)
        asset = existing
    else:
        asset = PortfolioAsset(
            portfolio_id=portfolio.id, ticker=ticker_upper,
            shares=asset_in.shares, average_cost=asset_in.average_cost,
        )
        db.add(asset)
        db.commit()
        db.refresh(asset)

    log_audit(db, "managed_portfolio_asset_added", request=request, user_id=admin.id, resource_type="portfolio_asset",
              resource_id=asset.id, details={
                  "target_user_id": user_id, "target_email": target.email,
                  "ticker": ticker_upper, "shares": asset_in.shares, "average_cost": asset_in.average_cost,
              })
    return _asset_dict(asset)


@router.put("/managed-portfolios/assets/{asset_id}")
@limiter.limit("30/minute")
def update_managed_asset(
    request: Request,
    asset_id: int,
    payload: ManagedAssetIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Overwrites a managed holding's shares/average cost outright (unlike
    the add endpoint, no weighted-average merge - this is a direct
    correction). Superuser only, audit-logged."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(PortfolioAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Varlık bulunamadı.")
    target = db.query(User).filter(User.id == asset.portfolio.user_id).first()

    asset.shares = payload.shares
    asset.average_cost = payload.average_cost
    db.commit()
    db.refresh(asset)

    log_audit(db, "managed_portfolio_asset_updated", request=request, user_id=admin.id, resource_type="portfolio_asset",
              resource_id=asset.id, details={
                  "target_user_id": asset.portfolio.user_id, "target_email": target.email if target else None,
                  "ticker": asset.ticker, "shares": payload.shares, "average_cost": payload.average_cost,
              })
    return _asset_dict(asset)


@router.delete("/managed-portfolios/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def delete_managed_asset(
    request: Request,
    asset_id: int,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Removes a holding from a managed portfolio. Superuser only, audit-logged."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(PortfolioAsset.id == asset_id).first()
    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Varlık bulunamadı.")

    target_user_id = asset.portfolio.user_id
    ticker = asset.ticker
    db.delete(asset)
    db.commit()

    log_audit(db, "managed_portfolio_asset_removed", request=request, user_id=admin.id, resource_type="portfolio_asset",
              resource_id=asset_id, details={"target_user_id": target_user_id, "ticker": ticker})
    return None
