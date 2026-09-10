from sqlalchemy import Column, Integer, String, Numeric, Date, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from app.db.base_class import Base


class FundFlowSnapshot(Base):
    """Bir fonun GÜNLÜK nakit giriş/çıkış kaydı.

    Neden tablo gerekiyor: TEFAS yalnızca O ANKİ durumu yayınlıyor, geçmiş
    akış serisi vermiyor. Uygulama zaten her fiyat yenilemesinde portföy
    büyüklüğünü ve tedavüldeki pay sayısını okuyor (bkz. tefas.py
    _tefas_metrics) ama bunlar hiçbir yere YAZILMIYORDU - yalnızca o anki
    değer gösteriliyordu. Kullanıcı "her gün göreyim" dediği için günlük
    kayıt tutuluyor.

    net_flow_try = (pay sayısı değişimi) x fiyat.

    Portföy büyüklüğü FARKI KULLANILMIYOR - bilerek. Büyüklük iki sebeple
    değişir: (1) portföydeki varlıkların fiyatı değişti, (2) yatırımcı para
    koydu/çekti. Fark almak ikisini birbirine karıştırır ve yükselen bir
    günde hiç para girmediği hâlde "giriş var" gösterir. Tedavüldeki pay
    sayısı ise YALNIZCA katılma payı alınıp satıldığında değişir, piyasa
    hareketiyle değişmez - doğru ayrım budur.

    Referans alanlar (fund_size_try, shares_outstanding, investor_count) de
    saklanıyor ki bir gün rakam tartışmalı görünürse hesap geriye doğru
    denetlenebilsin.
    """
    __table_args__ = (
        # Gunde tek kayit - ayni gun icinde saatlik yenilemeler ustune yazar.
        UniqueConstraint("fund_code", "as_of_date", name="uq_fund_flow_code_date"),
    )

    id = Column(Integer, primary_key=True, index=True)
    fund_code = Column(String(10), nullable=False, index=True)
    as_of_date = Column(Date, nullable=False, index=True)

    fund_size_try = Column(Numeric(20, 2), nullable=True)
    shares_outstanding = Column(Numeric(20, 4), nullable=True)
    investor_count = Column(Integer, nullable=True)
    # Ilk gun (onceki gun verisi yokken) None kalir - 0.0 DEGIL: "akis yok"
    # ile "hesaplanamadi" farkli seyler.
    net_flow_try = Column(Numeric(20, 2), nullable=True)

    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
