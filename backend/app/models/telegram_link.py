import secrets

from sqlalchemy import Column, Integer, String, Boolean, DateTime, ForeignKey
from sqlalchemy.sql import func
from app.db.base_class import Base


def generate_link_code() -> str:
    # 8 karakter, büyük harf+rakam - kullanıcının bota /start <code> olarak
    # göndereceği kod. secrets.token_hex kullanılmıyor çünkü 0/O, 1/I gibi
    # karışabilecek karakterleri elemek elle yazımı kolaylaştırıyor.
    alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
    return "".join(secrets.choice(alphabet) for _ in range(8))


class TelegramLink(Base):
    """Bir kullanıcının hesabını Telegram botuna bağlayan tek satır - bkz.
    app/services/telegram_bot.py. `link_code`, kullanıcı Ayarlar sayfasında
    "Telegram Bağla"ya bastığında üretilir; kullanıcı botla `/start
    <link_code>` sohbeti başlatınca poll_updates() bu kodu eşleştirip
    `chat_id`'yi doldurur - o ana kadar chat_id NULL'dur (bağlı değil).

    Bir kullanıcının en fazla bir bağlantısı olur (user_id unique) - yeniden
    "Telegram Bağla"ya basmak yeni bir kod üretip chat_id'yi sıfırlar
    (eski bağlantı geçersiz olur), ikinci bir satır AÇILMAZ.
    """
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, unique=True, index=True)
    link_code = Column(String(16), nullable=False, unique=True, index=True, default=generate_link_code)
    chat_id = Column(String(64), nullable=True)
    linked_at = Column(DateTime(timezone=True), nullable=True)
    # Kullanıcı botla konuşmayı bıraksa bile (ör. botu engellese) satırı
    # silmiyoruz - sadece gönderim denemesi başarısız olur, bu alan elle
    # kapatma imkanı için ayrı tutuluyor.
    daily_digest_enabled = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
