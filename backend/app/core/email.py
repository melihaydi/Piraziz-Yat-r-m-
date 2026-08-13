import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from app.core.config import settings

logger = logging.getLogger(__name__)

_FROM_NAME = "BIP Terminal"


def send_email(to: str, subject: str, html_body: str) -> bool:
    """Best-effort transactional email, same pattern as
    core/notify.py's send_telegram_alert: no-ops silently if SMTP_USER/
    SMTP_PASSWORD aren't configured (dev/test environments), never raises,
    just logs and returns False on failure - a broken mail send must never
    take down the request that triggered it (password reset, alert, etc.)."""
    if not settings.SMTP_USER or not settings.SMTP_PASSWORD:
        logger.info(f"SMTP not configured - skipping email to {to}: {subject}")
        return False

    try:
        msg = MIMEMultipart("alternative")
        msg["Subject"] = subject
        msg["From"] = f"{_FROM_NAME} <{settings.SMTP_USER}>"
        msg["To"] = to
        msg.attach(MIMEText(html_body, "html", "utf-8"))

        with smtplib.SMTP(settings.SMTP_HOST, settings.SMTP_PORT, timeout=10) as server:
            server.starttls()
            server.login(settings.SMTP_USER, settings.SMTP_PASSWORD)
            server.sendmail(settings.SMTP_USER, [to], msg.as_string())
        return True
    except Exception as e:
        logger.error(f"Failed to send email to {to}: {e}")
        return False
