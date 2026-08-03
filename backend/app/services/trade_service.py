import logging
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, date, timedelta
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.trade import TradeAccount, TradePosition, TradeOrder, TradeDailySnapshot, TradePendingOrder
from app.services.market_data import market_data_service

logger = logging.getLogger(__name__)

DEFAULT_STARTING_BALANCE = 325000.0

# Typical Turkish brokerage commission approximation (0.10% per side, applied
# to notional value on both buys and sells). Purely for a realistic-feeling
# simulation - not tied to any real broker's actual fee schedule.
COMMISSION_RATE = 0.001

VALID_BROKERS = {"info_yatirim", "midas"}

# Trade module supports BIST30 only, per spec. This mirrors the "core 30" of
# market_data.py's own tracked ticker list (which appends a handful of extra
# small/mid-cap names after these) - kept as its own explicit constant here
# rather than importing/slicing that list, so this module's instrument
# universe stays intentional and doesn't silently drift if market_data.py's
# list changes for unrelated reasons.
BIST30_TICKERS = [
    "AKBNK", "ALARK", "ASELS", "ASTOR", "BIMAS", "EKGYO", "ENKAI", "EREGL", "FROTO", "GARAN",
    "HEKTS", "ISCTR", "KCHOL", "KONTR", "KOZAL", "MGROS", "ODAS", "OYAKC", "PETKM", "PGSUS",
    "SAHOL", "SASA", "SISE", "TAVHL", "TCELL", "THYAO", "TOASO", "TUPRS", "YKBNK", "TTKOM",
]

BIST30_NAMES = {
    "AKBNK": "Akbank T.A.Ş.", "ALARK": "Alarko Holding A.Ş.", "ASELS": "Aselsan Elektronik Sanayi",
    "ASTOR": "Astor Enerji A.Ş.", "BIMAS": "BİM Birleşik Mağazalar", "EKGYO": "Emlak Konut GYO",
    "ENKAI": "Enka İnşaat ve Sanayi", "EREGL": "Ereğli Demir ve Çelik", "FROTO": "Ford Otomotiv Sanayi",
    "GARAN": "Türkiye Garanti Bankası", "HEKTS": "Hektaş Ticaret T.A.Ş.", "ISCTR": "Türkiye İş Bankası C",
    "KCHOL": "Koç Holding A.Ş.", "KONTR": "Kontrolmatik Teknoloji", "KOZAL": "Koza Altın İşletmeleri",
    "MGROS": "Migros Ticaret A.Ş.", "ODAS": "Odaş Elektrik Üretim", "OYAKC": "Oyak Çimento Fabrikaları",
    "PETKM": "Petkim Petrokimya Holding", "PGSUS": "Pegasus Hava Taşımacılığı", "SAHOL": "Hacı Ömer Sabancı Holding",
    "SASA": "Sasa Polyester Sanayi", "SISE": "Türkiye Şişe ve Cam Fabrikaları", "TAVHL": "TAV Havalimanları Holding",
    "TCELL": "Turkcell İletişim Hizmetleri", "THYAO": "Türk Hava Yolları A.O.", "TOASO": "Tofaş Türk Otomobil Fabrikası",
    "TUPRS": "Tüpraş Türkiye Petrol Rafinerileri", "YKBNK": "Yapı ve Kredi Bankası", "TTKOM": "Türk Telekomünikasyon",
}

# VİOP "contracts": the app is asked not to add a new data source and to keep
# using the existing websocket infrastructure. There's no confirmed live BIST
# VİOP futures feed already wired into borsapy/TradingViewStream, so each
# contract here tracks its real, already-subscribed underlying spot
# instrument and is clearly presented as a near-month (yakın vade) proxy
# contract rather than pretending to be a distinct exchange-traded future.
VIOP_CONTRACTS = [
    {"code": "XU030F", "name": "XU030 Yakın Vade Kontratı", "underlying_symbol": "XU030"},
    {"code": "USDTRYF", "name": "USD/TRY Yakın Vade Kontratı", "underlying_symbol": "USDTRY"},
    {"code": "EURTRYF", "name": "EUR/TRY Yakın Vade Kontratı", "underlying_symbol": "EURTRY"},
    {"code": "XAUTRYF", "name": "Gram Altın Yakın Vade Kontratı", "underlying_symbol": "XAUTRYG"},
    {"code": "XAUUSDF", "name": "Ons Altın Yakın Vade Kontratı", "underlying_symbol": "XAUUSD"},
    {"code": "XU030ENDF", "name": "BIST30 Endeks Kontratı", "underlying_symbol": "XU030"},
] + [
    # BIST30 hisse yakın vade kontratları - VİOP30 setine karşılık gelir.
    # Yeni bir kontrat eklemek bu listeye bir satır eklemek kadar basit.
    {"code": f"{ticker}F", "name": f"{ticker} Yakın Vade Kontratı", "underlying_symbol": ticker}
    for ticker in BIST30_TICKERS
]
VIOP_BY_CODE = {c["code"]: c for c in VIOP_CONTRACTS}


