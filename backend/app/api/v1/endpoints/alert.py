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
