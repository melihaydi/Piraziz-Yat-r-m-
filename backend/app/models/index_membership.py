from sqlalchemy import Column, Integer, String, Date, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base_class import Base


class IndexMembership(Base):
    """Bir endeksin BELİRLİ bir gündeki bileşen listesinin tek bir satırı
    (index_code, ticker, snapshot_date) - bkz. index_tracker.py. Günlük
    servis, o günün gerçek listesini (borsapy.Index(code).component_symbols)
    en son kayıtlı snapshot'la karşılaştırıp farkı IndexChangeEvent'e
    yazıyor; bu tablo sadece "hangi gün kim endeksteydi" ham kaydı."""
    id = Column(Integer, primary_key=True, index=True)
    index_code = Column(String(10), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    snapshot_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    __table_args__ = (
        UniqueConstraint("index_code", "ticker", "snapshot_date", name="uq_index_membership_code_ticker_date"),
    )


class IndexChangeEvent(Base):
    """Bir endekse GİRİŞ ya da ÇIKIŞ - iki ardışık IndexMembership
    snapshot'ı arasındaki fark tespit edildiğinde bir kez yazılır (kalıcı
    bir olay kaydı, snapshot'ların aksine asla üzerine yazılmaz)."""
    id = Column(Integer, primary_key=True, index=True)
    index_code = Column(String(10), nullable=False, index=True)
    ticker = Column(String(20), nullable=False, index=True)
    change_type = Column(String(10), nullable=False)  # "ADDED" | "REMOVED"
    detected_date = Column(Date, nullable=False, index=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())