class TradeError(Exception):
    """Raised for user-facing trade validation errors (insufficient balance,
    invalid symbol, etc.) - the API layer maps these to HTTP 400s."""
    pass


def _underlying_symbol(instrument_type: str, symbol: str) -> str:
    if instrument_type == "viop":
        contract = VIOP_BY_CODE.get(symbol)
        return contract["underlying_symbol"] if contract else symbol
    return symbol


# The gold VİOP contracts (XAUUSDF/XAUTRYF) chart TVC:GOLD in the frontend
# (see TradeChart.tsx - TVC:GOLD is the symbol that actually resolves in
# TradingView's embedded widget, whereas FX_IDC:XAUUSD does not). Pricing and
# P&L for these two contracts must be pulled from that exact same feed,
# otherwise the trade price and the chart the user is looking at quote two
# different (both legitimate) TradingView gold sources a few points apart -
# this was the reported "cost 4074, chart shows 4077" bug. Every other use of
# XAUUSD/XAUTRYG in the app (Header, screener, etc.) is untouched and keeps
# using the FX_IDC feed as before.
_QUOTE_SYMBOL_OVERRIDES = {
    "XAUUSD": "GOLD",
    "XAUTRYG": "GOLD",
}


def _quote_symbol(underlying: str) -> str:
    return _QUOTE_SYMBOL_OVERRIDES.get(underlying, underlying)


def get_live_price(instrument_type: str, symbol: str) -> float:
    """Live price straight from the existing TradingView websocket cache -
    no new data source, exactly as instructed."""
    lookup = _quote_symbol(_underlying_symbol(instrument_type, symbol))
    quote = market_data_service.get_quote(lookup)
    if not quote:
        return 0.0
    last = quote.get("last")
    return float(last) if last else 0.0


def _quote_or_zero(symbol: str) -> Dict[str, Any]:
    q = market_data_service.get_quote(_quote_symbol(symbol))
    return q or {}


def get_accounts(db: Session, user_id: int) -> List[TradeAccount]:
    """All of a user's paper-trading accounts, oldest first - a user can run
    several in parallel (e.g. one per strategy); see TradeAccount's
    docstring for the history of this no longer being 1:1 with user_id."""
    return (
        db.query(TradeAccount)
        .filter(TradeAccount.user_id == user_id)
        .order_by(TradeAccount.id.asc())
        .all()
    )


def get_account(db: Session, user_id: int) -> Optional[TradeAccount]:
    """The user's default account (their first one, chronologically) - used
    wherever no specific account_id is given, keeping every pre-multi-account
    API call and the original onboarding flow working unchanged."""
    return db.query(TradeAccount).filter(TradeAccount.user_id == user_id).order_by(TradeAccount.id.asc()).first()


def get_account_by_id(db: Session, user_id: int, account_id: int) -> Optional[TradeAccount]:
    """Ownership-checked lookup for a specific account - callers must never
    fetch by account_id alone, or one user could act on another's account."""
    return db.query(TradeAccount).filter(
        TradeAccount.id == account_id, TradeAccount.user_id == user_id
    ).first()


def create_account(
    db: Session, user_id: int, broker: str, starting_balance: float, name: Optional[str] = None
) -> TradeAccount:
    if broker not in VALID_BROKERS:
        raise TradeError("Geçersiz broker seçimi.")
    if starting_balance <= 0:
        starting_balance = DEFAULT_STARTING_BALANCE
    if not name:
        existing_count = db.query(TradeAccount).filter(TradeAccount.user_id == user_id).count()
        name = f"Portföy {existing_count + 1}"

    account = TradeAccount(
        user_id=user_id,
        name=name,
        broker=broker,
        starting_balance=starting_balance,
        cash_balance=starting_balance,
    )
    db.add(account)
    db.commit()
    db.refresh(account)
    return account


def rename_account(db: Session, account: TradeAccount, name: str) -> TradeAccount:
    if not name or not name.strip():
        raise TradeError("Portföy adı boş olamaz.")
    account.name = name.strip()
    db.commit()
    db.refresh(account)
    return account


def delete_account(db: Session, account: TradeAccount) -> None:
    """Permanently removes an account and everything under it (positions,
    orders, pending orders, snapshots - all cascade via the FK). A user must
    always keep at least one account; the API layer enforces that before
    calling this, since that check needs to know how many accounts the user
    has in total, not just this one."""
    db.delete(account)
    db.commit()


def change_broker(db: Session, account: TradeAccount, broker: str) -> TradeAccount:
    """Lets the user switch broker cards later without wiping their
    simulated portfolio - purely cosmetic, since both brokers run the exact
    same simulated system per the spec."""
    if broker not in VALID_BROKERS:
        raise TradeError("Geçersiz broker seçimi.")
    account.broker = broker
    db.commit()
    db.refresh(account)
    return account


