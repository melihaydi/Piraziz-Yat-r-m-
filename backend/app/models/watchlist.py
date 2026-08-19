from sqlalchemy import Column, Integer, String, DateTime, ForeignKey, UniqueConstraint
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


class WatchlistItem(Base):
    """Kullanıcının takip ettiği (yıldızladığı) hisse.

    Bu liste daha önce yalnızca tarayıcının localStorage'ında duruyordu
    ("favorites_stocks", bkz. screener sayfası). Sonuçları: tarayıcı verisi
    temizlenince liste yok oluyordu, aynı hesapla girilen masaüstü exe / web
    / Android uygulamalarının her birinde AYRI bir liste oluşuyordu, ve
    sunucu listeyi hiç görmediği için üzerine hiçbir şey kurulamıyordu
    (izleme listesine dayalı bildirim, günlük özet vb.).

    ticker'da company tablosuna FK YOK: kullanıcı henüz `company` tablosuna
    seed edilmemiş bir sembolü de takibe alabilmeli, ve bir şirketin
    listeden düşmesi kullanıcının kaydını silmemeli - aynı gerekçe
    PortfolioTransaction.ticker'da da geçerli.
    """
    id = Column(Integer, primary_key=True, index=True)
    user_id = Column(Integer, ForeignKey("user.id", ondelete="CASCADE"), nullable=False, index=True)
    ticker = Column(String(20), nullable=False)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    user = relationship("User", backref="watchlist_items")

    __table_args__ = (
        # Aynı hisseyi iki kez eklemek anlamsız; üstelik istemci tarafındaki
        # localStorage göçü aynı listeyi birden fazla cihazdan gönderebilir.
        UniqueConstraint("user_id", "ticker", name="uq_watchlist_user_ticker"),
    )
