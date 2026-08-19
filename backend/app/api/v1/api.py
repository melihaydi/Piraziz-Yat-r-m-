from fastapi import APIRouter
from app.api.v1.endpoints import auth, portfolio, alert, subscription, screener, news, funds, trade, strategy, watchlist, admin, note, notifications, support

api_router = APIRouter()
api_router.include_router(auth.router, prefix="/auth", tags=["auth"])
api_router.include_router(portfolio.router, prefix="/portfolio", tags=["portfolio"])
api_router.include_router(alert.router, prefix="/alert", tags=["alert"])
api_router.include_router(subscription.router, prefix="/subscription", tags=["subscription"])
api_router.include_router(screener.router, prefix="/screener", tags=["screener"])
api_router.include_router(news.router, prefix="/news", tags=["news"])
api_router.include_router(funds.router, prefix="/funds", tags=["funds"])
api_router.include_router(trade.router, prefix="/trade", tags=["trade"])
api_router.include_router(strategy.router, prefix="/strategy", tags=["strategy"])
api_router.include_router(admin.router, prefix="/admin", tags=["admin"])
api_router.include_router(note.router, prefix="/notes", tags=["notes"])
api_router.include_router(notifications.router, prefix="/notifications", tags=["notifications"])
api_router.include_router(support.router, prefix="/support", tags=["support"])
api_router.include_router(watchlist.router, prefix="/watchlist", tags=["watchlist"])