def reset_account(db: Session, account: TradeAccount, starting_balance: float) -> TradeAccount:
    """Full restart: wipes all positions/orders/snapshots and reseeds the
    cash balance. A deliberate, separate action from change_broker so
    switching the broker card never silently destroys trade history."""
    if starting_balance <= 0:
        starting_balance = DEFAULT_STARTING_BALANCE
    db.query(TradePosition).filter(TradePosition.account_id == account.id).delete()
    db.query(TradeOrder).filter(TradeOrder.account_id == account.id).delete()
    db.query(TradeDailySnapshot).filter(TradeDailySnapshot.account_id == account.id).delete()
    account.starting_balance = starting_balance
    account.cash_balance = starting_balance
    db.commit()
    db.refresh(account)
    return account


def deposit_funds(db: Session, account: TradeAccount, amount: float) -> TradeAccount:
    """Adds cash to the simulated account. `starting_balance` (the baseline
    "return_pct" is measured against) is increased by the same amount, so a
    deposit isn't misread as trading profit - it's new capital, not a gain."""
    if amount is None or amount <= 0:
        raise TradeError("Yatırılacak tutar sıfırdan büyük olmalı.")
    account.cash_balance += amount
    account.starting_balance += amount
    db.commit()
    db.refresh(account)
    return account


def _bid_ask(q: Dict[str, Any], last: float) -> tuple[float, float]:
    """Real bid/ask when the live quote has them; otherwise a small synthetic
    spread around last price so the order panel always has something
    sensible to show instead of blank fields."""
    bid = q.get("bid")
    ask = q.get("ask")
    if bid and ask:
        return float(bid), float(ask)
    if last <= 0:
        return 0.0, 0.0
    spread = last * 0.0005
    return round(last - spread, 4), round(last + spread, 4)


def get_watchlist() -> List[Dict[str, Any]]:
    items = []
    for ticker in BIST30_TICKERS:
        q = _quote_or_zero(ticker)
        last = float(q.get("last") or 0.0)
        bid, ask = _bid_ask(q, last)
        items.append({
            "symbol": ticker,
            "name": BIST30_NAMES.get(ticker, ticker),
            "price": last,
            "change_percent": float(q.get("change_percent") or 0.0),
            "bid": bid,
            "ask": ask,
        })
    return items


def get_viop_watchlist() -> List[Dict[str, Any]]:
    items = []
    for c in VIOP_CONTRACTS:
        q = _quote_or_zero(c["underlying_symbol"])
        last = float(q.get("last") or 0.0)
        bid, ask = _bid_ask(q, last)
        items.append({
            "symbol": c["code"],
            "name": c["name"],
            "price": last,
            "change_percent": float(q.get("change_percent") or 0.0),
            "bid": bid,
            "ask": ask,
            "underlying_symbol": c["underlying_symbol"],
        })
    return items


def _fetch_prices_concurrently(positions: List[TradePosition]) -> List[float]:
    """Fetch every position's live price at once instead of one at a time -
    each is an independent lookup against the market-data cache, so this
    also avoids serial latency stacking up when an account has several open
    positions (get_positions/serialize_account are hit every few seconds by
    the frontend's polling)."""
    if not positions:
        return []
    with ThreadPoolExecutor(max_workers=min(len(positions), 8)) as pool:
        return list(pool.map(lambda p: get_live_price(p.instrument_type, p.symbol), positions))


def _position_dict(pos: TradePosition, price: Optional[float] = None) -> Dict[str, Any]:
    """
    VİOP positions can be short: represented internally as a NEGATIVE lot
    (no separate DB column needed). Stock positions are always long
    (lot > 0) - this app doesn't support shorting stocks, only VİOP.

    position_value always reports the *magnitude* of notional exposure (so
    it sums correctly into stock/viop totals and "Kullanılan Teminat"
    regardless of direction); pnl flips sign for shorts, since a short
    profits when price falls.

    `price` can be a pre-fetched value (see _fetch_prices_concurrently) to
    avoid a redundant lookup. If the live quote is unavailable (0 - see
    get_live_price), this falls back to the position's own avg_cost instead
    of 0 - previously a single momentarily-missing quote (e.g. TradingView
    not yet subscribed to that symbol) priced the whole position at 0,
    which made "Toplam Portföy"/"Kullanılan Teminat" swing wildly and showed
    a huge fake loss until the next successful poll.
    """
    if price is None:
        price = get_live_price(pos.instrument_type, pos.symbol)
    if price <= 0:
        price = pos.avg_cost
    is_short = pos.lot < 0
    abs_lot = abs(pos.lot)
    value = price * abs_lot
    cost_value = pos.avg_cost * abs_lot
    pnl = (pos.avg_cost - price) * abs_lot if is_short else (price - pos.avg_cost) * abs_lot
    pnl_pct = (pnl / cost_value * 100) if cost_value > 0 else 0.0
    return {
        "id": pos.id,
        "instrument_type": pos.instrument_type,
        "symbol": pos.symbol,
        "position_side": "SHORT" if is_short else "LONG",
        "lot": abs_lot,
        "avg_cost": round(pos.avg_cost, 4),
        "current_price": round(price, 4),
        "position_value": round(value, 2),
        "pnl": round(pnl, 2),
        "pnl_pct": round(pnl_pct, 2),
    }


