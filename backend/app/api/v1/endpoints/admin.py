import html
from datetime import date, timedelta
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session, joinedload

from app.api import deps
from app.api.v1.endpoints.auth import PASSWORD_RESET_TOKEN_MINUTES
from app.api.v1.endpoints.portfolio import calculate_asset_metrics, _daily_change, _usd_try_rate
from app.core import security
from app.core.audit import log_audit
from app.core.config import settings
from app.core.limiter import limiter
from app.core.email import send_email
from app.models.audit_log import AuditLog
from app.models.fund_composition_override import FundCompositionOverride
from app.models.portfolio import Portfolio, PortfolioAsset
from app.models.support_ticket import SupportTicket
from app.models.user import User
from app.schemas.support import SupportTicketAdminResponse, SupportTicketUpdate
from app.schemas.user import UserOut
from app.services import corporate_actions, portfolio_ledger
from app.services.tefas import tefas_service, FUND_DETAILS_MAP, BASE_FUNDS

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


@router.post("/users/{user_id}/reset-password")
@limiter.limit("10/minute")
def admin_trigger_password_reset(
    request: Request,
    user_id: int,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Sends the target user the exact same password-reset email
    /auth/forgot-password would (same short-lived scope="password_reset"
    token) - superuser only. Deliberately does NOT set or reveal a new
    password itself: the admin never sees/chooses the user's credential,
    the user still picks their own via the emailed link, same as
    self-service. Audit-logged since triggering this on someone else's
    account is a real support action worth a paper trail."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if not target.is_active:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hesap pasif - şifre sıfırlama e-postası gönderilemez.")

    token = security.create_access_token(
        target.id, expires_delta=timedelta(minutes=PASSWORD_RESET_TOKEN_MINUTES), scope="password_reset"
    )
    link = f"{settings.FRONTEND_URL}/reset-password?token={token}"
    send_email(
        target.email,
        "Şifre Sıfırlama - BIP Terminal",
        f"""
        <p>Merhaba{f' {html.escape(target.full_name)}' if target.full_name else ''},</p>
        <p>Hesabın için bir yönetici tarafından şifre sıfırlama isteği oluşturuldu. Aşağıdaki bağlantıya tıklayarak yeni bir şifre belirleyebilirsin:</p>
        <p><a href="{link}">Şifremi Sıfırla</a></p>
        <p>Bu bağlantı {PASSWORD_RESET_TOKEN_MINUTES} dakika geçerlidir.</p>
        """,
    )
    log_audit(db, "admin_password_reset_triggered", request=request, user_id=_admin.id, resource_type="user",
              resource_id=target.id, details={"target_email": target.email})
    return {"detail": "Şifre sıfırlama e-postası gönderildi."}


