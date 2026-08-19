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
from datetime import date, datetime, timezone
from typing import Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioAsset
from app.models.portfolio_transaction import PortfolioTransaction

logger = logging.getLogger(__name__)

# Uygulamanın "gün" kavramı İstanbul saatine göre: günlük portföy anlık
# görüntüleri datetime.now(_TR_TZ).date() ile yazılıyor (portfolio_snapshot.py)
# ve BIST seansı da bu saat diliminde tanımlı.
_TR_TZ = ZoneInfo("Europe/Istanbul")


def local_date(value: datetime) -> date:
    """Bir işlem zamanını İSTANBUL takvim gününe çevirir.

    Doğrudan .date() almak ya da .replace(tzinfo=None) demek yanlış: Postgres
    saat dilimi bilgisiyle (UTC) döndürüyor ve İstanbul UTC+3. Gece 00:00-03:00
    arasında yapılan bir işlem UTC'de bir ÖNCEKİ güne düşer; anlık görüntü
    tarihleri ise İstanbul günü olduğu için akış yanlış güne yazılır - yıllık
    kazanç özetinde ise 1 Ocak gecesi yapılan bir satış bir önceki vergi yılına
    düşerdi.

    Saat dilimi bilgisi olmayan değerler (SQLite testleri) zaten yerel kabul
    edilir; onları çevirmek tarihi kaydırırdı.
    """
    if value.tzinfo is None:
        return value.date()
    return value.astimezone(_TR_TZ).date()


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


def record_cash_flow(
    db: Session, portfolio_id: int, amount_try: float, note: Optional[str] = None,
    executed_at: Optional[datetime] = None,
) -> PortfolioTransaction:
    """Portföye dışarıdan giren (+) / çıkan (-) nakit, TL cinsinden.

    Pozisyonlara dokunmaz. Tek amacı getiri hesabının bu hareketi
    "kazanç" sanmaması: para yatırınca portföy değeri yükselir ama bu
    performans değildir (bkz. compute_time_weighted_return).
    """
    return _record(
        db, portfolio_id, "NAKIT", "CASH", shares=0.0, price=0.0,
        amount=amount_try, executed_at=executed_at, note=note,
    )


def compute_time_weighted_return(history: list, transactions: list) -> Optional[dict]:
    """Zaman-ağırlıklı getiri (TWR): portföye para giriş/çıkışının etkisini
    ayıklayarak SADECE yatırım performansını ölçer.

    Neden gerekli: portföy eğrisi ham değeri gösterir. Kullanıcı ₺10.000
    yatırdığında eğri yükselir ve "kazandım" gibi görünür - oysa hiçbir şey
    kazanılmamıştır, sadece daha çok para konmuştur. Endeksle karşılaştırma
    da bu yüzden yanıltıcı olur: endeks para girişi almaz.

    Yöntem: her gün için o günkü dış akış (F) değerden düşülüp getiri
    hesaplanır, sonra günlük getiriler zincirlenir:
        r_t = (V_t - F_t) / V_{t-1} - 1
        TWR = Π(1 + r_t) - 1

    `history`: [{"date", "total_value"}] kronolojik.
    `transactions`: portföyün tüm hareketleri.

    Dış akış sayılanlar: BUY (+, elde zaten olan bir varlığın deftere
    girilmesi bu uygulamada nakitten düşülmediği için dış katkıdır),
    SELL (-) ve CASH (işaretli). DIVIDEND akış DEĞİLDİR - portföyün kendi
    ürettiği getiridir ve performansa dahil olmalıdır.
    """
    if len(history) < 2:
        return None

    flows_by_date: dict = {}
    for tx in transactions:
        if not tx.executed_at:
            continue
        day = local_date(tx.executed_at).isoformat()
        if tx.transaction_type == "BUY":
            flows_by_date[day] = flows_by_date.get(day, 0.0) + tx.amount
        elif tx.transaction_type == "SELL":
            flows_by_date[day] = flows_by_date.get(day, 0.0) - tx.amount
        elif tx.transaction_type == "CASH":
            flows_by_date[day] = flows_by_date.get(day, 0.0) + tx.amount

    cumulative = 1.0
    counted = 0
    skipped = 0
    # Grafiğin çizeceği seri: her gün için o güne kadarki birikimli TWR.
    # Bunu da burada üretiyoruz, çünkü ön yüzün ham değer değişimini çizip
    # başlıkta TWR göstermesi ikisinin çelişmesine yol açıyordu.
    series = [{"date": history[0]["date"], "twr_pct": 0.0}]

    for prev, curr in zip(history, history[1:]):
        v_prev = prev["total_value"]
        v_curr = curr["total_value"]
        flow = flows_by_date.get(curr["date"], 0.0)

        # İki koruma:
        #  - v_prev sıfırsa yüzde getiri tanımsız.
        #  - (v_curr - flow) sıfır ya da negatifse alt dönem çarpanı negatife
        #    döner ve zincirin işaretini bozar. Bu, uydurma bir durum değil:
        #    günlük anlık görüntü 20:00'de alınıyor, o saatten sonra girilen
        #    bir işlem aynı takvim gününe yazılıyor ama o günün değerinde
        #    HENÜZ yok. Korumasız hâlde 1.000 TL'lik portföye akşam 5.000
        #    TL'lik varlık eklemek (1000-5000)/1000 = -4 veriyor ve getiri
        #    -%500 olarak görünüyordu.
        if not v_prev or (v_curr - flow) <= 0:
            skipped += 1
            series.append({"date": curr["date"], "twr_pct": round((cumulative - 1) * 100, 2)})
            continue

        cumulative *= (v_curr - flow) / v_prev
        counted += 1
        series.append({"date": curr["date"], "twr_pct": round((cumulative - 1) * 100, 2)})

    if counted == 0:
        return None

    twr_pct = (cumulative - 1) * 100
    simple_pct = (history[-1]["total_value"] / history[0]["total_value"] - 1) * 100 if history[0]["total_value"] else None

    # net_flow YALNIZCA grafiğin kapsadığı günleri sayar. Tüm defteri
    # toplamak, kullanıcının anlık görüntüler başlamadan önce geriye dönük
    # girdiği işlemleri de "bu dönemde giren para" diye göstermek olurdu -
    # oysa o para grafikte hiç görünmüyor.
    charted_dates = {h["date"] for h in history}
    charted_flows = {d: v for d, v in flows_by_date.items() if d in charted_dates}

    return {
        "twr_pct": round(twr_pct, 2),
        # Ham (para akışını yok sayan) değişim - ikisi arasındaki fark,
        # kullanıcının koyduğu/çektiği paranın eğriye etkisidir.
        "simple_change_pct": round(simple_pct, 2) if simple_pct is not None else None,
        "net_flow": round(sum(charted_flows.values()), 2),
        "has_flows": any(abs(v) > 1e-9 for v in charted_flows.values()),
        "days_counted": counted,
        # Hesaplanamayan alt dönem varsa sonuç eksiktir; sessizce tam
        # gibi sunmak yerine söylüyoruz.
        "days_skipped": skipped,
        "series": series,
    }