def get_positions(db: Session, account: TradeAccount, instrument_type: Optional[str] = None) -> List[Dict[str, Any]]:
    q = db.query(TradePosition).filter(TradePosition.account_id == account.id)
    if instrument_type:
        q = q.filter(TradePosition.instrument_type == instrument_type)
    positions = q.all()
    prices = _fetch_prices_concurrently(positions)
    return [_position_dict(p, price) for p, price in zip(positions, prices)]


def _ensure_daily_snapshot(db: Session, account: TradeAccount, current_equity: float) -> TradeDailySnapshot:
    """Get-or-create today's opening equity snapshot. Created lazily on the
    first request of a new calendar day, using that moment's equity as the
    day's baseline (see TradeDailySnapshot docstring for why this is an
    approximation rather than a true market-open snapshot)."""
    today = date.today()
    snap = db.query(TradeDailySnapshot).filter(
        TradeDailySnapshot.account_id == account.id,
        TradeDailySnapshot.snapshot_date == today,
    ).first()
    if not snap:
        snap = TradeDailySnapshot(account_id=account.id, snapshot_date=today, equity_value=current_equity)
        db.add(snap)
        db.commit()
        db.refresh(snap)
    return snap


def account_summary_dict(account: TradeAccount) -> Dict[str, Any]:
    """Lightweight, no-live-price-fetch representation for GET /accounts -
    listing several accounts shouldn't cost a live price lookup per account
    per position; callers switch to serialize_account for the full picture
    once a specific account is selected."""
    return {
        "id": account.id,
        "name": account.name,
        "broker": account.broker,
        "starting_balance": round(account.starting_balance, 2),
        "created_at": account.created_at.isoformat() if account.created_at else None,
    }


def serialize_account(db: Session, account: TradeAccount) -> Dict[str, Any]:
    _check_pending_orders(db, account)

    positions = db.query(TradePosition).filter(TradePosition.account_id == account.id).all()
    prices = _fetch_prices_concurrently(positions)
    pos_dicts = [_position_dict(p, price) for p, price in zip(positions, prices)]

    stock_value = sum(p["position_value"] for p in pos_dicts if p["instrument_type"] == "stock")
    viop_value = sum(p["position_value"] for p in pos_dicts if p["instrument_type"] == "viop")
    # Simplification: VİOP positions are fully cash-funded in this simulation
    # (no real leverage mechanics), so "Kullanılan Teminat" is reported as the
    # notional value currently tied up in open VİOP positions.
    used_margin = viop_value

    total_portfolio_value = account.cash_balance + stock_value + viop_value
    unrealized_pnl = sum(p["pnl"] for p in pos_dicts)
    # See get_performance/get_tax_report - realized_pnl can land on an AL
    # order (covering a VİOP short), not just SAT.
    realized_pnl_total = db.query(TradeOrder).filter(
        TradeOrder.account_id == account.id, TradeOrder.realized_pnl.isnot(None)
    ).with_entities(TradeOrder.realized_pnl).all()
    realized_pnl_sum = sum((r[0] or 0.0) for r in realized_pnl_total)
    total_pnl = unrealized_pnl + realized_pnl_sum

    snapshot = _ensure_daily_snapshot(db, account, total_portfolio_value)
    daily_pnl = total_portfolio_value - snapshot.equity_value

    return_pct = (
        (total_portfolio_value - account.starting_balance) / account.starting_balance * 100
        if account.starting_balance > 0 else 0.0
    )

    return {
        "id": account.id,
        "name": account.name,
        "broker": account.broker,
        "starting_balance": round(account.starting_balance, 2),
        "cash_balance": round(account.cash_balance, 2),
        "locked_cash": round(account.locked_cash, 2),
        "available_cash": round(account.cash_balance - account.locked_cash, 2),
        "stock_position_value": round(stock_value, 2),
        "viop_position_value": round(viop_value, 2),
        "used_margin": round(used_margin, 2),
        "total_portfolio_value": round(total_portfolio_value, 2),
        "daily_pnl": round(daily_pnl, 2),
        "total_pnl": round(total_pnl, 2),
        "unrealized_pnl": round(unrealized_pnl, 2),
        "realized_pnl": round(realized_pnl_sum, 2),
        "return_pct": round(return_pct, 2),
        "positions": pos_dicts,
    }


