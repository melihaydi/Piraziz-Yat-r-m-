"""Portföy hareket defteri - bir pozisyonun lot sayısını, maliyetini veya
gerçekleşen getirisini değiştiren HER işlemin tek geçtiği yer.

Neden servis: alış (weighted-average maliyet birleştirme) mantığı daha önce
portfolio.py ve admin.py'de birebir kopyalanmıştı, satış ise hiçbir yerde
kayıt bırakmıyordu. Her iki endpoint de artık buradan geçiyor, böylece
"kullanıcı kendi ekledi" ile "admin yönetilen portföye ekledi" aynı
maliyet hesabını ve aynı geçmiş kaydını üretiyor.

Her fonksiyon hem PortfolioAsset'i (güncel durum) hem PortfolioTransaction'ı
(değişmez geçmiş) günceller - ikisi birbirinden ayrı düşürülmemeli, bu
yüzden aynı çağrıda yapılıyorlar.
"""
import logging
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioAsset
from app.models.portfolio_transaction import PortfolioTransaction

logger = logging.getLogger(__name__)


def _record(
    db: Session, portfolio_id: int, ticker: str, transaction_type: str,
    shares: float, price: float, amount: float, commission: float = 0.0,
    realized_pnl: Optional[float] = None, executed_at: Optional[datetime] = None,
    note: Optional[str] = None,
) -> PortfolioTransaction:
    tx = PortfolioTransaction(
        portfolio_id=portfolio_id,
        ticker=ticker.upper(),
        transaction_type=transaction_type,
        shares=shares,
        price=price,
        amount=round(amount, 2),
        commission=round(commission, 2),
        realized_pnl=round(realized_pnl, 2) if realized_pnl is not None else None,
        note=note,
    )
    # server_default handles the common "şimdi" case; only override when the
    # caller is backdating an entry, so we never write a NULL over the default.
    if executed_at is not None:
        tx.executed_at = executed_at
    db.add(tx)
    return tx


def record_buy(
    db: Session, portfolio_id: int, ticker: str, shares: float, price: float,
    commission: float = 0.0, executed_at: Optional[datetime] = None,
    note: Optional[str] = None,
) -> PortfolioAsset:
    """Alış: mevcut pozisyona ekler (ağırlıklı ortalama maliyet) ya da yeni
    pozisyon açar, ve BUY hareketini deftere yazar. Commit ETMEZ - çağıran
    kendi işlem sınırını yönetir."""
    ticker = ticker.upper()
    asset = db.query(PortfolioAsset).filter(
        PortfolioAsset.portfolio_id == portfolio_id,
        PortfolioAsset.ticker == ticker,
    ).first()

    if asset:
        total_shares = asset.shares + shares
        if total_shares > 0:
            asset.average_cost = (
                (asset.shares * asset.average_cost) + (shares * price)
            ) / total_shares
            asset.shares = total_shares
    else:
        asset = PortfolioAsset(
            portfolio_id=portfolio_id, ticker=ticker,
            shares=shares, average_cost=price,
        )
        db.add(asset)
        # Flush so a SECOND record_buy for the same ticker within the same
        # (uncommitted) transaction finds this row instead of inserting a
        # duplicate position - autoflush doesn't cover it because the lookup
        # above is a filtered query that SQLAlchemy can satisfy without
        # flushing pending inserts.
        db.flush()

    _record(
        db, portfolio_id, ticker, "BUY", shares=shares, price=price,
        amount=shares * price + commission, commission=commission,
        executed_at=executed_at, note=note,
    )
    return asset


def record_sell(
    db: Session, asset: PortfolioAsset, shares: float, price: float,
    commission: float = 0.0, executed_at: Optional[datetime] = None,
    note: Optional[str] = None,
) -> tuple[Optional[PortfolioAsset], float]:
    """Satış: gerçekleşen kâr/zararı O ANKİ ortalama maliyete göre hesaplar,
    pozisyonu azaltır (tamamen satıldıysa siler) ve SELL hareketini deftere
    yazar. (kalan_pozisyon | None, gerçekleşen_kz) döner.

    realized_pnl satış anında hesaplanıp saklanıyor: average_cost sonraki bir
    alışla değişeceği için, sonradan geriye dönük hesaplamak yanlış sonuç
    verirdi. Commit ETMEZ.
    """
    # Ortalama maliyet yöntemi (FIFO değil) - uygulamanın pozisyon modeli
    # zaten tek bir average_cost tutuyor, ayrı lotları değil.
    cost_basis = asset.average_cost
    realized_pnl = (price - cost_basis) * shares - commission
    portfolio_id = asset.portfolio_id
    ticker = asset.ticker

    _record(
        db, portfolio_id, ticker, "SELL", shares=shares, price=price,
        amount=shares * price - commission, commission=commission,
        realized_pnl=realized_pnl, executed_at=executed_at, note=note,
    )

    # 1e-9 toleransı: kullanıcının girdiği kesirli lot ile saklanan float'ın
    # son basamağı tutmayabilir, "hepsini sat" bu yüzden tam eşitlik
    # aramamalı - aksi halde 1e-16 lotluk hayalet pozisyon kalır.
    if shares >= asset.shares - 1e-9:
        db.delete(asset)
        return None, realized_pnl

    asset.shares -= shares
    return asset, realized_pnl


def record_dividend(
    db: Session, portfolio_id: int, ticker: str, shares: float,
    per_share: float, tax: float = 0.0, executed_at: Optional[datetime] = None,
    note: Optional[str] = None,
) -> PortfolioTransaction:
    """Temettü geliri. Pozisyonun lot sayısını veya maliyetini DEĞİŞTİRMEZ -
    sadece nakit girişi olarak deftere yazılır, böylece toplam getiri
    (fiyat kazancı + temettü) hesaplanabilir.

    `tax` stopaj kesintisidir; commission alanında saklanıyor çünkü ikisi de
    aynı işi görüyor: brüt tutardan düşülen, kullanıcının cebine girmeyen
    kısım.
    """
    gross = shares * per_share
    return _record(
        db, portfolio_id, ticker, "DIVIDEND", shares=shares, price=per_share,
        amount=gross - tax, commission=tax,
        executed_at=executed_at, note=note,
    )


def apply_bonus_issue(
    db: Session, asset: PortfolioAsset, ratio: float,
    executed_at: Optional[datetime] = None, note: Optional[str] = None,
) -> PortfolioAsset:
    """Bedelsiz sermaye artırımı / hisse bölünmesi.

    `ratio` = işlem sonrası lot / işlem öncesi lot (ör. %238 bedelsiz ->
    3.3816). Toplam maliyet sabit kalır: lot sayısı ratio kadar artar,
    ortalama maliyet aynı oranda düşer. Bu yapılmazsa fiyat bedelsiz sonrası
    1/ratio'ya düşerken lot sayısı sabit kaldığı için portföyde gerçek
    olmayan bir zarar görünür (canlıda KTLEV'de tam olarak bu yaşandı).
    """
    if ratio <= 0:
        raise ValueError("Bedelsiz oranı sıfırdan büyük olmalı.")

    added_shares = asset.shares * (ratio - 1)
    asset.shares = asset.shares * ratio
    asset.average_cost = asset.average_cost / ratio

    _record(
        db, asset.portfolio_id, asset.ticker, "BONUS",
        shares=added_shares,
        # Bedelsiz lotun maliyeti yoktur ve nakit hareketi doğurmaz.
        price=0.0, amount=0.0,
        executed_at=executed_at,
        note=note or f"Bedelsiz/bölünme (oran {ratio:g}x)",
    )
    return asset
