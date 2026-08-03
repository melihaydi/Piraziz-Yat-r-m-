import logging
import time

import httpx

from app.core.config import settings

logger = logging.getLogger(__name__)

# Prevents a crash loop (the same exception firing on every request) from
# spamming the alert channel - only the first occurrence of a given key
# within this window actually sends a message.
_ALERT_COOLDOWN_SECONDS = 900
_last_sent: dict[str, float] = {}


def send_telegram_alert(message: str, key: str | None = None) -> bool:
    """Best-effort Telegram alert. No-ops silently if TELEGRAM_BOT_TOKEN/
    TELEGRAM_CHAT_ID aren't configured, so this is always safe to call from
    anywhere without checking configuration first."""
    if not settings.TELEGRAM_BOT_TOKEN or not settings.TELEGRAM_CHAT_ID:
        return False

    cooldown_key = key or message
    now = time.time()
    last = _last_sent.get(cooldown_key)
    if last is not None and (now - last) < _ALERT_COOLDOWN_SECONDS:
        return False

    try:
        resp = httpx.post(
            f"https://api.telegram.org/bot{settings.TELEGRAM_BOT_TOKEN}/sendMessage",
            json={"chat_id": settings.TELEGRAM_CHAT_ID, "text": message},
            timeout=10.0,
        )
        resp.raise_for_status()
        _last_sent[cooldown_key] = now
        return True
    except Exception as e:
        logger.error(f"Failed to send Telegram alert: {e}")
        return False