def _execute_trade(
    db: Session, account: TradeAccount, instrument_type: str, symbol: str, side: str, lot: float, price: float
) -> tuple[Optional[float], float, float]:
    """Core buy/sell mutation shared by market orders (place_order) and
    limit-order fills (_fill_pending_order) - identical position/cash
    bookkeeping either way, the only difference is where `price` comes from
    (live quote vs. a resting order's limit_price). Returns
    (realized_pnl, total, commission) for the TradeOrder history row. Raises
    TradeError on insufficient balance/position; callers that can't surface
    a synchronous error (limit fills happening on a background poll) should
    catch it and cancel the order instead of crashing the poll."""
    notional = price * lot
    commission = round(notional * COMMISSION_RATE, 2)

    position = db.query(TradePosition).filter(
        TradePosition.account_id == account.id,
        TradePosition.instrument_type == instrument_type,
        TradePosition.symbol == symbol,
    ).first()

    realized_pnl = None
    # Internally, a VİOP position's `lot` column can be negative to represent
    # a short (no separate DB column needed - see _position_dict). Stocks
    # never go negative here; this app only supports shorting VİOP contracts.
    is_currently_short = bool(position and position.lot < 0)

    if side == "AL":
        if instrument_type == "viop" and is_currently_short:
            # Covering (buying back) an existing short.
            short_size = abs(position.lot)
            if lot > short_size + 1e-9:
                raise TradeError(
                    "Bu miktar mevcut kısa pozisyonunuzdan fazla. Önce mevcut kısa pozisyonu "
                    "kapatın, ardından yeni bir long pozisyon için ayrı bir emir girin."
                )
            total_cost = notional + commission
            if total_cost > account.cash_balance:
                raise TradeError("Yetersiz bakiye.")
            account.cash_balance -= total_cost
            realized_pnl = round((position.avg_cost - price) * lot - commission, 2)
            position.lot += lot  # moves toward 0, e.g. -5 + 3 = -2
            if abs(position.lot) <= 1e-6:
                db.delete(position)
            total = total_cost
        else:
            # Normal long buy (opening or adding to a long position).
            total_cost = notional + commission
            if total_cost > account.cash_balance:
                raise TradeError("Yetersiz bakiye.")
            account.cash_balance -= total_cost
            if position:
                new_lot = position.lot + lot
                position.avg_cost = ((position.avg_cost * position.lot) + notional) / new_lot
                position.lot = new_lot
            else:
                position = TradePosition(
                    account_id=account.id, instrument_type=instrument_type,
                    symbol=symbol, lot=lot, avg_cost=price,
                )
                db.add(position)
            total = total_cost
    elif side == "SAT":
        has_long = bool(position and position.lot > 0)
        if has_long:
            # Closing (fully or partially) an existing long position.
            if lot > position.lot + 1e-9:
                raise TradeError("Yetersiz pozisyon - satılacak lot mevcut pozisyondan fazla.")
            realized_pnl = round((price - position.avg_cost) * lot - commission, 2)
            proceeds = notional - commission
            account.cash_balance += proceeds
            position.lot -= lot
            if position.lot <= 1e-6:
                db.delete(position)
            total = proceeds
        elif instrument_type == "viop":
            # Opening or adding to a short - only allowed for VİOP, per spec.
            # Selling short receives proceeds now (like a real short sale);
            # covering it later (AL, above) pays them back plus/minus P&L.
            proceeds = notional - commission
            account.cash_balance += proceeds
            if position and position.lot < 0:
                new_short_lot = abs(position.lot) + lot
                position.avg_cost = ((position.avg_cost * abs(position.lot)) + notional) / new_short_lot
                position.lot = -new_short_lot
            else:
                position = TradePosition(
                    account_id=account.id, instrument_type=instrument_type,
                    symbol=symbol, lot=-lot, avg_cost=price,
                )
                db.add(position)
            total = proceeds
        else:
            raise TradeError("Yetersiz pozisyon - satılacak lot mevcut pozisyondan fazla.")
    else:
        raise TradeError("Geçersiz işlem yönü.")

    return realized_pnl, total, commission


def _create_pending_order(
    db: Session, account: TradeAccount, instrument_type: str, symbol: str, side: str, lot: float,
    order_type: str, limit_price: Optional[float], stop_price: Optional[float],
) -> Dict[str, Any]:
    # The best available estimate of execution price before the order
    # actually fills, used only to size the cash reservation: the limit
    # price constrains LIMIT/STOP_LIMIT exactly, while a plain STOP has no
    # such constraint (it fills at whatever the live price is once
    # triggered) so its own trigger price is the closest estimate on hand.
    reservation_price = limit_price if order_type in ("LIMIT", "STOP_LIMIT") else stop_price

    reserved = 0.0
    if side == "AL":
        notional = reservation_price * lot
        commission_est = round(notional * COMMISSION_RATE, 2)
        reserved = round(notional + commission_est, 2)
        available = account.cash_balance - account.locked_cash
        if reserved > available:
            raise TradeError("Yetersiz bakiye.")
        account.locked_cash += reserved
    elif side == "SAT":
        position = db.query(TradePosition).filter(
            TradePosition.account_id == account.id,
            TradePosition.instrument_type == instrument_type,
            TradePosition.symbol == symbol,
        ).first()
        has_long = bool(position and position.lot > 0)
        # Stocks are long-only, so a resting SAT needs an existing covering
        # position up front (re-checked again at fill time in case it
        # changes in the meantime). VİOP can open/add to a short with no
        # reservation, mirroring place_order's market-order behavior.
        if instrument_type == "stock" and not (has_long and position.lot >= lot - 1e-9):
            raise TradeError("Yetersiz pozisyon - satılacak lot mevcut pozisyondan fazla.")
    else:
        raise TradeError("Geçersiz işlem yönü.")

    pending = TradePendingOrder(
        account_id=account.id, instrument_type=instrument_type, symbol=symbol,
        side=side, lot=lot, order_type=order_type, limit_price=limit_price, stop_price=stop_price,
        reserved_cash=reserved, status="PENDING",
    )
    db.add(pending)
    db.commit()
    db.refresh(account)
    return serialize_account(db, account)


