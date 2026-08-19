"""Kurumsal işlemler (bedelsiz sermaye artırımı / hisse bölünmesi) - tek
kaynak.

Daha önce bu bilgi market_data.py içinde `_CORPORATE_ACTION_RATIO` diye
sadece bir oran sözlüğüydü ve YALNIZCA canlı kotasyonun yanlış hesapladığı
günlük %değişimi düzeltiyordu. Kullanıcının portföyündeki lot sayısına ve
ortalama maliyetine hiç dokunmuyordu - oysa bedelsiz sonrası fiyat 1/oran'a
düşerken lot sabit kaldığı için portföyde GERÇEK OLMAYAN bir zarar
görünüyor (KTLEV'de canlıda tam olarak bu yaşandı: %238 bedelsiz sonrası
portföy ~%70 zararda gibi göründü).

Burası artık her iki kullanımın da kaynağı: market_data.py kotasyon
düzeltmesi için oranı buradan okuyor, portföy düzeltmesi de buradaki
ex-date'i kullanıyor.
"""
import logging
from dataclasses import dataclass
from datetime import date, datetime, timezone
from typing import Dict, List, Optional

from sqlalchemy.orm import Session

from app.models.portfolio import PortfolioAsset
from app.models.portfolio_transaction import PortfolioTransaction
from app.services import portfolio_ledger

logger = logging.getLogger(__name__)


@dataclass(frozen=True)
class CorporateAction:
    ticker: str
    # ratio = işlem sonrası lot / işlem öncesi lot.
    # %238.16 bedelsiz -> 100 lot 338.16 lot olur -> 3.3816
    ratio: float
    ex_date: date
    description: str


# Bilinen kurumsal işlemler. Yeni bir bedelsiz çıktığında buraya bir satır
# eklemek yeterli - hem kotasyon düzeltmesi hem portföy düzeltmesi bunu
# okur.
CORPORATE_ACTIONS: List[CorporateAction] = [
    CorporateAction(
        ticker="KTLEV",
        ratio=3.3816,
        ex_date=date(2026, 8, 3),
        description="Katılımevim %238,16 bedelsiz sermaye artırımı (SPK onayı 2026-07-29)",
    ),
]


def ratio_by_ticker() -> Dict[str, float]:
    """market_data.py'nin kotasyon düzeltmesi için oran sözlüğü."""
    return {a.ticker: a.ratio for a in CORPORATE_ACTIONS}


def _as_date(value) -> Optional[date]:
    if value is None:
        return None
    return value.date() if isinstance(value, datetime) else value


@dataclass
class AdjustmentPlan:
    """Tek bir pozisyon için ne yapılacağı (ya da neden yapılmayacağı)."""
    asset_id: int
    portfolio_id: int
    ticker: str
    current_shares: float
    current_average_cost: float
    new_shares: float
    new_average_cost: float
    applicable: bool
    reason: str


def plan_adjustments(db: Session, action: CorporateAction) -> List[AdjustmentPlan]:
    """Bir kurumsal işlemin hangi pozisyonlara uygulanacağını hesaplar -
    hiçbir şeyi DEĞİŞTİRMEZ. Admin ekranındaki önizleme bunu kullanır.

    Bilinçli olarak muhafazakâr: bir pozisyona ancak
      - ex-date'ten ÖNCE oluşmuşsa (yani kullanıcı bedelsizi hak etmişse) ve
      - daha önce bu işlem için bir BONUS kaydı yazılmamışsa (idempotenslik)
      - ex-date'ten sonra o hisseye ait bir alış yapılmamışsa
    dokunulur. Son koşul şu yüzden var: ex-date'ten sonra alınan lotlar zaten
    düzeltilmiş fiyattan alınmıştır, ortalama maliyet ikisinin karışımıdır ve
    tek bir oranla doğru şekilde ayrıştırılamaz. Böyle bir pozisyonu
    körlemesine çarpmak, doğru olmayan bir veriyi başka bir yanlış veriyle
    değiştirmek olurdu - elle düzeltilmesi için işaretlenip bırakılıyor.
    """
    assets = db.query(PortfolioAsset).filter(
        PortfolioAsset.ticker == action.ticker.upper()
    ).all()

    plans: List[AdjustmentPlan] = []
    for asset in assets:
        created = _as_date(asset.created_at)
        already = db.query(PortfolioTransaction.id).filter(
            PortfolioTransaction.portfolio_id == asset.portfolio_id,
            PortfolioTransaction.ticker == action.ticker.upper(),
            PortfolioTransaction.transaction_type == "BONUS",
            PortfolioTransaction.executed_at >= datetime(
                action.ex_date.year, action.ex_date.month, action.ex_date.day, tzinfo=timezone.utc
            ),
        ).first()

        bought_after = db.query(PortfolioTransaction.id).filter(
            PortfolioTransaction.portfolio_id == asset.portfolio_id,
            PortfolioTransaction.ticker == action.ticker.upper(),
            PortfolioTransaction.transaction_type == "BUY",
            PortfolioTransaction.executed_at >= datetime(
                action.ex_date.year, action.ex_date.month, action.ex_date.day, tzinfo=timezone.utc
            ),
        ).first()

        if already:
            applicable, reason = False, "Zaten uygulanmış (BONUS kaydı mevcut)."
        elif created is not None and created >= action.ex_date:
            applicable, reason = False, "Pozisyon ex-date'ten sonra açılmış, düzeltme gerekmiyor."
        elif bought_after:
            applicable, reason = False, "Ex-date sonrası alış var - ortalama maliyet karışık, elle kontrol gerekiyor."
        else:
            applicable, reason = True, "Uygulanabilir."

        plans.append(AdjustmentPlan(
            asset_id=asset.id,
            portfolio_id=asset.portfolio_id,
            ticker=asset.ticker,
            current_shares=asset.shares,
            current_average_cost=asset.average_cost,
            new_shares=asset.shares * action.ratio if applicable else asset.shares,
            new_average_cost=asset.average_cost / action.ratio if applicable else asset.average_cost,
            applicable=applicable,
            reason=reason,
        ))
    return plans


def apply_action(db: Session, action: CorporateAction) -> List[AdjustmentPlan]:
    """plan_adjustments()'ın uygulanabilir bulduğu pozisyonları düzeltir ve
    her biri için BONUS hareketi yazar. Commit eder; uygulanan planları
    döner."""
    plans = plan_adjustments(db, action)
    applied = [p for p in plans if p.applicable]
    if not applied:
        return plans

    ex_dt = datetime(action.ex_date.year, action.ex_date.month, action.ex_date.day, tzinfo=timezone.utc)
    for plan in applied:
        asset = db.query(PortfolioAsset).filter(PortfolioAsset.id == plan.asset_id).first()
        if not asset:
            continue
        portfolio_ledger.apply_bonus_issue(
            db, asset, ratio=action.ratio, executed_at=ex_dt, note=action.description,
        )

    db.commit()
    logger.info(
        f"Kurumsal işlem uygulandı: {action.ticker} x{action.ratio} "
        f"({len(applied)}/{len(plans)} pozisyon)."
    )
    return plans


def get_action(ticker: str) -> Optional[CorporateAction]:
    ticker = ticker.upper()
    for a in CORPORATE_ACTIONS:
        if a.ticker == ticker:
            return a
    return None
