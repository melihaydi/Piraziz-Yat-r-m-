import logging
import threading
import time
import xml.etree.ElementTree as ET
import email.utils
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List
import httpx
from datetime import datetime, timedelta, timezone
from sqlalchemy import func

from app.db.session import SessionLocal
from app.models.news_article import NewsArticle

_MAX_AGE = timedelta(hours=24)

logger = logging.getLogger(__name__)

_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
    "Accept": "application/rss+xml, application/xml, text/xml, */*",
    "Accept-Language": "tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7",
}

# Note: "https://www.bloomberght.com/piyasa/rss" and ".../borsa/rss" (previously
# listed here) no longer resolve to a valid feed - each request against them was
# silently eating up to the full timeout before falling through, adding to the
# page's load time for nothing. "https://www.bloomberght.com/rss" (also
# previously used) DOES resolve and parse fine, but was confirmed - by
# directly checking its items' <pubDate> against the current time - to be
# stuck serving articles from ~6.5 days ago, not actually live; that's the
# real explanation behind "piyasa haberleri geç geliyor" complaints (Bloomberg
# items just sat there stale, dragging the merged/sorted feed's apparent
# freshness down). Replaced with HaberTürk's dedicated ekonomi feed, which
# was verified live the same way (newest item ~1-50 min old, <ttl>1</ttl>).
# Verified working + genuinely live feeds only.
_RSS_FEEDS = [
    ("https://www.aa.com.tr/tr/rss/default?cat=ekonomi", "Anadolu Ajansı"),
    ("https://www.haberturk.com/rss/ekonomi.xml", "Habertürk Ekonomi"),
]

def format_date_tr(dt: datetime) -> str:
    """Helper to format dates dynamically into Turkish relative dates (Today, Yesterday, or Calendar date)."""
    now = datetime.now(dt.tzinfo) if dt.tzinfo else datetime.now()
    diff = now.date() - dt.date()

    months_tr = {
        1: "Ocak", 2: "Şubat", 3: "Mart", 4: "Nisan", 5: "Mayıs", 6: "Haziran",
        7: "Temmuz", 8: "Ağustos", 9: "Eylül", 10: "Ekim", 11: "Kasım", 12: "Aralık"
    }

    time_str = dt.strftime("%H:%M")

    if diff.days == 0:
        return f"Bugün, {time_str}"
    elif diff.days == 1:
        return f"Dün, {time_str}"
    else:
        return f"{dt.day} {months_tr.get(dt.month, '')} {dt.year}, {time_str}"

def _fetch_rss_feed(rss_url: str, source_name: str) -> List[Dict[str, Any]]:
    """Fetch and parse a single RSS feed. Runs in a worker thread so multiple
    feeds can be fetched concurrently instead of one-after-another."""
    items = []
    try:
        response = httpx.get(rss_url, timeout=5.0, headers=_HEADERS, follow_redirects=True)
        if response.status_code == 200:
            root = ET.fromstring(response.content)
            for item in root.findall(".//item"):
                title = item.find("title")
                link = item.find("link")
                description = item.find("description")
                pub_date = item.find("pubDate")

                title_text = title.text if title is not None else ""
                link_text = link.text if link is not None else ""
                desc_text = description.text if description is not None else ""
                date_text = pub_date.text if pub_date is not None else ""

                if desc_text:
                    import re
                    desc_text = re.sub('<[^<]+?>', '', desc_text).strip()

                parsed_dt = None
                try:
                    parsed_dt = email.utils.parsedate_to_datetime(date_text)
                    if parsed_dt.tzinfo is None:
                        parsed_dt = parsed_dt.replace(tzinfo=timezone.utc)
                except Exception:
                    parsed_dt = None

                if link_text:
                    items.append({
                        "title": title_text,
                        "link": link_text,
                        "summary": desc_text,
                        "source": source_name,
                        "published_at": parsed_dt,
                    })
    except Exception as e:
        logger.warning(f"Failed to fetch live financial news from {rss_url} ({source_name}): {e}")
    return items