def _fill_pending_order(db: Session, account: TradeAccount, order: TradePendingOrder, fill_price: float) -> None:
    if order.side == "AL":
        account.locked_cash = max(0.0, account.locked_cash - order.reserved_cash)
    try:
        realized_pnl, total, commission = _execute_trade(
            db, account, order.instrument_type, order.symbol, order.side, order.lot, fill_price
        )
    except TradeError:
        # Underlying state no longer supports this fill (balance/position
        # changed via another order since this one was placed, or - for a
        # STOP that gapped past its trigger - the live price moved further
        # than the cash reserved for it) - cancel rather than retry forever
        # or raise from a background poll.
        order.status = "CANCELLED"
        db.commit()
        return

    order_row = TradeOrder(
        account_id=account.id, instrument_type=order.instrument_type, symbol=order.symbol,
        side=order.side, lot=order.lot, price=fill_price, commission=commission,
        total=round(total, 2), realized_pnl=realized_pnl,
    )
    db.add(order_row)
    order.status = "FILLED"
    order.filled_at = datetime.utcnow()
    db.commit()


def _check_pending_orders(db: Session, account: TradeAccount) -> None:
    """Checked opportunistically every time the account is polled (see
    serialize_account).

    - LIMIT: fills at limit_price once the live price reaches it or better
      (AL: price <= limit_price, SAT: price >= limit_price).
    - STOP: fills at the live price once it crosses stop_price in the
      breakout/adverse direction (AL: price >= stop_price, SAT: price <=
      stop_price) - a stop-loss or breakout-entry trigger.
    - STOP_LIMIT: on the same stop_price trigger as STOP, converts in place
      into a resting LIMIT order at limit_price instead of filling
      immediately - checked again (as a LIMIT) on the next poll.
    """
    pending = db.query(TradePendingOrder).filter(
        TradePendingOrder.account_id == account.id,
        TradePendingOrder.status == "PENDING",
    ).all()
    for order in pending:
        price = get_live_price(order.instrument_type, order.symbol)
        if price <= 0:
            continue

        if order.order_type == "LIMIT":
            should_fill = (
                (order.side == "AL" and price <= order.limit_price) or
                (order.side == "SAT" and price >= order.limit_price)
            )
            if should_fill:
                _fill_pending_order(db, account, order, order.limit_price)
        else:  # STOP or STOP_LIMIT
            triggered = (
                (order.side == "AL" and price >= order.stop_price) or
                (order.side == "SAT" and price <= order.stop_price)
            )
            if not triggered:
                continue
            if order.order_type == "STOP":
                _fill_pending_order(db, account, order, price)
            else:  # STOP_LIMIT - becomes a resting LIMIT order from here on
                order.order_type = "LIMIT"
                db.commit()


def _pending_order_dict(o: TradePendingOrder) -> Dict[str, Any]:
    return {
        "id": o.id,
        "instrument_type": o.instrument_type,
        "symbol": o.symbol,
        "side": o.side,
        "lot": o.lot,
        "order_type": o.order_type,
        "limit_price": round(o.limit_price, 4) if o.limit_price is not None else None,
        "stop_price": round(o.stop_price, 4) if o.stop_price is not None else None,
        "created_at": o.created_at.isoformat() if o.created_at else None,
    }


def get_pending_orders(
    db: Session, account: TradeAccount, instrument_type: Optional[str] = None
) -> List[Dict[str, Any]]:
    q = db.query(TradePendingOrder).filter(
        TradePendingOrder.account_id == account.id,
        TradePendingOrder.status == "PENDING",
    )
    if instrument_type:
        q = q.filter(TradePendingOrder.instrument_type == instrument_type)
    orders = q.order_by(TradePendingOrder.created_at.desc()).all()
    return [_pending_order_dict(o) for o in orders]


