from typing import List
from fastapi import APIRouter, Depends, Request
from app.api import deps
from app.core.limiter import limiter
from app.models.user import User
from app.services.news import NewsService

router = APIRouter()

@router.get("/")
@limiter.limit("120/minute")
def get_economy_news(request: Request, current_user: User = Depends(deps.get_current_user)):
    """Retrieve latest economy and financial market news parsed from financial sources."""
    return NewsService.get_latest_news()
