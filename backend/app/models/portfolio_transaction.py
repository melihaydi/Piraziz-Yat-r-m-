from sqlalchemy import Column, Integer, String, Float, DateTime, ForeignKey
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func
from app.db.base_class import Base


# Every way a holding's share count, cost basis, or realized return can
# change. Kept as one ledger with a `type` discriminator rather than three
# separate tables (trades / dividends / corporate actions), because the
# things users actually ask for - "işlem geçmişim", "bu yıl ne kazandım",
# "toplam getirim ne" - are all just different filters/aggregations over
# the same chronological stream of events.
TRANSACTION_TYPES = ("BUY", "SELL", "DIVIDEND", "BONUS")


class PortfolioTransaction(Base):
    """One immutable row per portfolio event (alış, satış, temettü,
    bedelsiz).

    Before this existed, PortfolioAsset held ONLY the current shares and
    average_cost - so selling simply decremented `shares` (or deleted the
    row) and every trace of the sale was gone: no date, no sale price (the
    endpoint didn't even ask for one), and therefore no realized P&L. A
    user could see what their holdings are worth right now, but never what
    they had actually earned. This table is that missing history.

    Rows are append-only: editing a holding's shares/average_cost directly
    (the "Düzenle" flow) does NOT rewrite past transactions, since those
    record what really happened. Only `realized_pnl` on SELL rows is
    derived, and it's computed once at sale time from the average cost then
    in effect.
    """
    id = Column(Integer, primary_key=True, index=True)
    portfolio_id = Column(Integer, ForeignKey("portfolio.id", ondelete="CASCADE"), nullable=False, index=True)
    # Deliberately NOT an FK to portfolio_asset: a SELL that closes a
    # position deletes the asset row, and the history of that position must
    # survive it. Same reason KAP/alert reference companies by plain ticker.
    ticker = Column(String(20), nullable=False, index=True)
    transaction_type = Column(String(20), nullable=False)  # see TRANSACTION_TYPES

    # BUY/SELL: lot adedi. BONUS: eklenen (bedelsiz) lot adedi.
    # DIVIDEND: temettünün ödendiği lot adedi (bilgi amaçlı).
    shares = Column(Float, nullable=False, default=0.0)
    # BUY/SELL: birim fiyat. DIVIDEND: lot başına brüt temettü.
    # BONUS: 0 (bedelsiz lotun maliyeti yoktur).
    price = Column(Float, nullable=False, default=0.0)
    # İşlemin toplam nakit etkisi (komisyon dahil): BUY negatif yönlü bir
    # harcama, SELL/DIVIDEND ise giriş. Hesaplanabilir olmasına rağmen
    # saklanıyor - komisyon oranı veya vergi kesintisi ileride değişse bile
    # geçmiş işlemin gerçekte ne tuttuğu değişmemeli.
    amount = Column(Float, nullable=False, default=0.0)
    commission = Column(Float, nullable=False, default=0.0)
    # Sadece SELL için dolu: (satış fiyatı - o anki ortalama maliyet) * lot
    # - komisyon. Diğer tiplerde None.
    realized_pnl = Column(Float, nullable=True)

    # Kullanıcı geçmişe dönük işlem girebildiği için ayrı tutuluyor -
    # created_at "ne zaman kaydedildi", executed_at "ne zaman gerçekleşti".
    executed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), index=True)
    note = Column(String(255), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    portfolio = relationship("Portfolio", backref="transactions")
