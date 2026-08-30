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
from typing import Dict, List, Optional
from zoneinfo import ZoneInfo

from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioAsset
from app.models.portfolio_transaction import PortfolioTransaction
from app.services.tefas import tefas_service

logger = logging.getLogger(__name__)

# Bir tickerin sadece FONLAR ÜZERİNDEN gelen (dolaylı) payı bu eşiği
# geçerse "konsantrasyon" olarak flaglenir - kullanıcı 3 farklı fon tutuyor
# sanıp aslında hepsinin aynı büyük hisseye (ör. THYAO) yoğun şekilde maruz
# kaldığını fark etmiyor olabilir; bu tam da look-through'un çözmeye
# çalıştığı kör nokta.
_CONCENTRATION_THRESHOLD_PCT = 15.0

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


def expand_fund_leaf_weights(code: str, _visited: Optional[set] = None) -> Dict[str, float]:
    """Bir fon kodunu, tefas_service.get_live_estimated_return()'ün ZATEN
    hesapladığı (drift-ayarlı) ağırlık listesini kullanarak "yaprak"
    tickerlara kadar açar - yeniden bir kompozisyon hesabı YAPMAZ, sadece
    aynı veriyi tekrar kullanır (get_live_estimated_return kendi içinde
    zaten cycle koruması yapıyor, o yüzden burada sadece bir üst seviye
    _visited yeterli).

    Dönen dict {ticker: bu_fonun_kesri} şeklinde, kesirler toplamı en fazla
    1.0 eder - eksik kalan pay (kompozisyonda "Nakit"/"Ters Repo" gibi
    kategori etiketleri ya da hiç yayınlanmamış diğer varlıklar) aynı
    get_live_estimated_return'ün resolved_weight_pct'inin bıraktığı boşluk,
    burada da sessizce atlanıyor - toplam portföy değerine oranlarken bu
    boşluk otomatik olarak "çözülemeyen" pay olarak görünür.

    Bir alt-fon holding'i kendi kompozisyonuyla çözülemiyorsa (get_live_
    estimated_return zaten güven eşiğini geçemediği için onu "fund_daily"
    olarak işaretlemiş olur), o alt-fonun kodu kendisi bir yaprak olarak
    kabul edilir - daha fazla açılamaz ama değer hiç kaybolmaz.
    """
    code = code.upper()
    _visited = (_visited or set()) | {code}
    estimate = tefas_service.get_live_estimated_return(code)
    if not estimate:
        return {}

    leaves: Dict[str, float] = {}
    for holding in estimate["holdings"]:
        frac = holding["weight"] / 100.0
        ticker = holding["ticker"]
        if holding["type"] == "fund" and ticker not in _visited:
            sub_leaves = expand_fund_leaf_weights(ticker, _visited)
            if sub_leaves:
                for sub_ticker, sub_frac in sub_leaves.items():
                    leaves[sub_ticker] = leaves.get(sub_ticker, 0.0) + frac * sub_frac
                continue
            # Alt-fonun kendi kompozisyonu çözülemedi - kendi kodunu yaprak
            # olarak kullanmaya devam et (aşağıdaki genel ekleme).
        leaves[ticker] = leaves.get(ticker, 0.0) + frac
    return leaves


def compute_fund_overlap(code_a: str, code_b: str) -> Optional[dict]:
    """İki fonun İÇİNDEKİ hisselerin ne kadar örtüştüğü - expand_fund_leaf_
    weights'in (look-through portföyde kullanılan, drift-ayarlı yaprak
    ağırlıkları) her iki fon için ayrı ayrı hesaplanıp karşılaştırılmasıyla.

    overlap_pct, portföy dünyasında standart "overlap" tanımı: her ORTAK
    tickerın İKİ fondaki ağırlığından KÜÇÜK olanının toplamı (Morningstar'ın
    "Portfolio X-Ray"inde kullandığı aynı yöntem). Örn. THYAO fon A'da %20,
    fon B'de %10 ise, bu 10 puanlık kısım "örtüşen" sayılır - fazladan %10,
    A'ya özgü kalır. %100 = iki fon aynı hisselere aynı ağırlıkla sahip
    (aynı fonu iki kere almışsın gibi); %0 = hiç ortak hisse yok.

    Herhangi bir fonun kompozisyonu hiç çözülemezse None döner - "örtüşme
    yok" ile "hesaplanamadı" karıştırılmamalı.
    """
    code_a, code_b = code_a.upper(), code_b.upper()
    leaves_a = expand_fund_leaf_weights(code_a)
    leaves_b = expand_fund_leaf_weights(code_b)
    if not leaves_a or not leaves_b:
        return None

    common_tickers = set(leaves_a) & set(leaves_b)
    overlap_pct = sum(min(leaves_a[t], leaves_b[t]) for t in common_tickers) * 100

    common_holdings = sorted(
        [
            {
                "ticker": t,
                "weight_a_pct": round(leaves_a[t] * 100, 2),
                "weight_b_pct": round(leaves_b[t] * 100, 2),
            }
            for t in common_tickers
        ],
        key=lambda h: min(h["weight_a_pct"], h["weight_b_pct"]),
        reverse=True,
    )

    return {
        "code_a": code_a,
        "code_b": code_b,
        "overlap_pct": round(overlap_pct, 2),
        "resolved_a_pct": round(sum(leaves_a.values()) * 100, 2),
        "resolved_b_pct": round(sum(leaves_b.values()) * 100, 2),
        "common_holdings": common_holdings,
    }


