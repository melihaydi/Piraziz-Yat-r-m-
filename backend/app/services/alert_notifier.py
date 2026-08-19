"""Alarm tetiklendiğinde bildirim gönderimi - tek yer.

Neden ayrı bir servis: alarmlar İKİ ayrı yerde tetikleniyordu ve ikisi
birbirini yiyordu.

  1. market_data.py'deki websocket geri çağrımı (`_check_alerts_for_symbol`)
     canlı fiyat akışında sürekli çalışıyor. Koşul sağlanınca alarmı
     `is_triggered=True, is_active=False` yapıyor - ama HİÇBİR bildirim
     göndermiyordu, sadece log yazıyordu.
  2. alert.py'deki /check endpoint'i e-posta ve push gönderiyor, ama sadece
     `is_active=True AND is_triggered=False` olan alarmlara bakıyor ve
     yalnızca kullanıcı uygulamayı açık tuttuğunda (Header 15 sn'de bir
     yokluyor) çağrılıyor.

Websocket sürekli çalıştığı için 1 neredeyse her zaman kazanıyordu: alarmı
tüketip pasife çekiyor, kimseye haber vermiyordu; sonra 2 baktığında ortada
aktif alarm kalmıyordu. Yani kullanıcının kurduğu fiyat alarmı tetikleniyor
ama e-posta da push de ASLA gitmiyordu.

Artık her iki yol da buradan geçiyor ve `mark_triggered_and_notify` geçişi
atomik yapıyor, böylece iki yol yarışsa bile bildirim tam bir kez gider.
"""
import logging
import threading
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy.orm import Session

from app.models.alert import Alert

logger = logging.getLogger(__name__)

# E-posta ve push gönderimi bloklayıcı ağ çağrılarıdır. Bunları websocket
# geri çağrımının içinde doğrudan çalıştırmak, tüm canlı fiyat akışını
# bildirim süresince durdururdu (o geri çağrım her fiyat tikinde,
# stream'in kendi thread'inde çalışıyor). Bu yüzden gönderim küçük bir
# havuza devrediliyor; tetikleyen taraf beklemiyor.
_executor = ThreadPoolExecutor(max_workers=2, thread_name_prefix="alert-notify")
_lock = threading.Lock()


def mark_triggered_and_notify(db: Session, alert: Alert, body: Optional[str] = None) -> bool:
    """Alarmı tetiklenmiş olarak işaretler ve bildirimi kuyruğa alır.

    Geçiş ATOMİK: koşullu UPDATE ile yalnızca hâlâ tetiklenmemiş olan satır
    güncellenir. İki tetikleme yolu aynı anda aynı alarmı yakalarsa yalnızca
    biri True döner, dolayısıyla kullanıcı çift bildirim almaz.

    True dönerse bu çağrı geçişi gerçekleştirmiştir (ve bildirim kuyruğa
    alınmıştır); False dönerse başka biri önce davranmıştır.
    """
    from app.models.user import User

    updated = (
        db.query(Alert)
        .filter(Alert.id == alert.id, Alert.is_triggered == False)  # noqa: E712
        .update(
            {
                "is_triggered": True,
                "is_active": False,
                "triggered_at": datetime.now(timezone.utc),
            },
            synchronize_session=False,
        )
    )
    db.commit()
    if not updated:
        return False

    # DB okumaları BURADA, çağıranın thread'inde yapılıyor: SQLAlchemy
    # oturumları thread'ler arasında paylaşılamaz, ve worker'a kendi
    # oturumunu açtırmak onu çağıranın transaction'ından da kopartırdı.
    # Worker'a yalnızca düz veri gidiyor; orada sadece ağ işi kalıyor.
    user = db.query(User).filter(User.id == alert.user_id).first()
    if not user:
        return True

    subscriptions = _push_targets(db, alert.user_id)
    _executor.submit(_send, user.email, alert.ticker, body, subscriptions)
    return True


def _push_targets(db: Session, user_id: int) -> list:
    """Kullanıcının push aboneliklerini düz sözlüklere çevirir - ORM
    nesneleri kendi oturumlarına bağlı olduğu için thread'e taşınamaz."""
    from app.models.push_subscription import PushSubscription

    rows = db.query(PushSubscription).filter(PushSubscription.user_id == user_id).all()
    return [
        {"id": r.id, "endpoint": r.endpoint, "p256dh": r.p256dh, "auth": r.auth}
        for r in rows
    ]


def _send(email: str, ticker: Optional[str], body: Optional[str], subscriptions: list) -> None:
    """Havuz thread'inde çalışır - yalnızca ağ çağrıları."""
    from app.core.email import send_email
    from app.core.push import send_push_to_subscriptions

    title = f"{ticker} Alarmı Tetiklendi" if ticker else "Alarmınız Tetiklendi"
    text = body or "Belirlediğiniz koşul gerçekleşti."

    try:
        # İkisi de "best effort": kendi içlerinde hata yutuyorlar, biri
        # başarısız olsa diğeri yine de denenir.
        send_email(
            email,
            title,
            f"<p><strong>{ticker or 'Alarm'}</strong> için ayarladığınız alarm tetiklendi.</p><p>{text}</p>",
        )
        send_push_to_subscriptions(
            subscriptions, title, text, url=f"/stock/{ticker}" if ticker else "/"
        )
        logger.info(f"Alarm bildirimi gönderildi: {email} ticker={ticker}")
    except Exception as e:
        logger.error(f"Alarm bildirimi gönderilemedi ({email}, {ticker}): {e}")