def cancel_pending_order(db: Session, account: TradeAccount, order_id: int) -> Dict[str, Any]:
    order = db.query(TradePendingOrder).filter(
        TradePendingOrder.id == order_id,
        TradePendingOrder.account_id == account.id,
        TradePendingOrder.status == "PENDING",
    ).first()
    if not order:
        raise TradeError("Bekleyen emir bulunamadı.")
    if order.side == "AL":
        account.locked_cash = max(0.0, account.locked_cash - order.reserved_cash)
    order.status = "CANCELLED"
    db.commit()
    db.refresh(account)
    return serialize_account(db, account)


def place_order(
    db: Session, account: TradeAccount, instrument_type: str, symbol: str, side: str, lot: float,
    order_type: str = "MARKET", limit_price: Optional[float] = None, stop_price: Optional[float] = None,
) -> Dict[str, Any]:
    symbol = symbol.upper()

    if instrument_type == "stock" and symbol not in BIST30_TICKERS:
        raise TradeError("Trade modülü şu an sadece BIST30 hisselerini destekliyor.")
    if instrument_type == "viop" and symbol not in VIOP_BY_CODE:
        raise TradeError("Geçersiz VİOP kontratı.")
    if lot is None or lot <= 0:
        raise TradeError("Lot miktarı sıfırdan büyük olmalı.")

    if order_type in ("LIMIT", "STOP", "STOP_LIMIT"):
        if order_type in ("LIMIT", "STOP_LIMIT") and (limit_price is None or limit_price <= 0):
            raise TradeError("Limit fiyatı sıfırdan büyük olmalı.")
        if order_type in ("STOP", "STOP_LIMIT") and (stop_price is None or stop_price <= 0):
            raise TradeError("Stop fiyatı sıfırdan büyük olmalı.")
        return _create_pending_order(db, account, instrument_type, symbol, side, lot, order_type, limit_price, stop_price)

    price = get_live_price(instrument_type, symbol)
    if price <= 0:
        raise TradeError("Anlık fiyat alınamadı, lütfen birkaç saniye sonra tekrar deneyin.")

    realized_pnl, total, commission = _execute_trade(db, account, instrument_type, symbol, side, lot, price)

    order = TradeOrder(
        account_id=account.id, instrument_type=instrument_type, symbol=symbol,
        side=side, lot=lot, price=price, commission=commission, total=round(total, 2),
        realized_pnl=realized_pnl,
    )
    db.add(order)
    db.commit()
    db.refresh(account)

    return serialize_account(db, account)


def get_history(db: Session, account: TradeAccount, limit: int = 100) -> List[Dict[str, Any]]:
    orders = (
        db.query(TradeOrder)
        .filter(TradeOrder.account_id == account.id)
        .order_by(TradeOrder.executed_at.desc())
        .limit(limit)
        .all()
    )
    return [
        {
            "id": o.id,
            "instrument_type": o.instrument_type,
            "symbol": o.symbol,
            "side": o.side,
            "lot": o.lot,
            "price": round(o.price, 4),
            "commission": round(o.commission, 2),
            "total": round(o.total, 2),
            "realized_pnl": round(o.realized_pnl, 2) if o.realized_pnl is not None else None,
            "executed_at": o.executed_at.isoformat() if o.executed_at else None,
        }
        for o in orders
    ]