def compute_fund_overlap_matrix(codes: List[str]) -> dict:
    """2-5 fonu ikili ikili karşılaştırıp her ÇİFTİN örtüşme yüzdesini döner -
    compute_fund_overlap'in N fon için toplu hali (fon karşılaştırma
    diyaloğundaki mevcut fiyat/getiri karşılaştırmasının yanına eklenen
    "hisse örtüşmesi" görünümü besliyor). Fon başına kompozisyon çözümü
    tefas_service içinde zaten cache'li olduğundan, aynı fonun birden fazla
    çiftte tekrar geçmesi ekstra ağ maliyeti getirmiyor.
    """
    codes = list(dict.fromkeys(c.upper() for c in codes))
    pairs = []
    for i in range(len(codes)):
        for j in range(i + 1, len(codes)):
            result = compute_fund_overlap(codes[i], codes[j])
            pairs.append(result if result is not None else {
                "code_a": codes[i], "code_b": codes[j],
                "overlap_pct": None, "resolved_a_pct": None, "resolved_b_pct": None,
                "common_holdings": [],
            })
    return {"codes": codes, "pairs": pairs}


def compute_look_through_exposure(assets: List[PortfolioAsset], price_by_ticker: Dict[str, float]) -> dict:
    """"Gerçek Dağılım" - kullanıcının doğrudan tuttuğu hisseler + tuttuğu
    fonların İÇİNDEKİ hisseler birleştirilerek, her tickera olan TOPLAM
    (doğrudan + fonlar üzerinden dolaylı) maruziyeti hesaplar.

    price_by_ticker: her asset.ticker için önceden (paralel) çekilmiş güncel
    fiyat - /live-estimate endpoint'indeki ile aynı desen, burada tekrar ağ
    çağrısı yapılmaz.
    """
    total_value = 0.0
    exposure: Dict[str, float] = {}
    direct_exposure: Dict[str, float] = {}

    for asset in assets:
        ticker = asset.ticker.upper()
        price = price_by_ticker.get(ticker) or asset.average_cost
        value = asset.shares * price
        total_value += value

        if len(ticker) == 3:
            leaves = expand_fund_leaf_weights(ticker)
            if leaves:
                for leaf_ticker, frac in leaves.items():
                    exposure[leaf_ticker] = exposure.get(leaf_ticker, 0.0) + value * frac
                continue
            # Kompozisyonu hiç çözülemedi - fonun kendi kodunu yaprak olarak
            # kullan, değer yine de toplam dağılımda görünsün.
            exposure[ticker] = exposure.get(ticker, 0.0) + value
        else:
            exposure[ticker] = exposure.get(ticker, 0.0) + value
            direct_exposure[ticker] = direct_exposure.get(ticker, 0.0) + value

    holdings_out = []
    for ticker, value in exposure.items():
        direct = direct_exposure.get(ticker, 0.0)
        indirect = value - direct
        indirect_pct_of_total = (indirect / total_value * 100) if total_value > 0 else 0.0
        holdings_out.append({
            "ticker": ticker,
            "value": round(value, 2),
            "direct_value": round(direct, 2),
            "indirect_value": round(indirect, 2),
            "pct_of_total": round((value / total_value * 100) if total_value > 0 else 0.0, 2),
            # Sadece fonlar üzerinden gelen (doğrudan tutulmayan) pay eşiği
            # geçiyorsa flaglenir - kullanıcının zaten bildiği doğrudan bir
            # pozisyon "konsantrasyon uyarısı" olarak sayılmaz.
            "concentration_flag": indirect_pct_of_total >= _CONCENTRATION_THRESHOLD_PCT,
        })
    holdings_out.sort(key=lambda h: h["value"], reverse=True)

    resolved_value = sum(h["value"] for h in holdings_out)
    return {
        "total_value": round(total_value, 2),
        "resolved_value_pct": round(resolved_value / total_value * 100, 2) if total_value > 0 else 0.0,
        "holdings": holdings_out,
    }
