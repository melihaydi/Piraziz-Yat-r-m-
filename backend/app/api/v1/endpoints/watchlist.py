"""İzleme listesi (favori hisseler) - kullanıcı hesabına bağlı.

Daha önce bu liste yalnızca tarayıcının localStorage'ındaydı; sunucuya
taşınmasının gerekçesi WatchlistItem modelinin docstring'inde.
"""
from typing import List

from fastapi import APIRouter, Depends, HTTPException, Request, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.limiter import limiter
from app.models.user import User
from app.models.watchlist import WatchlistItem

router = APIRouter()

# Bir kullanıcının takip listesini sınırsız büyütmesi, hem ekranı hem de
# bu listeye dayalı olası toplu işleri (fiyat çekme, özet) anlamsız
# derecede pahalı hale getirir.
MAX_WATCHLIST_SIZE = 200


class WatchlistItemIn(BaseModel):
    ticker: str


class WatchlistMigrateIn(BaseModel):
    """localStorage'daki eski listeyi bir kerede taşımak için."""
    tickers: List[str]


def _serialize(item: WatchlistItem) -> dict:
    return {
        "id": item.id,
        "ticker": item.ticker,
        "created_at": item.created_at.isoformat() if item.created_at else None,
    }


@router.get("/")
def list_watchlist(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Kullanıcının takip ettiği hisseler, en son eklenen başta."""
    items = (
        db.query(WatchlistItem)
        .filter(WatchlistItem.user_id == current_user.id)
        .order_by(WatchlistItem.created_at.desc(), WatchlistItem.id.desc())
        .all()
    )
    return [_serialize(i) for i in items]


@router.post("/", status_code=status.HTTP_201_CREATED)
@limiter.limit("60/minute")
def add_to_watchlist(
    request: Request,
    payload: WatchlistItemIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Hisseyi takibe alır. Zaten listedeyse mevcut kayıt döner (hata
    değil): istemci tarafında yıldız butonuna iki kez basmak ya da iki
    cihazdan aynı anda eklemek olağan bir durum."""
    ticker = payload.ticker.strip().upper()
    if not ticker:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Hisse kodu boş olamaz.")

    existing = db.query(WatchlistItem).filter(
        WatchlistItem.user_id == current_user.id,
        WatchlistItem.ticker == ticker,
    ).first()
    if existing:
        return _serialize(existing)

    count = db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).count()
    if count >= MAX_WATCHLIST_SIZE:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"İzleme listesi en fazla {MAX_WATCHLIST_SIZE} hisse içerebilir.",
        )

    item = WatchlistItem(user_id=current_user.id, ticker=ticker)
    db.add(item)
    db.commit()
    db.refresh(item)
    return _serialize(item)


@router.delete("/{ticker}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("60/minute")
def remove_from_watchlist(
    request: Request,
    ticker: str,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Takipten çıkarır. Zaten listede değilse de 204 döner - istemcinin
    istediği son durum (bu hisse listemde olmasın) zaten sağlanmış
    durumda, bunu hata saymak yıldızı geri açardı."""
    db.query(WatchlistItem).filter(
        WatchlistItem.user_id == current_user.id,
        WatchlistItem.ticker == ticker.strip().upper(),
    ).delete(synchronize_session=False)
    db.commit()
    return None


@router.post("/migrate")
@limiter.limit("10/minute")
def migrate_watchlist(
    request: Request,
    payload: WatchlistMigrateIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Tarayıcıda kalmış eski favori listesini hesaba taşır.

    Yalnızca EKLER, silmez: kullanıcı iki farklı cihazda iki farklı liste
    biriktirmiş olabilir ve hangisinin "doğru" olduğunu bilemeyiz - ikisini
    birleştirmek, birini sessizce kaybetmekten iyidir. Zaten mevcut olanlar
    atlanır, dolayısıyla tekrar tekrar çağrılması güvenlidir.
    """
    incoming = {t.strip().upper() for t in payload.tickers if t and t.strip()}
    if not incoming:
        return {"added": 0, "total": db.query(WatchlistItem).filter(WatchlistItem.user_id == current_user.id).count()}

    existing = {
        row[0] for row in db.query(WatchlistItem.ticker)
        .filter(WatchlistItem.user_id == current_user.id).all()
    }
    room = max(0, MAX_WATCHLIST_SIZE - len(existing))
    to_add = sorted(incoming - existing)[:room]

    for ticker in to_add:
        db.add(WatchlistItem(user_id=current_user.id, ticker=ticker))
    db.commit()

    return {"added": len(to_add), "total": len(existing) + len(to_add)}
