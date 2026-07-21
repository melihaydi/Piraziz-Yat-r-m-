from typing import List
from fastapi import APIRouter
from app.services.news import NewsService

router = APIRouter()

@router.get("/")
def get_economy_news():
    """Retrieve latest economy and financial market news parsed from financial sources."""
    return NewsService.get_latest_news()
