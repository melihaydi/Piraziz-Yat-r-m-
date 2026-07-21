from typing import List
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
    
    triggered_alerts = []
    
    for alert in active_alerts:
        ticker = alert.ticker
        if not ticker:
            continue
            
        quote = market_data_service.get_quote(ticker)
        if not quote:
            continue
            
        candles = None
        if alert.alert_type in ["rsi", "macd", "ema", "sma", "ai_score"]:
            candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False)
            
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
            
        if is_triggered:
            alert.is_triggered = True
            alert.triggered_at = datetime.now()
            # Store details in the condition
            alert.trigger_condition = {
                **alert.trigger_condition,
                "current_val_desc": current_val_desc
            }
            db.commit()
            db.refresh(alert)
            triggered_alerts.append(alert)
            
    return triggered_alerts

