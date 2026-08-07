from typing import List
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.api import deps
from app.models.user import User
from app.models.note import Note
from app.schemas.note import NoteCreate, NoteUpdate, NoteResponse

router = APIRouter()

@router.get("/", response_model=List[NoteResponse])
def get_user_notes(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """All notes for the current user, pinned first, then most recently updated."""
    return (
        db.query(Note)
        .filter(Note.user_id == current_user.id)
        .order_by(desc(Note.is_pinned), desc(Note.updated_at))
        .all()
    )

@router.post("/", response_model=NoteResponse, status_code=status.HTTP_201_CREATED)
def create_note(
    note_in: NoteCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    db_note = Note(
        user_id=current_user.id,
        title=note_in.title,
        content=note_in.content,
        ticker=note_in.ticker.upper() if note_in.ticker else None,
        category=note_in.category,
        color=note_in.color,
    )
    db.add(db_note)
    db.commit()
    db.refresh(db_note)
    return db_note

@router.put("/{id}", response_model=NoteResponse)
def update_note(
    id: int,
    note_in: NoteUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    db_note = db.query(Note).filter(Note.id == id, Note.user_id == current_user.id).first()
    if not db_note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not bulunamadı")

    update_data = note_in.model_dump(exclude_unset=True)
    if "ticker" in update_data and update_data["ticker"]:
        update_data["ticker"] = update_data["ticker"].upper()
    for field, value in update_data.items():
        setattr(db_note, field, value)

    db.commit()
    db.refresh(db_note)
    return db_note

@router.post("/{id}/pin", response_model=NoteResponse)
def toggle_note_pin(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    db_note = db.query(Note).filter(Note.id == id, Note.user_id == current_user.id).first()
    if not db_note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not bulunamadı")

    db_note.is_pinned = not db_note.is_pinned
    db.commit()
    db.refresh(db_note)
    return db_note

@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_note(
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    db_note = db.query(Note).filter(Note.id == id, Note.user_id == current_user.id).first()
    if not db_note:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not bulunamadı")

    db.delete(db_note)
    db.commit()
    return None