class NewsService:
    """Piyasa Haberleri: RSS feeds are synced into the news_article DB table
    by a 20-minute background job (start_background_scheduler/sync_news_to_db)
    - GET /news/ (get_latest_news_from_db) only ever reads that table, never
    calling the external feeds itself. This replaces the previous design
    (live RSS fetch + 90s process-memory cache on every request), which lost
    everything on a restart and meant every cache-miss request paid the full
    RSS round-trip. KAP disclosures have their own separate, already-correct
    flow (GET /screener/kap) and are deliberately NOT merged into this feed
    anymore - the previous in-memory "patch the cache in place once the AI
    analysis finishes" trick doesn't translate cleanly to a DB-backed model,
    and mixing the two only blurred what was otherwise a clean split between
    "KAP Bildirimleri" and "Piyasa Haberleri" as two distinct sections."""

    _scheduler_started = False

    @staticmethod
    def sync_news_to_db() -> int:
        """Fetch all RSS feeds concurrently and upsert new articles into the
        DB, deduped by url (a feed re-serving an already-synced item is a
        no-op, not a duplicate row or an update - articles are immutable
        once synced). Returns the number of NEW rows inserted."""
        db = SessionLocal()
        try:
            all_items: List[Dict[str, Any]] = []
            with ThreadPoolExecutor(max_workers=len(_RSS_FEEDS)) as pool:
                futures = [pool.submit(_fetch_rss_feed, url, name) for url, name in _RSS_FEEDS]
                for future in as_completed(futures):
                    all_items.extend(future.result())

            if not all_items:
                return 0

            existing_urls = {
                row[0] for row in
                db.query(NewsArticle.url)
                .filter(NewsArticle.url.in_([item["link"] for item in all_items]))
                .all()
            }

            inserted = 0
            for item in all_items:
                if item["link"] in existing_urls:
                    continue
                db.add(NewsArticle(
                    title=item["title"],
                    url=item["link"],
                    source=item["source"],
                    summary=item["summary"],
                    published_at=item["published_at"],
                ))
                existing_urls.add(item["link"])  # guards duplicate items within the same batch
                inserted += 1

            db.commit()
            if inserted:
                logger.info(f"News sync: inserted {inserted} new articles.")
            return inserted
        except Exception as e:
            db.rollback()
            logger.error(f"News sync failed: {e}")
            return 0
        finally:
            db.close()

    @staticmethod
    def prune_old_news() -> int:
        """Deletes articles whose effective timestamp (published_at, falling
        back to synced_at for feed items with no parseable pubDate) is older
        than _MAX_AGE. GET /news/ only ever shows the last 24h (see
        get_latest_news_from_db's filter), so rows past that window are dead
        weight - keeping them around just makes the table grow forever for
        no benefit. Returns the number of rows deleted."""
        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - _MAX_AGE
            deleted = (
                db.query(NewsArticle)
                .filter(func.coalesce(NewsArticle.published_at, NewsArticle.synced_at) < cutoff)
                .delete(synchronize_session=False)
            )
            db.commit()
            if deleted:
                logger.info(f"News prune: removed {deleted} articles older than 24h.")
            return deleted
        except Exception as e:
            db.rollback()
            logger.error(f"News prune failed: {e}")
            return 0
        finally:
            db.close()

    @staticmethod
    def start_background_scheduler(interval_seconds: int = 20 * 60, startup_delay_seconds: int = 30):
        """Same daemon-thread-loop shape as the other periodic services
        (portfolio_snapshot.py, fund_estimate_snapshot.py) - runs once shortly
        after startup, then every `interval_seconds` (default 20 minutes)."""
        if NewsService._scheduler_started:
            return
        NewsService._scheduler_started = True

        def loop():
            time.sleep(startup_delay_seconds)
            NewsService.sync_news_to_db()
            NewsService.prune_old_news()
            while True:
                time.sleep(interval_seconds)
                NewsService.sync_news_to_db()
                NewsService.prune_old_news()

        threading.Thread(target=loop, daemon=True).start()

    @staticmethod
    def get_latest_news_from_db(limit: int = 50) -> List[Dict[str, Any]]:
        """Serves GET /news/ - reads only from the DB, newest first, and only
        articles from the last 24h (older items would be dead/stale news to
        show a user opening the app - see _MAX_AGE). Never calls an external
        feed."""
        db = SessionLocal()
        try:
            cutoff = datetime.now(timezone.utc) - _MAX_AGE
            rows = (
                db.query(NewsArticle)
                .filter(func.coalesce(NewsArticle.published_at, NewsArticle.synced_at) >= cutoff)
                .order_by(NewsArticle.published_at.desc().nullslast(), NewsArticle.synced_at.desc())
                .limit(limit)
                .all()
            )
            return [
                {
                    "title": r.title,
                    "link": r.url,
                    "summary": r.summary or "",
                    "source": r.source,
                    "pub_date": format_date_tr(r.published_at) if r.published_at else format_date_tr(r.synced_at),
                }
                for r in rows
            ]
        finally:
            db.close()