def compute_fifo_realized(transactions: list) -> dict:
    """Hareket defterinden FIFO (ilk giren ilk çıkar) gerçekleşen kâr/zarar.

    Saklanan realized_pnl ORTALAMA MALİYETE göredir - ekranda gösterilen
    pozisyonun maliyetiyle tutarlı olması için doğru olan budur. Ama vergi
    hesabında lotların hangi sırayla alındığı önemlidir ve iki yöntem farklı
    sonuç verir. İkisini de sunabilmek için FIFO burada defterden SONRADAN
    hesaplanıyor; satış anında ayrıca saklanmıyor, çünkü geçmişe dönük bir
    işlem eklendiğinde (kullanıcı eski bir alışı sonradan girebiliyor) daha
    önce hesaplanmış FIFO değerleri yanlış kalırdı - defterden türetmek her
    zaman güncel sonucu verir.

    `transactions` KRONOLOJİK sırada olmalı (eskiden yeniye). Elde kalan
    lotlar bilinçli olarak yok sayılır: FIFO yalnızca kapatılmış kısmı
    ölçer.
    """
    # ticker -> [[kalan_lot, birim_maliyet], ...] alış sırasına göre kuyruk
    open_lots: dict = {}
    total = 0.0
    per_ticker: dict = {}
    matched = []

    for tx in transactions:
        ticker = tx.ticker
        lots = open_lots.setdefault(ticker, [])

        if tx.transaction_type == "BUY":
            lots.append([tx.shares, tx.price])

        elif tx.transaction_type == "BONUS":
            # Bedelsiz yeni bir maliyet doğurmaz; mevcut lotları oranla
            # ölçekler (lot artar, birim maliyet düşer). tx.shares eklenen
            # lot adedi olduğu için oran = (mevcut + eklenen) / mevcut.
            current = sum(l[0] for l in lots)
            if current > 0 and tx.shares > 0:
                ratio = (current + tx.shares) / current
                for lot in lots:
                    lot[0] *= ratio
                    lot[1] /= ratio

        elif tx.transaction_type == "SELL":
            remaining = tx.shares
            cost = 0.0
            while remaining > 1e-9 and lots:
                lot_shares, lot_cost = lots[0]
                take = min(lot_shares, remaining)
                cost += take * lot_cost
                remaining -= take
                lot_shares -= take
                if lot_shares <= 1e-9:
                    lots.pop(0)
                else:
                    lots[0][0] = lot_shares

            # remaining > 0: defterde karşılığı olmayan satış. Bu, ledger'dan
            # ÖNCE var olan (geçmişi bilinmeyen) bir pozisyonun satılması
            # demek - uydurma bir maliyet atamak yerine o kısım atlanıyor ve
            # sonuç "kısmi" olarak işaretleniyor.
            sold_with_basis = tx.shares - remaining
            if sold_with_basis > 1e-9:
                pnl = (tx.price * sold_with_basis) - cost - tx.commission
                total += pnl
                per_ticker[ticker] = round(per_ticker.get(ticker, 0.0) + pnl, 2)
                matched.append({
                    "ticker": ticker,
                    "date": tx.executed_at.isoformat() if tx.executed_at else None,
                    "shares": round(sold_with_basis, 4),
                    "sell_price": tx.price,
                    "cost_basis": round(cost / sold_with_basis, 4),
                    "realized_pnl": round(pnl, 2),
                    "incomplete": remaining > 1e-9,
                })

    return {
        "method": "FIFO",
        "realized_pnl": round(total, 2),
        "by_ticker": per_ticker,
        "sales": matched,
        # Herhangi bir satışın maliyeti defterden tam karşılanamadıysa
        # toplam eksik demektir - bunu sessizce geçmek yanlış olur.
        "has_incomplete_basis": any(m["incomplete"] for m in matched),
    }


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
