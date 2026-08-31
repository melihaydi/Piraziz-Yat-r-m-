"""
Telegram botu: kullanıcı hesabını bota bağlama + sabah bülteni gönderimi.

Var olan core/notify.py'deki send_telegram_alert SADECE sabit, tek bir
admin chat_id'sine (TELEGRAM_CHAT_ID) uyarı gönderiyordu - bu modül AYNI
botu (TELEGRAM_BOT_TOKEN), her kullanıcının KENDİ chat_id'sine (bkz.
TelegramLink modeli) kişiselleştirilmiş sabah bülteni göndermek için
kullanıyor. İkisi birbirinden bağımsız: admin uyarı hattı hiç dokunulmadan
aynı şekilde çalışmaya devam ediyor.

Bağlama akışı: kullanıcı Ayarlar'da "Telegram Bağla"ya basar (bkz.
app/api/v1/endpoints/telegram.py) -> bir link_code üretilir -> kullanıcı
botla `/start <link_code>` sohbeti başlatır -> poll_updates() (uzun-polling,
WEBHOOK DEĞİL - sunucuya yeni bir public endpoint eklemeden, mevcut
scheduler thread deseniyle çalışıyor) Telegram'ın getUpdates'inden bu
mesajı görüp kodu eşleştirir ve chat_id'yi doldurur.
"""
import logging
import threading
import time
from datetime import datetime, timedelta, timezone
from typing import Optional
from zoneinfo import ZoneInfo

import httpx
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.redis import cache_service
from app.db.session import SessionLocal
from app.models.telegram_link import TelegramLink, generate_link_code
from app.models.portfolio import Portfolio, PortfolioSnapshot
from app.models.kap import KapNotification
from app.services.tefas import tefas_order_cutoff_info

logger = logging.getLogger(__name__)

# BIST/TEFAS'ın kendi saat dilimiyle aynı - "sabah 08:30" burada tanımlı.
_TR_TZ = ZoneInfo("Europe/Istanbul")

_API_BASE = "https://api.telegram.org/bot{token}"
_UPDATE_OFFSET_CACHE_KEY = "telegram:update_offset"


