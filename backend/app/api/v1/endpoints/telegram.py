from fastapi import APIRouter, Depends
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.config import settings
from app.models.user import User
from app.services import telegram_bot

router = APIRouter()


def _link_payload(link) -> dict:
    linked = link.chat_id is not None
    deep_link = (
        f"https://t.me/{settings.TELEGRAM_USER_BOT_USERNAME}?start={link.link_code}"
        if settings.TELEGRAM_USER_BOT_USERNAME else None
    )
    return {
        "configured": bool(settings.TELEGRAM_USER_BOT_USERNAME),
        "linked": linked,
        "linked_at": link.linked_at.isoformat() if link.linked_at else None,
        "link_code": link.link_code,
        "deep_link": deep_link,
        "daily_digest_enabled": link.daily_digest_enabled,
    }


@router.get("/link")
def get_telegram_link(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Ayarlar sayfasının "Telegram Bağla" kartı bunu çağırır - kullanıcının
    henüz bir TelegramLink'i yoksa burada ilk kez oluşturulur (link_code
    üretilir), varsa mevcut durumu (bağlı mı, kod ne) döner. `configured`
    False ise TELEGRAM_BOT_USERNAME ayarlanmamış demektir - bu ortamda
    bot henüz kurulmamış, frontend bunu göstermemeli."""
    link = telegram_bot.get_or_create_link(db, current_user.id)
    return _link_payload(link)


@router.post("/link/regenerate")
def regenerate_telegram_link(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Mevcut bağlantıyı sıfırlar (yeni kod, chat_id temizlenir) - kullanıcı
    yanlış hesapla bağlamışsa ya da kodu paylaşmışsa."""
    link = telegram_bot.get_or_create_link(db, current_user.id)
    link = telegram_bot.regenerate_link_code(db, link)
    return _link_payload(link)


class DigestToggleRequest(BaseModel):
    enabled: bool


@router.patch("/digest-enabled")
def set_digest_enabled(
    body: DigestToggleRequest,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Bağlantıyı KOPARMADAN sabah bültenini aç/kapat - kullanıcı botu
    tekrar bağlamak zorunda kalmadan bülteni durdurabilir/başlatabilir."""
    link = telegram_bot.get_or_create_link(db, current_user.id)
    link.daily_digest_enabled = body.enabled
    db.commit()
    return _link_payload(link)
