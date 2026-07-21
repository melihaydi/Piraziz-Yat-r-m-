from fastapi import APIRouter
from app.api.v1.endpoints import auth, portfolio, alert, subscription, screener, news, funds

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
api_router.include_router(alert.router, prefix="/alert", tags=["alert"])
api_router.include_router(subscription.router, prefix="/subscription", tags=["subscription"])
api_router.include_router(screener.router, prefix="/screener", tags=["screener"])
api_router.include_router(news.router, prefix="/news", tags=["news"])
api_router.include_router(funds.router, prefix="/funds", tags=["funds"])