def _send_message(chat_id: str, text: str) -> bool:
    """Best-effort - core/notify.py'nin send_telegram_alert'ının aksine
    burada bir cooldown YOK, çünkü her çağrı zaten günde bir kez (bülten)
    ya da kullanıcının kendi /start mesajına doğrudan yanıt (linkleme)."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return False
    try:
        resp = httpx.post(
            _API_BASE.format(token=settings.TELEGRAM_BOT_TOKEN) + "/sendMessage",
            json={"chat_id": chat_id, "text": text, "parse_mode": "HTML"},
            timeout=10.0,
        )
        resp.raise_for_status()
        return True
    except Exception as e:
        logger.error(f"Telegram sendMessage failed for chat {chat_id}: {e}")
        return False


# --- Hesap bağlama (linkleme) -----------------------------------------------

def get_or_create_link(db: Session, user_id: int) -> TelegramLink:
    link = db.query(TelegramLink).filter(TelegramLink.user_id == user_id).first()
    if link:
        return link
    link = TelegramLink(user_id=user_id)
    db.add(link)
    db.commit()
    db.refresh(link)
    return link


def regenerate_link_code(db: Session, link: TelegramLink) -> TelegramLink:
    """Bağlantıyı sıfırlar - yeni kod üretir, chat_id'yi temizler (eski
    chat artık bu hesaba mesaj alamaz, kullanıcı yeniden /start yapmalı).
    Kod çalınmış/yanlışlıkla başkasına gönderilmiş olabilir diye elle
    sıfırlama imkanı."""
    link.link_code = generate_link_code()
    link.chat_id = None
    link.linked_at = None
    db.commit()
    return link


def _handle_update(db: Session, update: dict) -> None:
    message = update.get("message") or {}
    text = (message.get("text") or "").strip()
    chat = message.get("chat") or {}
    chat_id = chat.get("id")
    if not text or chat_id is None:
        return
    if not text.startswith("/start"):
        return

    parts = text.split(maxsplit=1)
    if len(parts) < 2:
        _send_message(str(chat_id), "Merhaba! Hesabını bağlamak için BIP Terminal > Ayarlar sayfasındaki kodu buraya gönder (örn. /start ABCD1234).")
        return

    code = parts[1].strip().upper()
    link = db.query(TelegramLink).filter(TelegramLink.link_code == code).first()
    if not link:
        _send_message(str(chat_id), "Kod tanınmadı. Ayarlar sayfasından yeni bir kod alıp tekrar dene.")
        return

    link.chat_id = str(chat_id)
    link.linked_at = datetime.now(timezone.utc)
    _send_message(str(chat_id), "Bağlantı tamam! Artık BIP Terminal'den sabah bültenini buradan alacaksın. Kapatmak istersen Ayarlar sayfasından bağlantıyı kaldırabilirsin.")


def poll_updates() -> None:
    """Telegram'ın getUpdates'ini BİR KERE çeker (long-poll, timeout=25s -
    o süre içinde yeni mesaj gelirse hemen döner, gelmezse 25s sonra boş
    döner). start_background_scheduler() tarafından sürekli, art arda
    çağrılıyor - offset Redis'te tutuluyor ki restart aynı mesajları
    yeniden işlemesin (Redis erişilemezse offset her seferinde baştan
    başlar - Telegram zaten en fazla son 24 saatin işlenmemiş mesajlarını
    tutuyor, o yüzden bu zararsız bir bozulma, sonsuz tekrar değil)."""
    if not settings.TELEGRAM_BOT_TOKEN:
        return

    offset = cache_service.get_json(_UPDATE_OFFSET_CACHE_KEY)
    params: dict = {"timeout": 25}
    if offset is not None:
        params["offset"] = offset

    try:
        resp = httpx.get(
            _API_BASE.format(token=settings.TELEGRAM_BOT_TOKEN) + "/getUpdates",
            params=params, timeout=30.0,
        )
        resp.raise_for_status()
        updates = resp.json().get("result", [])
    except Exception as e:
        logger.error(f"Telegram getUpdates failed: {e}")
        return

    if not updates:
        return

    db: Session = SessionLocal()
    try:
        for update in updates:
            _handle_update(db, update)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.error(f"Telegram update processing failed: {e}")
    finally:
        db.close()

    last_update_id = updates[-1]["update_id"]
    cache_service.set_json(_UPDATE_OFFSET_CACHE_KEY, last_update_id + 1, expire_seconds=30 * 24 * 3600)


# --- Sabah bülteni -----------------------------------------------------------

def compute_digest_text(db: Session, user_id: int) -> Optional[str]:
    """Bir kullanıcı için bülten metnini üretir - hiç portföyü yoksa None
    döner (gönderilecek bir şey yok). Üç bölüm: dünkü portföy değişimi
    (PortfolioSnapshot'ın son iki satırından), tuttuğu tickerlarda son 24
    saatteki KAP bildirimleri, fon tutuyorsa TEFAS kesim saati hatırlatması."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == user_id).all()
    all_assets = [a for p in portfolios for a in p.assets]
    if not all_assets:
        return None

    lines = ["☀️ <b>Günaydın! BIP Terminal Sabah Bülteni</b>"]

    snapshots = (
        db.query(PortfolioSnapshot)
        .filter(PortfolioSnapshot.user_id == user_id)
        .order_by(PortfolioSnapshot.snapshot_date.desc())
        .limit(2)
        .all()
    )
    if len(snapshots) == 2:
        latest, prev = snapshots
        if prev.total_value > 0:
            change_pct = (latest.total_value - prev.total_value) / prev.total_value * 100
            sign = "+" if change_pct >= 0 else ""
            lines.append(f"\n📊 Dünkü portföy değişimi: {sign}{change_pct:.2f}% (₺{latest.total_value:,.0f})")

    tickers = sorted({a.ticker.upper() for a in all_assets})
    cutoff = datetime.now(timezone.utc) - timedelta(hours=24)
    notices = (
        db.query(KapNotification)
        .filter(KapNotification.ticker.in_(tickers), KapNotification.publish_date >= cutoff)
        .order_by(KapNotification.publish_date.desc())
        .limit(5)
        .all()
    )
    if notices:
        lines.append("\n📰 Son 24 saatte KAP bildirimleri:")
        for n in notices:
            lines.append(f"• <b>{n.ticker}</b>: {n.title}")

    if any(len(t) == 3 for t in tickers):
        cutoff_info = tefas_order_cutoff_info()
        if cutoff_info.get("same_day"):
            lines.append(
                f"\n⏰ TEFAS emir kesme saati bugün {cutoff_info['cutoff_time']} - "
                f"bu saatten önce verilen fon emri bugünün fiyatından işlem görür."
            )

    return "\n".join(lines)


def send_morning_digest() -> None:
    db: Session = SessionLocal()
    try:
        links = (
            db.query(TelegramLink)
            .filter(TelegramLink.chat_id.isnot(None))
            .filter(TelegramLink.daily_digest_enabled.is_(True))
            .all()
        )
        if not links:
            return
        sent = 0
        for link in links:
            text = compute_digest_text(db, link.user_id)
            if text and _send_message(link.chat_id, text):
                sent += 1
        logger.info(f"Telegram morning digest: sent to {sent}/{len(links)} linked user(s).")
    except Exception as e:
        logger.error(f"Telegram morning digest run failed: {e}")
    finally:
        db.close()


class TelegramBotService:
    """İki bağımsız daemon thread: biri sürekli getUpdates'i long-poll
    ediyor (yeni /start mesajlarını neredeyse anında yakalamak için), diğeri
    günde bir kez (varsayılan 08:30 TR - BIST açılışından önce) sabah
    bültenini gönderiyor. fund_estimate_snapshot.py/tefas.py'deki diğer
    "kendi arka plan thread'i" servisleriyle aynı desen."""

    def __init__(self):
        self._scheduler_started = False

    def start_background_scheduler(self, digest_hour: int = 8, digest_minute: int = 30, startup_delay_seconds: int = 60):
        if self._scheduler_started:
            return
        self._scheduler_started = True

        def poll_loop():
            time.sleep(startup_delay_seconds)
            while True:
                try:
                    poll_updates()
                except Exception as e:
                    logger.error(f"Telegram poll loop error: {e}")
                # getUpdates kendi içinde zaten timeout=25s long-poll yapıyor
                # (yeni mesaj yoksa 25s sonra boş döner) - normal koşulda bu
                # döngüyü zaten yavaşlatıyor. AMA TELEGRAM_BOT_TOKEN
                # ayarlanmamışken (örn. yerel geliştirme/test ortamı)
                # poll_updates() o long-poll'a hiç girmeden ANINDA dönüyor -
                # bu sleep olmadan döngü tek bir CPU çekirdeğini sonsuza
                # dek boşta döndürüyordu (canlıda tespit edildi: token'sız
                # bir ortamda test paketi normalde ~3 dakikayken ~53 dakikaya
                # çıktı - bu döngü art arda milyonlarca kere dönerken
                # ThreadPoolExecutor'lı diğer testlerle CPU için yarışıyordu).
                time.sleep(1)

        def digest_loop():
            time.sleep(startup_delay_seconds)
            while True:
                now = datetime.now(_TR_TZ)
                target = now.replace(hour=digest_hour, minute=digest_minute, second=0, microsecond=0)
                if target <= now:
                    target += timedelta(days=1)
                time.sleep(max((target - now).total_seconds(), 1))
                try:
                    send_morning_digest()
                except Exception as e:
                    logger.error(f"Telegram digest loop error: {e}")

        threading.Thread(target=poll_loop, daemon=True).start()
        threading.Thread(target=digest_loop, daemon=True).start()


telegram_bot_service = TelegramBotService()
