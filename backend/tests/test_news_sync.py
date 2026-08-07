from datetime import datetime, timedelta, timezone
from unittest.mock import patch

import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.models.news_article import NewsArticle
from app.services.news import NewsService

# Self-contained in-memory DB, same reasoning as test_portfolio_snapshot.py:
# NewsService opens its own session via SessionLocal() rather than taking
# one as a dependency.
_engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False}, poolclass=StaticPool)
_Session = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


@pytest.fixture
def news_db():
    Base.metadata.create_all(bind=_engine)
    session = _Session()
    yield session
    session.close()
    Base.metadata.drop_all(bind=_engine)


def _fake_items(n=2):
    now = datetime.now(timezone.utc)
    return [
        {
            "title": f"Article {i}",
            "link": f"https://example.com/article-{i}",
            "summary": f"Summary {i}",
            "source": "Test Source",
            "published_at": now - timedelta(minutes=i),
        }
        for i in range(n)
    ]


def test_sync_inserts_new_articles(news_db):
    with patch("app.services.news.SessionLocal", return_value=news_db), \
         patch("app.services.news._fetch_rss_feed", return_value=_fake_items(2)):
        inserted = NewsService.sync_news_to_db()

    assert inserted == 2
    assert news_db.query(NewsArticle).count() == 2


def test_sync_dedupes_by_url_on_repeat_run(news_db):
    with patch("app.services.news.SessionLocal", return_value=news_db), \
         patch("app.services.news._fetch_rss_feed", return_value=_fake_items(2)):
        NewsService.sync_news_to_db()
        second_run_inserted = NewsService.sync_news_to_db()

    assert second_run_inserted == 0
    assert news_db.query(NewsArticle).count() == 2


def test_sync_dedupes_within_the_same_batch(news_db):
    # Two feeds both happening to carry the exact same URL in one sync pass.
    duplicate_url_items = _fake_items(1) + _fake_items(1)
    with patch("app.services.news.SessionLocal", return_value=news_db), \
         patch("app.services.news._fetch_rss_feed", return_value=duplicate_url_items):
        inserted = NewsService.sync_news_to_db()

    assert inserted == 1
    assert news_db.query(NewsArticle).count() == 1


def test_get_latest_news_from_db_orders_newest_first(news_db):
    now = datetime.now(timezone.utc)
    news_db.add(NewsArticle(title="Old", url="https://a.com/1", source="A", published_at=now - timedelta(hours=2)))
    news_db.add(NewsArticle(title="New", url="https://a.com/2", source="A", published_at=now))
    news_db.commit()

    with patch("app.services.news.SessionLocal", return_value=news_db):
        results = NewsService.get_latest_news_from_db()

    assert [r["title"] for r in results] == ["New", "Old"]


def test_get_latest_news_from_db_empty_returns_empty_list(news_db):
    with patch("app.services.news.SessionLocal", return_value=news_db):
        results = NewsService.get_latest_news_from_db()

    assert results == []
