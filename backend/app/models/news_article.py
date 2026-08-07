from sqlalchemy import Column, Integer, String, Text, DateTime
from sqlalchemy.sql import func
from app.db.base_class import Base

class NewsArticle(Base):
    """Piyasa Haberleri articles synced from RSS feeds every 20 minutes (see
    NewsService.sync_news_to_db) rather than fetched live per-request -
    GET /news/ reads only from this table, never calling the external feeds
    itself. `url` is the dedupe key: a feed re-serving the same item on a
    later sync is a no-op, not a duplicate row."""
    id = Column(Integer, primary_key=True, index=True)
    title = Column(String(500), nullable=False)
    url = Column(String(1000), nullable=False, unique=True, index=True)
    source = Column(String(100), nullable=False)
    summary = Column(Text, nullable=True)
    published_at = Column(DateTime(timezone=True), nullable=True, index=True)
    synced_at = Column(DateTime(timezone=True), server_default=func.now())