@router.delete("/users/{user_id}")
@limiter.limit("10/minute")
def admin_delete_user(
    request: Request,
    user_id: int,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Admin-initiated account deletion - mirrors /auth/me/delete's own
    soft-delete + anonymize pattern exactly (is_active=False, email
    scrambled to an unusable placeholder, name/2FA cleared) rather than a
    hard DB delete: this user's trade/portfolio/note/alert rows stay in
    place for financial/audit history, they just stop being linkable to a
    real person. Refuses to delete another superuser (use a role change
    first if that's really intended - a stray admin-panel click shouldn't
    be able to lock out another admin) or the caller's own account (use
    Settings' self-service delete for that, which re-confirms the password
    first). The target's pre-anonymization email is preserved in the audit
    log details as the only remaining record of who this was."""
    target = db.query(User).filter(User.id == user_id).first()
    if not target:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Kullanıcı bulunamadı.")
    if target.id == admin.id:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Kendi hesabınızı buradan silemezsiniz - Ayarlar sayfasını kullanın.")
    if target.is_superuser:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Bir yönetici hesabı buradan silinemez.")

    target_email = target.email
    target.is_active = False
    target.email = f"deleted-user-{target.id}@bipterminal.local"
    target.full_name = None
    target.totp_secret = None
    target.totp_enabled = False
    target.totp_recovery_codes = None
    db.commit()
    log_audit(db, "admin_account_deleted", request=request, user_id=admin.id, resource_type="user",
              resource_id=target.id, details={"target_email": target_email})
    return {"detail": "Hesap silindi."}


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
    # joinedload avoids an N+1: without it, accessing t.user.email below for
    # every ticket lazily issues its own query (300 tickets -> 300 extra
    # queries) since SupportTicket.user has no eager-load option set on the
    # relationship itself.
    query = db.query(SupportTicket).options(joinedload(SupportTicket.user)).order_by(SupportTicket.created_at.desc())
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
    # Getiri hesabının bu parayı "kazanç" sanmaması için deftere dış nakit
    # hareketi olarak yazılıyor (bkz. portfolio_ledger.record_cash_flow).
    portfolio_ledger.record_cash_flow(
        db, portfolio_id=portfolio.id, amount_try=payload.amount,
        note=f"Nakit {'girişi' if payload.amount > 0 else 'çıkışı'} (admin: {admin.email})",
    )
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
    portfolio_ledger.record_cash_flow(
        db, portfolio_id=portfolio.id, amount_try=payload.amount,
        note=f"VİOP teminatı {'girişi' if payload.amount > 0 else 'çıkışı'} (admin: {admin.email})",
    )
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
    # İşlem anındaki kurdan TL'ye çevrilip saklanıyor: sonradan kur değişse
    # de o gün gerçekte ne kadar para girdiği değişmemeli.
    portfolio_ledger.record_cash_flow(
        db, portfolio_id=portfolio.id, amount_try=payload.amount * _usd_try_rate(),
        note=f"Döviz nakit {'girişi' if payload.amount > 0 else 'çıkışı'} (${abs(payload.amount):.2f}, admin: {admin.email})",
    )
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

    # Shares the ledger service with the self-service endpoint rather than
    # repeating the weighted-average merge here (the two copies used to be
    # maintained in parallel), so an admin-entered holding gets the exact
    # same cost basis AND the same BUY history row the user's own would.
    asset = portfolio_ledger.record_buy(
        db, portfolio_id=portfolio.id, ticker=asset_in.ticker,
        shares=asset_in.shares, price=asset_in.average_cost,
        note=f"Admin girişi ({admin.email})",
    )
    db.commit()
    db.refresh(asset)

    log_audit(db, "managed_portfolio_asset_added", request=request, user_id=admin.id, resource_type="portfolio_asset",
              resource_id=asset.id, details={
                  "target_user_id": user_id, "target_email": target.email,
                  "ticker": asset.ticker, "shares": asset_in.shares, "average_cost": asset_in.average_cost,
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


# --- Fon Ağırlık Ayarlamaları (fund composition overrides) -----------------
# Lets an admin correct a tracked fund's holding weights (the ones
# "Popüler Fonlar - Anlık Getiri" weights each holding's live price change
# by - see tefas_service.get_live_estimated_return) from the admin panel
# instead of needing a code change + full deploy every time TEFAS publishes
# an updated composition. Persisted in FundCompositionOverride; takes effect
# immediately via tefas_service.refresh_composition_override(), no restart.

class FundCompositionHoldingIn(BaseModel):
    name: str
    value: float


class FundCompositionIn(BaseModel):
    assets_distribution: List[FundCompositionHoldingIn]
    # Reference date for weight-drift adjustment (see
    # get_live_estimated_return's own docstring) - optional, leave unset to
    # keep the plain static weights with no drift adjustment.
    as_of: Optional[date] = None


def _fund_composition_dict(code: str, override: Optional[FundCompositionOverride]) -> dict:
    details = FUND_DETAILS_MAP.get(code, {})
    if override:
        assets_distribution = override.assets_distribution
        as_of = override.as_of.isoformat() if override.as_of else None
        is_override = True
    else:
        assets_distribution = details.get("assets_distribution", [])
        as_of = details.get("as_of")
        is_override = False
    return {
        "fund_code": code,
        "name": BASE_FUNDS.get(code, {}).get("name", code),
        "fund_size": details.get("fund_size"),
        "assets_distribution": assets_distribution,
        "as_of": as_of,
        "is_override": is_override,
        "total_weight_pct": round(sum(float(h["value"]) for h in assets_distribution), 2) if assets_distribution else 0.0,
    }


@router.get("/fund-compositions")
@limiter.limit("60/minute")
def list_fund_compositions(
    request: Request,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Every fund with a known holdings composition (hardcoded default or
    admin override) - superuser only."""
    overrides = {row.fund_code: row for row in db.query(FundCompositionOverride).all()}
    codes = sorted(
        {c for c, d in FUND_DETAILS_MAP.items() if "assets_distribution" in d} | set(overrides.keys())
    )
    return [_fund_composition_dict(code, overrides.get(code)) for code in codes]


