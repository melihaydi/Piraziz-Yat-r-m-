from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class UpcomingPayment(Base):
    """Kullanıcının kendi eklediği yaklaşan ödeme/tahsilat kaydı.

    "Yaklaşan Ödemeler" paneli şimdiye kadar YALNIZCA KAP'ın kâr payı
    bildirimlerini gösteriyordu (bkz. portfolio.py'deki dividend_notices) -
    kullanıcının kendi ekleyebileceği hiçbir şey yoktu. Üstelik oradaki
    tarih gerçek bir ödeme tarihi değil, bildirimin YAYIN tarihi. Bu tablo
    kullanıcının kendi bildiği gerçek tarihleri (temettü ödeme günü, kupon,
    vergi, kira vb.) girebilmesi için.

    KAP kayıtlarıyla KARIŞTIRILMIYOR: panel ikisini ayrı kaynak olarak
    gösteriyor, çünkü biri doğrulanmış bir bildirim, diğeri kullanıcının
    kendi notu.
    """
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    title = Column(String(120), nullable=False)
    # Free-text, note.py'deki ticker ile aynı gerekçe: bir fon kodu da
    # (TMV, DOH...) olabilir ve o company tablosunda yok. Boş bırakılabilir -
    # her ödeme bir varlığa bağlı olmak zorunda değil.
    ticker = Column(String(20), nullable=True, index=True)
    # Numeric: para tutarı float ile tutulmaz. Opsiyonel - kullanıcı tutarı
    # bilmeden de sadece tarihi hatırlatmak isteyebilir.
    amount_try = Column(Numeric(18, 2), nullable=True)
    due_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="upcoming_payments")
