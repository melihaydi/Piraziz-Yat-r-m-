from typing import List
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.alert import Alert
from app.schemas.alert import AlertCreate, AlertResponse

router = APIRouter()

@router.get("/", response_model=List[AlertResponse])
def get_user_alerts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Retrieve all alerts set by the current user."""
    return db.query(Alert).filter(Alert.user_id == current_user.id).all()

@router.post("/", response_model=AlertResponse, status_code=status.HTTP_201_CREATED)
def create_alert(
    alert_in: AlertCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new alert (price, RSI, MACD, KAP etc.)."""
    db_alert = Alert(
        user_id=current_user.id,
        ticker=alert_in.ticker.upper() if alert_in.ticker else None,
        alert_type=alert_in.alert_type,
        trigger_condition=alert_in.trigger_condition,
        is_triggered=False,
        is_active=True
    )
    db.add(db_alert)
    db.commit()
    db.refresh(db_alert)
    return db_alert

@router.post("/{id}/toggle", response_model=AlertResponse)
def toggle_alert_status(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Toggle alert active status (active <-> inactive)."""
    db_alert = db.query(Alert).filter(Alert.id == id, Alert.user_id == current_user.id).first()
    if not db_alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        
    db_alert.is_active = not db_alert.is_active
    db.commit()
    db.refresh(db_alert)
    return db_alert

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_alert(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Delete an alert."""
    db_alert = db.query(Alert).filter(Alert.id == id, Alert.user_id == current_user.id).first()
    if not db_alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found")
        
    db.delete(db_alert)
    db.commit()
    return None

@router.post("/check", response_model=List[AlertResponse])
def check_and_trigger_alerts(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Scan all active untriggered alerts of the user, check conditions against live data, and trigger them (Request 4!)."""
    from datetime import datetime
    from app.services.market_data import market_data_service
    from app.services.technical_analysis import TechnicalAnalysisService
    from app.services.scoring import ScoringService

    active_alerts = db.query(Alert).filter(
        Alert.user_id == current_user.id,
        Alert.is_active == True,
        Alert.is_triggered == False
    ).all()

    # Fetch each distinct ticker's quote/candles once, concurrently, instead
    # of once per alert sequentially - a user with several alerts on the
    # same or different tickers previously paid for N sequential network
    # round-trips every 15s (Header.tsx polls this endpoint), one per alert.
    needs_candles_types = {"rsi", "macd", "ema", "sma", "ai_score", "volume_spike"}
    tickers = sorted({alert.ticker for alert in active_alerts if alert.ticker})

    # strategy_signal alerts don't need a per-ticker quote/candle fetch -
    # they compare against the Frantic Strateji engine's already-computed
    # signals, fetched once regardless of how many such alerts exist.
    signal_by_ticker = {}
    if any(alert.alert_type == "strategy_signal" for alert in active_alerts):
        from app.services.strategy_engine import strategy_engine
        signal_by_ticker = {s.ticker: s for s in strategy_engine.get_signals()}

    def _fetch_ticker_data(ticker: str):
        quote = market_data_service.get_quote(ticker)
        candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False) if quote else None
        return ticker, quote, candles

    data_by_ticker = {}
    if tickers:
        with ThreadPoolExecutor(max_workers=min(len(tickers), 5)) as pool:
            for ticker, quote, candles in pool.map(_fetch_ticker_data, tickers):
                data_by_ticker[ticker] = (quote, candles)

    triggered_alerts = []

    for alert in active_alerts:
        ticker = alert.ticker
        if not ticker:
            continue

        quote, all_candles = data_by_ticker.get(ticker, (None, None))
        if not quote:
            continue

        candles = all_candles if alert.alert_type in needs_candles_types else None

        is_triggered = False
        current_val_desc = ""
        
        op = alert.trigger_condition.get("operator", ">")
        val = float(alert.trigger_condition.get("value", 0.0))
        
        # 1. Price
        if alert.alert_type == "price":
            price = quote.get("last") or 0.0
            if op == ">" and price > val:
                is_triggered = True
            elif op == "<" and price < val:
                is_triggered = True
            current_val_desc = f"Fiyat: ₺{price:.2f}"
            
        # 2. RSI
        elif alert.alert_type == "rsi" and candles:
            closes = [c["close"] for c in candles]
            rsi_list = TechnicalAnalysisService.calculate_rsi(closes, 14)
            rsi = rsi_list[-1] if rsi_list and rsi_list[-1] is not None else 50.0
            if op == ">" and rsi > val:
                is_triggered = True
            elif op == "<" and rsi < val:
                is_triggered = True
            current_val_desc = f"RSI: {rsi:.1f}"
            
        # 3. MACD
        elif alert.alert_type == "macd" and candles:
            closes = [c["close"] for c in candles]
            macd_line, sig_line, _ = TechnicalAnalysisService.calculate_macd(closes)
            if macd_line and sig_line and macd_line[-1] is not None and sig_line[-1] is not None:
                macd_val = macd_line[-1]
                sig_val = sig_line[-1]
                if op == "AL" and macd_val > sig_val:
                    is_triggered = True
                elif op == "SAT" and macd_val < sig_val:
                    is_triggered = True
            current_val_desc = f"MACD Sinyali"
            
        # 4. EMA
        elif alert.alert_type == "ema" and candles:
            closes = [c["close"] for c in candles]
            ema_list = TechnicalAnalysisService.calculate_ema(closes, int(val) if val > 0 else 20)
            ema = ema_list[-1] if ema_list and ema_list[-1] is not None else 0.0
            price = closes[-1]
            if op == ">" and price > ema:
                is_triggered = True
            elif op == "<" and price < ema:
                is_triggered = True
            current_val_desc = f"Fiyat: ₺{price:.2f}, EMA: ₺{ema:.2f}"
            
        # 5. SMA
        elif alert.alert_type == "sma" and candles:
            closes = [c["close"] for c in candles]
            sma_list = TechnicalAnalysisService.calculate_sma(closes, int(val) if val > 0 else 20)
            sma = sma_list[-1] if sma_list and sma_list[-1] is not None else 0.0
            price = closes[-1]
            if op == ">" and price > sma:
                is_triggered = True
            elif op == "<" and price < sma:
                is_triggered = True
            current_val_desc = f"Fiyat: ₺{price:.2f}, SMA: ₺{sma:.2f}"
            
        # 6. AI Score
        elif alert.alert_type == "ai_score" and candles:
            details = ScoringService.calculate_ai_score_details(ticker, quote, candles)
            score = details.get("score", 50)
            if op == ">" and score > val:
                is_triggered = True
            elif op == "<" and score < val:
                is_triggered = True
            current_val_desc = f"AI Skoru: {score}"
            
        # 7. Daily Change
        elif alert.alert_type == "daily_change":
            change = quote.get("change_percent") or 0.0
            if op == ">" and change > val:
                is_triggered = True
            elif op == "<" and change < val:
                is_triggered = True
            current_val_desc = f"Günlük Değişim: %{change:+.2f}"
            
        # 8. KAP & News
        elif alert.alert_type in ["kap", "news"]:
            change = quote.get("change_percent") or 0.0
            if abs(change) > 3.0:
                is_triggered = True
            current_val_desc = "Yeni Bildirim/Haber Akışı"

        # 9. Volume spike - today's volume vs. the trailing 20-day average.
        # `value` is the multiplier (e.g. 2.0 = "2x the average"); defaults
        # to 2.0 if unset/zero since a spike alert with no threshold set is
        # meaningless.
        elif alert.alert_type == "volume_spike" and candles:
            volumes = [c["volume"] for c in candles if c.get("volume")]
            if len(volumes) >= 6:
                today_volume = volumes[-1]
                baseline = volumes[-21:-1] if len(volumes) >= 21 else volumes[:-1]
                avg_volume = sum(baseline) / len(baseline) if baseline else 0.0
                multiplier = val if val > 0 else 2.0
                if avg_volume > 0 and today_volume > avg_volume * multiplier:
                    is_triggered = True
                current_val_desc = (
                    f"Hacim: {today_volume:,.0f} (20g ort.: {avg_volume:,.0f}, "
                    f"{today_volume / avg_volume:.1f}x)" if avg_volume > 0 else "Hacim verisi yetersiz"
                )

        # 10. Frantic Strateji sinyali - triggers when the engine's current
        # direction for this ticker matches the alert's requested direction
        # ("LONG", "SHORT", or "ANY" for either non-NONE direction).
        elif alert.alert_type == "strategy_signal":
            signal = signal_by_ticker.get(ticker)
            if signal and signal.direction != "NONE":
                wanted = str(alert.trigger_condition.get("direction", "ANY")).upper()
                if wanted == "ANY" or wanted == signal.direction:
                    is_triggered = True
                current_val_desc = f"Frantic Strateji: {signal.direction} ({signal.confidence})"

        if is_triggered:
            alert.is_triggered = True
            alert.triggered_at = datetime.now()
            # Store details in the condition
            alert.trigger_condition = {
                **alert.trigger_condition,
                "current_val_desc": current_val_desc
            }
            triggered_alerts.append(alert)

    if triggered_alerts:
        db.commit()
        for alert in triggered_alerts:
            db.refresh(alert)

        from app.core.email import send_email
        from app.core.push import send_push

        for alert in triggered_alerts:
            desc = alert.trigger_condition.get("current_val_desc", "")
            title = f"{alert.ticker} Alarmı Tetiklendi"
            body = desc or "Belirlediğiniz koşul gerçekleşti."
            send_email(
                current_user.email,
                title,
                f"<p><strong>{alert.ticker}</strong> için ayarladığınız alarm tetiklendi.</p><p>{body}</p>",
            )
            send_push(db, current_user.id, title, body, url=f"/stock/{alert.ticker}" if alert.ticker else "/")

    return triggered_alerts