def get_tax_report(
    db: Session, account: TradeAccount, stock_stopaj_pct: float = 0.0, viop_stopaj_pct: float = 10.0
) -> Dict[str, Any]:
    """Realized gain/loss broken down by calendar year and instrument type,
    for informational year-end review - NOT a tax filing and not advice.

    stock_stopaj_pct/viop_stopaj_pct are caller-supplied percentages, not
    hardcoded law: BIST stock gains and VİOP gains have long been taxed
    differently under Turkish withholding rules (stopaj), and the exact
    rates are set by government decree and do change - baking in a
    specific number here would silently go stale and mislead. The commonly
    cited long-standing defaults (0% for BIST-listed shares sold through a
    licensed intermediary, 10% for VİOP) are used only as pre-filled
    suggestions; the frontend must let the user override them and must
    label the result as an estimate to verify against official sources.
    """
    # realized_pnl lands on whichever order actually closed/reduced a
    # position - a SAT for closing a long, but an AL for covering a VİOP
    # short (see _execute_trade) - so this must not filter by side=="SAT"
    # alone, or every VİOP short-cover trade's P&L is silently dropped.
    closing_orders = (
        db.query(TradeOrder)
        .filter(TradeOrder.account_id == account.id, TradeOrder.realized_pnl.isnot(None))
        .order_by(TradeOrder.executed_at.asc())
        .all()
    )

    by_year: Dict[int, Dict[str, Any]] = {}
    for o in closing_orders:
        if not o.executed_at or o.realized_pnl is None:
            continue
        year = o.executed_at.year
        bucket = by_year.setdefault(year, {
            "year": year,
            "stock_realized_pnl": 0.0,
            "stock_trade_count": 0,
            "viop_realized_pnl": 0.0,
            "viop_trade_count": 0,
        })
        if o.instrument_type == "stock":
            bucket["stock_realized_pnl"] += o.realized_pnl
            bucket["stock_trade_count"] += 1
        else:
            bucket["viop_realized_pnl"] += o.realized_pnl
            bucket["viop_trade_count"] += 1

    years = []
    for year in sorted(by_year.keys(), reverse=True):
        b = by_year[year]
        # Stopaj only applies to gains, not losses - a losing year owes
        # nothing, it isn't refunded either (this mirrors how stopaj is
        # actually withheld at the source, per trade, not netted first).
        stock_stopaj_est = max(0.0, b["stock_realized_pnl"]) * stock_stopaj_pct / 100
        viop_stopaj_est = max(0.0, b["viop_realized_pnl"]) * viop_stopaj_pct / 100
        total_realized = b["stock_realized_pnl"] + b["viop_realized_pnl"]
        total_stopaj_est = stock_stopaj_est + viop_stopaj_est
        years.append({
            "year": year,
            "stock_realized_pnl": round(b["stock_realized_pnl"], 2),
            "stock_trade_count": b["stock_trade_count"],
            "stock_stopaj_estimate": round(stock_stopaj_est, 2),
            "viop_realized_pnl": round(b["viop_realized_pnl"], 2),
            "viop_trade_count": b["viop_trade_count"],
            "viop_stopaj_estimate": round(viop_stopaj_est, 2),
            "total_realized_pnl": round(total_realized, 2),
            "total_stopaj_estimate": round(total_stopaj_est, 2),
            "net_after_stopaj_estimate": round(total_realized - total_stopaj_est, 2),
        })

    return {
        "stock_stopaj_pct": stock_stopaj_pct,
        "viop_stopaj_pct": viop_stopaj_pct,
        "years": years,
    }


def get_performance(db: Session, account: TradeAccount) -> Dict[str, Any]:
    # See get_tax_report's comment: realized_pnl can land on an AL order
    # (covering a VİOP short), not just SAT - filtering by side=="SAT" alone
    # silently drops those trades from win-rate/realized P&L.
    closing_orders = (
        db.query(TradeOrder)
        .filter(TradeOrder.account_id == account.id, TradeOrder.realized_pnl.isnot(None))
        .order_by(TradeOrder.executed_at.asc())
        .all()
    )
    wins = [o.realized_pnl for o in closing_orders if (o.realized_pnl or 0.0) > 0]
    losses = [o.realized_pnl for o in closing_orders if (o.realized_pnl or 0.0) < 0]
    total_closed = len(closing_orders)
    win_rate = (len(wins) / total_closed * 100) if total_closed > 0 else 0.0

    realized_total = sum((o.realized_pnl or 0.0) for o in closing_orders)
    positions = db.query(TradePosition).filter(TradePosition.account_id == account.id).all()
    unrealized_total = sum(_position_dict(p)["pnl"] for p in positions)

    total_orders = db.query(TradeOrder).filter(TradeOrder.account_id == account.id).count()

    # Equity curve: daily snapshots accumulated so far, plus today's live
    # value as the most recent point. A brand-new account will only have a
    # single point until it's been open across a few days - that's expected,
    # this is real accumulated history rather than fabricated backfill.
    snapshots = (
        db.query(TradeDailySnapshot)
        .filter(TradeDailySnapshot.account_id == account.id)
        .order_by(TradeDailySnapshot.snapshot_date.asc())
        .all()
    )
    stock_value = sum(_position_dict(p)["position_value"] for p in positions if p.instrument_type == "stock")
    viop_value = sum(_position_dict(p)["position_value"] for p in positions if p.instrument_type == "viop")
    current_equity = account.cash_balance + stock_value + viop_value

    equity_curve = [{"date": s.snapshot_date.isoformat(), "equity": round(s.equity_value, 2)} for s in snapshots]
    today_str = date.today().isoformat()
    if not equity_curve or equity_curve[-1]["date"] != today_str:
        equity_curve.append({"date": today_str, "equity": round(current_equity, 2)})
    else:
        equity_curve[-1]["equity"] = round(current_equity, 2)

    peak = float("-inf")
    max_drawdown_pct = 0.0
    for point in equity_curve:
        peak = max(peak, point["equity"])
        if peak > 0:
            drawdown = (peak - point["equity"]) / peak * 100
            max_drawdown_pct = max(max_drawdown_pct, drawdown)

    return {
        "equity_curve": equity_curve,
        "win_rate_pct": round(win_rate, 2),
        "realized_pnl": round(realized_total, 2),
        "unrealized_pnl": round(unrealized_total, 2),
        "max_drawdown_pct": round(max_drawdown_pct, 2),
        "total_trades": total_orders,
        "closed_trades": total_closed,
        "avg_win": round(sum(wins) / len(wins), 2) if wins else 0.0,
        "avg_loss": round(sum(losses) / len(losses), 2) if losses else 0.0,
    }
