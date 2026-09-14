# -*- coding: utf-8 -*-
"""Fon Akış Radarı - fonlara giren paranın hangi hisseye gittiği.

FİKİR: TEFAS fonlara ne kadar para girip çıktığını yayınlıyor ve bunu
herkes görebiliyor. Ama o paranın hangi HİSSEYE gittiğini kimse
söylemiyor - çünkü bunun için fonun içini bilmek gerekiyor.

Uygulamada ikisi de var: fon kompozisyonları (FUND_DETAILS_MAP, elle
güncel tutuluyor) ve günlük net akış kaydı (fund_flow_snapshot). Çarpımı
şunu veriyor: "Dün fonlara X TL girdi, bunun Y TL'si KARCL'ye gitti."

HESAP: her fon için (o günün net akışı) x (hissenin fondaki ağırlığı),
tüm fonlar boyunca toplanıyor. Negatif akış (para çıkışı) negatif baskı
üretiyor - bu bilerek: çıkış da en az giriş kadar bilgi.

ÖNEMLİ SINIR - bu İMA EDİLEN baskı, kanıtlanmış alım DEĞİL. Varsayım:
fon yeni parayı mevcut ağırlıklarına göre dağıtıyor. Gerçekte nakitte
bekletebilir ya da kompozisyon dışı bir şey alabilir. Arayüzde bu açıkça
yazılmalı, yoksa kesin veri sanılır.
"""
import datetime as dt
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.orm import Session

logger = logging.getLogger(__name__)

# Hisse OLMAYAN yapraklar ayrı raporlanıyor. Bunları "hangi hisseye para
# gitti" listesinde göstermek yanıltıcı olurdu: VIOP bir piyasa segmenti,
# SABIT/BONO bir enstrüman sınıfı, T3B/HMV/MTL ise kompozisyonu
# bilinmediği için açılamamış FON kodları.
_NON_STOCK_LEAVES = {"VIOP", "SABIT", "BONO", "VDMK", "TMM", "NAKIT", "REPO"}


def _is_stock(ticker: str, known_stocks: set, known_funds: set) -> bool:
    t = ticker.upper()
    if t in _NON_STOCK_LEAVES or t in known_funds:
        return False
    return t in known_stocks


def compute_flow_radar(db: Session, days: int = 1, limit: int = 25) -> Dict[str, Any]:
    """Son `days` gündeki fon akışlarını hisse bazında ima edilen baskıya çevirir."""
    from app.models.fund_flow_snapshot import FundFlowSnapshot
    from app.services.portfolio_ledger import expand_fund_leaf_weights
    from app.services.tefas import BASE_FUNDS, _KNOWN_STOCK_TICKERS

    days = max(1, min(days, 90))
    since = dt.date.today() - dt.timedelta(days=days)

    rows = (
        db.query(FundFlowSnapshot)
        .filter(FundFlowSnapshot.as_of_date > since,
                FundFlowSnapshot.net_flow_try.isnot(None))
        .order_by(FundFlowSnapshot.as_of_date.desc())
        .all()
    )
    if not rows:
        return {"days": days, "funds": [], "stocks": [], "other": [],
                "net_flow_total_try": None, "covered_fund_count": 0}

    known_funds = set(BASE_FUNDS.keys())

    # Fon basina toplam akis (ayni fonun birden fazla gunu toplaniyor)
    flow_by_fund: Dict[str, float] = {}
    dates: Dict[str, str] = {}
    for r in rows:
        code = r.fund_code.upper()
        flow_by_fund[code] = flow_by_fund.get(code, 0.0) + float(r.net_flow_try)
        d = r.as_of_date.isoformat() if r.as_of_date else None
        if d and (code not in dates or d > dates[code]):
            dates[code] = d

    stock_pressure: Dict[str, float] = {}
    other_pressure: Dict[str, float] = {}
    covered: List[Dict[str, Any]] = []

    for code, flow in flow_by_fund.items():
        try:
            leaves = expand_fund_leaf_weights(code)
        except Exception as e:
            logger.warning(f"Akis radari: {code} acilamadi: {e}")
            leaves = {}
        if not leaves:
            # Kompozisyonu bilinmeyen fon - akisi TOPLAMA dahil edilmiyor,
            # cunku nereye gittigi bilinmiyor. Sessizce hisselere dagitmak
            # uydurma olurdu.
            continue

        covered.append({
            "code": code,
            "net_flow_try": round(flow, 2),
            "last_date": dates.get(code),
            "resolved_pct": round(sum(leaves.values()) * 100, 1),
        })
        for ticker, frac in leaves.items():
            bucket = stock_pressure if _is_stock(ticker, _KNOWN_STOCK_TICKERS, known_funds) else other_pressure
            bucket[ticker] = bucket.get(ticker, 0.0) + flow * frac

    def _rank(d: Dict[str, float]) -> List[Dict[str, Any]]:
        # Mutlak degere gore siralaniyor: en buyuk CIKIS da en buyuk giris
        # kadar dikkat cekici bir sinyal.
        return [
            {"ticker": t, "implied_flow_try": round(v, 2)}
            for t, v in sorted(d.items(), key=lambda kv: -abs(kv[1]))
        ]

    return {
        "days": days,
        "covered_fund_count": len(covered),
        "funds": sorted(covered, key=lambda f: -abs(f["net_flow_try"])),
        "net_flow_total_try": round(sum(f["net_flow_try"] for f in covered), 2),
        "stocks": _rank(stock_pressure)[:limit],
        # Hisse olmayan yapraklar (turev/sabit getiri/acilamayan fonlar) -
        # ayri gosteriliyor ki "hisseye giden para" rakami sismesin.
        "other": _rank(other_pressure)[:10],
    }
