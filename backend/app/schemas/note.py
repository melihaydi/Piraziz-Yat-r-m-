from typing import Optional
from pydantic import BaseModel, ConfigDict
from datetime import datetime

class NoteBase(BaseModel):
    title: str
    content: str = ""
    ticker: Optional[str] = None
    category: str = "genel"  # hisse, fon, genel
    color: str = "amber"

class NoteCreate(NoteBase):
    pass

class NoteUpdate(BaseModel):
    title: Optional[str] = None
    content: Optional[str] = None
    ticker: Optional[str] = None
    category: Optional[str] = None
    color: Optional[str] = None

class NoteResponse(NoteBase):
    id: int
    user_id: int
    is_pinned: bool
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)