@router.get("/fund-compositions/{code}")
@limiter.limit("60/minute")
def get_fund_composition(
    request: Request,
    code: str,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    code = code.upper()
    override = db.query(FundCompositionOverride).filter(FundCompositionOverride.fund_code == code).first()
    if code not in FUND_DETAILS_MAP and not override:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Fon bulunamadı.")
    return _fund_composition_dict(code, override)


@router.put("/fund-compositions/{code}")
@limiter.limit("30/minute")
def save_fund_composition(
    request: Request,
    code: str,
    payload: FundCompositionIn,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Overwrites a fund's live-estimate holding weights - superuser only.
    Takes effect immediately (tefas_service.refresh_composition_override
    reloads the in-memory cache right after this commits), no deploy
    needed. The total doesn't have to be exactly 100 (a real TEFAS
    composition often doesn't either - the remainder is uncounted cash/
    bonds/other, and a fund-of-funds can legitimately double-count an
    underlying holding past 100) - the frontend warns on a large deviation
    but this endpoint doesn't reject it outright, since the admin might
    genuinely mean it."""
    code = code.upper()
    if not payload.assets_distribution:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="En az bir varlık girilmeli.")
    for h in payload.assets_distribution:
        if not h.name.strip():
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Boş sembol adı olamaz.")
        if h.value < 0:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"{h.name}: ağırlık negatif olamaz.")

    distribution = [{"name": h.name.strip().upper(), "value": h.value} for h in payload.assets_distribution]

    override = db.query(FundCompositionOverride).filter(FundCompositionOverride.fund_code == code).first()
    if override:
        override.assets_distribution = distribution
        override.as_of = payload.as_of
        override.updated_by_user_id = admin.id
    else:
        override = FundCompositionOverride(
            fund_code=code, assets_distribution=distribution, as_of=payload.as_of, updated_by_user_id=admin.id,
        )
        db.add(override)
    db.commit()
    db.refresh(override)

    tefas_service.refresh_composition_override(code)

    total = round(sum(h["value"] for h in distribution), 2)
    log_audit(db, "fund_composition_updated", request=request, user_id=admin.id, resource_type="fund_composition",
              resource_id=code, details={"fund_code": code, "total_weight_pct": total, "holdings_count": len(distribution)})
    return _fund_composition_dict(code, override)


@router.delete("/fund-compositions/{code}")
@limiter.limit("30/minute")
def reset_fund_composition(
    request: Request,
    code: str,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Removes an admin override, reverting the fund to its hardcoded
    FUND_DETAILS_MAP default - superuser only."""
    code = code.upper()
    override = db.query(FundCompositionOverride).filter(FundCompositionOverride.fund_code == code).first()
    if not override:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu fon için özel bir ayar yok.")
    db.delete(override)
    db.commit()
    tefas_service.refresh_composition_override(code)
    log_audit(db, "fund_composition_reset", request=request, user_id=admin.id, resource_type="fund_composition",
              resource_id=code, details={"fund_code": code})
    return _fund_composition_dict(code, None)


# --- Kurumsal işlemler (bedelsiz / bölünme) ---------------------------------
# Bilinçli olarak admin tetiklemeli, otomatik değil: bu, kullanıcıların
# gerçek pozisyon verisini geri alınamaz şekilde değiştiriyor. Önce
# önizleme (GET) ile ne değişeceği görülür, sonra uygulanır (POST).


def _plan_dict(p) -> dict:
    return {
        "asset_id": p.asset_id,
        "portfolio_id": p.portfolio_id,
        "ticker": p.ticker,
        "current_shares": round(p.current_shares, 4),
        "current_average_cost": round(p.current_average_cost, 4),
        "new_shares": round(p.new_shares, 4),
        "new_average_cost": round(p.new_average_cost, 4),
        "applicable": p.applicable,
        "reason": p.reason,
    }


@router.get("/corporate-actions")
def list_corporate_actions(
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Bilinen bedelsiz/bölünme işlemleri ve her birinin kaç pozisyonu
    etkileyeceği - superuser only."""
    out = []
    for action in corporate_actions.CORPORATE_ACTIONS:
        plans = corporate_actions.plan_adjustments(db, action)
        out.append({
            "ticker": action.ticker,
            "ratio": action.ratio,
            "ex_date": action.ex_date.isoformat(),
            "description": action.description,
            "affected_count": sum(1 for p in plans if p.applicable),
            "total_positions": len(plans),
        })
    return {"actions": out}


@router.get("/corporate-actions/kap-candidates")
def list_kap_corporate_action_candidates(
    days: int = 30,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Son KAP bildirimlerinde geçen olası bedelsiz/bölünme duyuruları.

    Bunlar SADECE aday: oran serbest metinden tahmin edildiği için yanlış
    olabilir, o yüzden hiçbiri otomatik uygulanmaz. Amaç, yeni bir bedelsizi
    kimse fark etmediği için kullanıcıların portföyünün sessizce yanlış
    kalmasını önlemek - listede bir şey görünüyorsa doğrulanıp
    corporate_actions.py'ye eklenmesi gerekiyor."""
    return {"candidates": corporate_actions.detect_candidates_from_kap(db, days=days)}


@router.get("/corporate-actions/{ticker}/preview")
def preview_corporate_action(
    ticker: str,
    db: Session = Depends(deps.get_db),
    _admin: User = Depends(deps.get_current_active_superuser),
):
    """Uygulamadan ÖNCE hangi pozisyonun nasıl değişeceğini gösterir -
    hiçbir şeyi değiştirmez."""
    action = corporate_actions.get_action(ticker)
    if not action:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu hisse için tanımlı kurumsal işlem yok.")
    plans = corporate_actions.plan_adjustments(db, action)
    return {
        "ticker": action.ticker,
        "ratio": action.ratio,
        "ex_date": action.ex_date.isoformat(),
        "description": action.description,
        "plans": [_plan_dict(p) for p in plans],
    }


@router.post("/corporate-actions/{ticker}/apply")
@limiter.limit("10/minute")
def apply_corporate_action(
    request: Request,
    ticker: str,
    db: Session = Depends(deps.get_db),
    admin: User = Depends(deps.get_current_active_superuser),
):
    """Bedelsiz/bölünme oranını uygulanabilir pozisyonlara uygular: lot
    sayısı oran kadar artar, ortalama maliyet aynı oranda düşer (toplam
    maliyet sabit kalır) ve her pozisyon için deftere BONUS hareketi yazılır.

    Tekrar çalıştırmak güvenlidir: uygulanmış pozisyonlar BONUS kaydından
    tanınıp atlanır."""
    action = corporate_actions.get_action(ticker)
    if not action:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Bu hisse için tanımlı kurumsal işlem yok.")

    plans = corporate_actions.apply_action(db, action)
    applied = [p for p in plans if p.applicable]

    log_audit(db, "corporate_action_applied", request=request, user_id=admin.id,
              resource_type="corporate_action", resource_id=action.ticker,
              details={
                  "ticker": action.ticker, "ratio": action.ratio,
                  "ex_date": action.ex_date.isoformat(),
                  "applied_count": len(applied), "total_positions": len(plans),
              })

    return {
        "ticker": action.ticker,
        "ratio": action.ratio,
        "applied_count": len(applied),
        "skipped_count": len(plans) - len(applied),
        "plans": [_plan_dict(p) for p in plans],
    }
