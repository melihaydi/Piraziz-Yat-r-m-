import hashlib
import logging
from datetime import datetime, timezone
from typing import List, Optional
from concurrent.futures import ThreadPoolExecutor
from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.api import deps
from app.core.limiter import limiter
from app.db.session import SessionLocal
from app.models.user import User
from app.models.portfolio import Portfolio, PortfolioAsset, PortfolioSnapshot
from app.models.portfolio_transaction import PortfolioTransaction
from app.models.kap import KapNotification
from app.schemas.portfolio import (
    PortfolioCreate, PortfolioResponse, PortfolioAssetCreate, PortfolioAssetResponse,
    AssetSell, DividendCreate, PortfolioTransactionResponse,
)
from app.services.market_data import market_data_service
from app.services.tefas import tefas_service
from app.services import portfolio_ledger
from app.services.portfolio_analytics import compute_portfolio_analytics
from app.services import inflation
from app.core.redis import cache_service

logger = logging.getLogger(__name__)

router = APIRouter()

def _fetch_live_price(ticker: str, delay_minutes: int = 0) -> Optional[float]:
    """Fetch a single ticker's price - a fund NAV (3-char codes, TEFAS's own
    once-daily published price, not gated by delay_minutes since it's
    already not "live" in that sense) or a BIST stock quote (gated - see
    deps.get_data_delay_minutes). Split out of calculate_asset_metrics so
    callers with several assets (get_user_portfolios) can fetch them all
    concurrently instead of one blocking network/cache call per asset in
    sequence."""
    ticker = ticker.upper()
    if len(ticker) == 3:
        fund = tefas_service.get_fund(ticker)
        return fund["price"] if fund else None
    quote = market_data_service.get_delayed_quote(ticker, delay_minutes) if delay_minutes > 0 else market_data_service.get_quote(ticker)
    return quote.get("last") if quote else None

# Below this trust bar, a fund's own recursive estimate is mostly-empty
# (little of its composition resolved to live quotes) and a stale-but-real
# daily_return beats it - same threshold funds.py's live-estimate endpoint
# and tefas.py's own recursion use, kept consistent across all three.
_MIN_TRUSTED_RESOLVED_PCT = 20.0

def _fund_estimated_daily_change_pct(ticker: str, delay_minutes: int = 0) -> Optional[float]:
    """The live intraday estimate for a fund holding (same idea as the
    funds page's "Popüler Fonlar"), returned ONLY as a separate figure -
    NEVER folded into current_price/total_value/total_profit, which must
    stay the real, officially published NAV. Mixing the two would make a
    holding's "official" value silently drift from what TEFAS actually
    publishes, which is misleading for money the user is tracking. Returns
    None for stocks (len(ticker) != 3) or when the estimate isn't
    trustworthy enough (same threshold used elsewhere)."""
    if len(ticker) != 3:
        return None
    estimate = tefas_service.get_live_estimated_return(ticker, delay_minutes=delay_minutes)
    if estimate is None or estimate["resolved_weight_pct"] < _MIN_TRUSTED_RESOLVED_PCT:
        return None
    return estimate["estimated_change_pct"]

def _stock_daily_change_pct(ticker: str, delay_minutes: int = 0) -> Optional[float]:
    """Real daily %change (since yesterday's official close) for a STOCK
    holding, straight from its live quote - unlike the fund estimate above,
    this is real data, not modeled. None for funds or unrecognized tickers."""
    if len(ticker) == 3 or not market_data_service.is_known_ticker(ticker):
        return None
    quote = market_data_service.get_delayed_quote(ticker, delay_minutes) if delay_minutes > 0 else market_data_service.get_quote(ticker)
    return quote.get("change_percent") if quote else None

def _daily_change(ticker: str, delay_minutes: int = 0) -> tuple:
    """Unified daily-change lookup for the Portföy Varlıkları table: real
    for a stock, an estimate for a fund (see the two helpers above -
    NEVER mixed into current_price/total_value either way). Returns
    (change_pct, is_estimate)."""
    if len(ticker) == 3:
        pct = _fund_estimated_daily_change_pct(ticker, delay_minutes)
        return pct, pct is not None
    return _stock_daily_change_pct(ticker, delay_minutes), False

def _fund_official_daily_change_pct(ticker: str) -> Optional[float]:
    """Real, OFFICIALLY PUBLISHED TEFAS daily return for a fund holding -
    NOT the intraday estimate used by _fund_estimated_daily_change_pct above.
    Straight from TefasService's own daily NAV crawl (get_fund's
    daily_return), the same figure the estimate-accuracy snapshot compares
    itself against. Used only for the portfolio-wide "Bugün" headline gain -
    per explicit request, that figure must be real settled data, not an
    estimate, even though the estimate is fine as a clearly-labeled per-row
    number elsewhere in the assets table. Not delay-gated: TEFAS only
    publishes this once a day, so it's already not "live" in the sense the
    delay restriction is about."""
    if len(ticker) != 3:
        return None
    fund = tefas_service.get_fund(ticker)
    return fund.get("daily_return") if fund else None

def _official_daily_change_pct(ticker: str, delay_minutes: int = 0) -> Optional[float]:
    """Unified OFFICIAL daily %change - real live quote for a stock, real
    published TEFAS daily_return for a fund. Never an estimate."""
    if len(ticker) == 3:
        return _fund_official_daily_change_pct(ticker)
    return _stock_daily_change_pct(ticker, delay_minutes)

def _usd_try_rate() -> float:
    """Live USD/TRY rate for converting a usd_cash_balance holding to TL -
    get_quote() never returns None (it always has a synthetic fallback, see
    its own docstring), so this only needs a defensive constant for the
    pathological case of a malformed quote dict, not real unavailability."""
    quote = market_data_service.get_quote("USDTRY")
    rate = quote.get("last") if quote else None
    return float(rate) if rate else 33.245


def calculate_asset_metrics(asset: PortfolioAsset, live_price: Optional[float] = None, delay_minutes: int = 0) -> dict:
    """Helper to compute real-time value and profit metrics for an asset.
    Pass a pre-fetched `live_price` (see _fetch_live_price) to skip the
    network/cache lookup this would otherwise do itself."""
    if live_price is None:
        live_price = _fetch_live_price(asset.ticker, delay_minutes)

    if live_price is None or live_price == 0:
        live_price = asset.average_cost

    cost_value = asset.shares * asset.average_cost
    current_value = asset.shares * live_price
    profit = current_value - cost_value
    profit_pct = (profit / cost_value * 100) if cost_value > 0 else 0.0

    return {
        "id": asset.id,
        "portfolio_id": asset.portfolio_id,
        "ticker": asset.ticker,
        "shares": asset.shares,
        "average_cost": asset.average_cost,
        "current_price": live_price,
        "total_value": current_value,
        "total_profit": profit,
        "profit_percentage": profit_pct,
        "created_at": asset.created_at,
        "updated_at": asset.updated_at,
    }

@router.get("/", response_model=List[PortfolioResponse])
def get_user_portfolios(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Retrieve all portfolios for the current user, calculating valuations -
    live for premium, 15-minute-delayed otherwise (see
    deps.get_data_delay_minutes)."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()

    # Fetch every distinct ticker's price once, concurrently, instead of
    # once per asset in sequence across every portfolio (each lookup is a
    # blocking TEFAS/market-data call).
    all_tickers = sorted({asset.ticker.upper() for p in portfolios for asset in p.assets})
    price_by_ticker = {}
    if all_tickers:
        with ThreadPoolExecutor(max_workers=min(len(all_tickers), 8)) as pool:
            for ticker, price in zip(all_tickers, pool.map(lambda t: _fetch_live_price(t, delay), all_tickers)):
                price_by_ticker[ticker] = price

    # Each holding's daily %change - real for a stock (live quote), an
    # estimate for a fund - kept STRICTLY SEPARATE from current_price/
    # total_value above (those stay the real, officially published NAV -
    # see _fund_estimated_daily_change_pct's docstring for why). Done per
    # distinct ticker, same reasoning as the price batch above.
    daily_change_by_ticker = {ticker: _daily_change(ticker, delay) for ticker in all_tickers}
    # Separate OFFICIAL-only version (no fund estimate) for the portfolio-
    # wide "Bugün" headline gain - see _official_daily_change_pct's docstring.
    official_daily_change_by_ticker = {ticker: _official_daily_change_pct(ticker, delay) for ticker in all_tickers}

    response_list = []
    for p in portfolios:
        assets_responses = []
        total_cost = 0.0
        total_value = 0.0

        for asset in p.assets:
            ticker = asset.ticker.upper()
            metrics = calculate_asset_metrics(asset, live_price=price_by_ticker.get(ticker))
            daily_change_pct, daily_change_is_estimate = daily_change_by_ticker.get(ticker, (None, False))
            metrics["daily_change_pct"] = daily_change_pct
            metrics["daily_change_is_estimate"] = daily_change_is_estimate
            metrics["daily_gain_value"] = (
                metrics["total_value"] * daily_change_pct / 100
                if daily_change_pct is not None else None
            )
            official_daily_change_pct = official_daily_change_by_ticker.get(ticker)
            metrics["official_daily_change_pct"] = official_daily_change_pct
            metrics["official_daily_gain_value"] = (
                metrics["total_value"] * official_daily_change_pct / 100
                if official_daily_change_pct is not None else None
            )
            assets_responses.append(PortfolioAssetResponse(**metrics))

            total_cost += asset.shares * asset.average_cost
            total_value += metrics["total_value"]

        # USD cash converts to TL at the CURRENT live rate every time this
        # is read (not the rate at deposit time) - see Portfolio.
        # usd_cash_balance's docstring for why. Cash/VİOP teminatı/USD cash
        # all fold 1:1 into total_cost and total_value (never just one
        # side) - none has profit/loss of its own, matching admin.py's
        # get_managed_portfolio exactly (this is the SAME Portfolio row an
        # admin manages via Yönetilen Portföyler; previously this endpoint
        # never read cash_balance/viop_margin at all, so an admin-entered
        # deposit was saved to the DB correctly but silently never showed up
        # here - confirmed live).
        usd_cash_value_try = p.usd_cash_balance * _usd_try_rate()
        total_cost += p.cash_balance + p.viop_margin + usd_cash_value_try
        total_value += p.cash_balance + p.viop_margin + usd_cash_value_try
        total_profit = total_value - total_cost
        profit_pct = (total_profit / total_cost * 100) if total_cost > 0 else 0.0

        p_dict = {
            "id": p.id,
            "user_id": p.user_id,
            "name": p.name,
            "assets": assets_responses,
            "cash_balance": p.cash_balance,
            "viop_margin": p.viop_margin,
            "usd_cash_balance": p.usd_cash_balance,
            "usd_cash_value_try": round(usd_cash_value_try, 2),
            "total_cost": total_cost,
            "total_value": total_value,
            "total_profit": total_profit,
            "profit_percentage": profit_pct,
            "created_at": p.created_at,
            "updated_at": p.updated_at
        }
        response_list.append(PortfolioResponse(**p_dict))

    return response_list

@router.get("/history")
def get_portfolio_history(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Equity curve: daily total-portfolio-value snapshots recorded by
    PortfolioSnapshotService's daily scheduler (see app/services/
    portfolio_snapshot.py). Honest limitation: no historical backfill is
    possible - nothing recorded portfolio value before this feature
    existed, so the curve only has data from whenever the daily snapshot
    job first ran on this deployment and accumulates one point per day
    from there."""
    snapshots = (
        db.query(PortfolioSnapshot)
        .filter(PortfolioSnapshot.user_id == current_user.id)
        .order_by(PortfolioSnapshot.snapshot_date.asc())
        .all()
    )
    history = [
        {"date": s.snapshot_date.isoformat(), "total_value": s.total_value}
        for s in snapshots
    ]

    # Zaman-ağırlıklı getiri: eğrinin ham yükselişi ile gerçek performansı
    # ayırır. Para yatırınca eğri yükselir ama bu kazanç değildir - endeksle
    # karşılaştırma da o yüzden bu düzeltme olmadan yanıltıcıdır.
    portfolio_ids = _user_portfolio_ids(db, current_user.id)
    transactions = []
    if portfolio_ids and history:
        # Yalnızca grafiğin kapsadığı aralık çekiliyor ve yalnızca akış
        # doğuran tipler. Önceden burada koşulsuz bir .all() vardı: TWR için
        # kullanıcının BÜTÜN hareket defteri, her sayfa açılışında ve her
        # işlemden sonra (loadData her mutasyonda bunu yeniden çağırıyor)
        # baştan sona okunuyordu. Hesaba giren tek şey bu aralıktaki akışlar
        # olduğu için gerisi zaten boşa okumaydı; defter büyüdükçe maliyeti
        # sınırsız artıyordu.
        first_day = datetime.fromisoformat(history[0]["date"])
        transactions = (
            db.query(PortfolioTransaction)
            .filter(
                PortfolioTransaction.portfolio_id.in_(portfolio_ids),
                PortfolioTransaction.transaction_type.in_(("BUY", "SELL", "CASH")),
                PortfolioTransaction.executed_at >= first_day,
            )
            .order_by(PortfolioTransaction.executed_at.asc())
            .all()
        )

    performance = portfolio_ledger.compute_time_weighted_return(history, transactions)

    # Reel getiri: nominal TWR tek başına yanıltıcı - Türkiye'de %30 kazanç
    # TÜFE %40 iken aslında kayıptır. TCMB'nin resmi enflasyon hesaplayıcısı
    # (app/services/inflation.py) ay hassasiyetinde çalıştığı için history'nin
    # ilk günü bir aydan az önceyse (yeni açılmış portföy) None döner - bu
    # beklenen bir durum, hata değil.
    real_return = None
    if performance and history:
        start_date = datetime.fromisoformat(history[0]["date"]).date()
        end_date = datetime.now().date()
        real_return = inflation.real_return_summary(performance["twr_pct"], start_date, end_date)
        if real_return is not None:
            real_return["deposit_alt_pct"] = inflation.deposit_alt_return_pct(start_date, end_date)
            real_return["usd_alt_pct"] = inflation.alt_asset_return_pct("USD", start_date)
            real_return["gold_alt_pct"] = inflation.alt_asset_return_pct("gram-altin", start_date)

    return {
        "history": history,
        "benchmark": _benchmark_series(history),
        "performance": performance,
        "real_return": real_return,
    }


# Portföy eğrisinin yanına konulacak endeks serisi. "Kazandım mı" sorusunun
# tek başına anlamlı bir cevabı yok - asıl soru "endeksi yendim mi": %5
# kazanç, XU100 %12 yükseldiyse aslında geride kalmaktır. Snapshot verisi
# zaten günlük olduğu için karşılaştırma için gereken tek şey aynı günlerin
# endeks kapanışları.
_BENCHMARK_SYMBOL = "XU100"
_BENCHMARK_CACHE_TTL_SECONDS = 3600


def _benchmark_series(history: List[dict]) -> List[dict]:
    """history'deki her gün için XU100'ün o günkü kapanışını, portföyle aynı
    başlangıç noktasına normalize edilmiş şekilde döner.

    Normalizasyon şart: XU100 ~10.000 seviyesinde, kullanıcının portföyü
    belki ₺6.000 - ham değerleri aynı eksene koymak ikisini de okunmaz
    yapardı. İkisi de ilk günün değerine göre yüzde olarak veriliyor, yani
    grafikte gerçekten karşılaştırılabilir iki eğri oluyor.

    Endeks kapanışı bulunamayan gün atlanır (eksik veriyi uydurmaktansa
    boşluk bırakmak doğru) - bu yüzden dönen liste history'den kısa olabilir.
    """
    if len(history) < 2:
        # Tek nokta için "performans" diye bir şey yok, karşılaştırma da yok.
        return []

    # Anahtar TÜM tarih kümesinden türetiliyor, yalnızca ilk/son günden
    # değil: dönen seri kullanıcının kendi anlık görüntü günlerine
    # hizalanıyor, dolayısıyla başlangıcı ve sonu aynı ama arası farklı iki
    # kullanıcı (biri bir süre uygulamayı açmamışsa) aynı anahtarı paylaşıp
    # birbirinin serisini okuyordu - grafikte kendi eğrisiyle örtüşmeyen
    # fazladan ya da eksik noktalar beliriyordu.
    dates_fingerprint = hashlib.sha1(
        ",".join(h["date"] for h in history).encode()
    ).hexdigest()[:16]
    cache_key = f"portfolio:benchmark:{_BENCHMARK_SYMBOL}:{dates_fingerprint}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    try:
        # Snapshot sayısından biraz fazlasını istiyoruz: takvim günleri ile
        # işlem günleri birebir örtüşmez (hafta sonu/tatil), aradaki farkı
        # kapatmak için pay bırakılıyor.
        candles = market_data_service.get_candles(
            _BENCHMARK_SYMBOL, "1d", count=len(history) + 40, wait=False, subscribe=False
        )
    except Exception as e:
        logger.warning(f"Benchmark serisi alınamadı: {e}")
        return []

    if not candles:
        return []

    close_by_date = {}
    for c in candles:
        ts = c.get("time")
        close = c.get("close")
        if ts is None or close is None:
            continue
        close_by_date[datetime.fromtimestamp(ts, tz=timezone.utc).date().isoformat()] = float(close)

    aligned = [(h["date"], close_by_date[h["date"]]) for h in history if h["date"] in close_by_date]
    if len(aligned) < 2:
        return []

    base_index = aligned[0][1]
    # Yalnızca endeksin kendi tabanı kontrol ediliyor. Burada bir de
    # portföyün ilk günkü değeri kontrol ediliyordu, ama o değer bu
    # fonksiyonun ürettiği seride hiç kullanılmıyor - endeks yalnızca kendi
    # ilk kapanışına göre normalize ediliyor. Sonuç: anlık görüntüleri
    # varlık girilmeden önce başlamış (ilk gün değeri 0) bir kullanıcı,
    # bütün endeks verisi elde olmasına rağmen karşılaştırma çizgisini
    # hiçbir zaman göremiyordu.
    if not base_index:
        return []

    series = [
        {
            "date": d,
            "index_close": close,
            "index_change_pct": round((close / base_index - 1) * 100, 2),
        }
        for d, close in aligned
    ]
    cache_service.set_json(cache_key, series, expire_seconds=_BENCHMARK_CACHE_TTL_SECONDS)
    return series

# Redis-backed cache for /analytics, keyed by (user_id, holdings composition) -
# not by live-priced total_value, since that changes on every quote tick and
# would defeat caching entirely. Beta/Sharpe/volatility come from historical
# daily closes and don't meaningfully change within minutes, so a real
# composition change (buy/sell/add) invalidates the cache immediately (new
# key), while repeat visits with the same holdings hit cache instead of
# re-fetching 6mo history per ticker from TradingView every time - that
# network round-trip was the actual cause of "Portföyüm" taking many
# seconds to render every single time it was opened. Backed by Redis (not
# process memory) so it survives backend restarts/redeploys and stays
# consistent across multiple backend instances.
_ANALYTICS_CACHE_TTL_SECONDS = 900


@router.get("/analytics")
def get_portfolio_analytics(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Real sector/asset-type allocation and genuine Beta/Sharpe/volatility
    computed from historical returns (see portfolio_analytics.py) - across
    every portfolio the user owns, combined into one allocation view."""
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    all_assets = [asset for p in portfolios for asset in p.assets]

    if not all_assets:
        return {
            "sector_breakdown": [], "asset_type_breakdown": [],
            "beta": None, "sharpe": None, "volatility_pct": None,
            "annualized_return_pct": None, "risk_free_rate_pct": None,
            "risk_metrics_note": "Portföyünüzde henüz varlık bulunmuyor.",
        }

    composition = sorted((a.ticker.upper(), round(a.shares, 4)) for a in all_assets)
    composition_key = "|".join(f"{ticker}:{shares}" for ticker, shares in composition)
    cache_key = f"portfolio_analytics:{current_user.id}:{composition_key}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    tickers = sorted({a.ticker.upper() for a in all_assets})
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        price_by_ticker = dict(zip(tickers, pool.map(_fetch_live_price, tickers)))

    asset_values = []
    for a in all_assets:
        price = price_by_ticker.get(a.ticker.upper()) or a.average_cost
        asset_values.append({"ticker": a.ticker.upper(), "total_value": a.shares * price})

    result = compute_portfolio_analytics(asset_values)

    # "Yaklaşan Ödemeler" paneli için - backend'de ayrı bir temettü takvimi
    # veri kaynağı yok, bu yüzden gerçek bir ÖDEME tarihi değil, kullanıcının
    # elindeki hisselerle ilgili KAP'ın kâr payı dağıtım bildirimlerinin
    # yayın tarihi kullanılıyor. Frontend bunu net biçimde "KAP Bildirimi"
    # olarak etiketlemeli - kesinleşmiş bir ödeme takvimi gibi sunulmamalı.
    dividend_notices = (
        db.query(KapNotification)
        .filter(
            KapNotification.ticker.in_(tickers),
            (KapNotification.title.ilike("%kar pay%"))
            | (KapNotification.title.ilike("%kâr pay%"))
            | (KapNotification.title.ilike("%temettü%")),
        )
        .order_by(KapNotification.publish_date.desc())
        .limit(5)
        .all()
    )
    result["dividend_notices"] = [
        {
            "ticker": n.ticker,
            "title": n.title,
            "publish_date": n.publish_date.isoformat() if n.publish_date else None,
        }
        for n in dividend_notices
    ]

    cache_service.set_json(cache_key, result, expire_seconds=_ANALYTICS_CACHE_TTL_SECONDS)
    return result


@router.get("/live-estimate")
def get_portfolio_live_estimate(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
    delay: int = Depends(deps.get_data_delay_minutes),
):
    """Estimated INTRADAY % change for the user's whole portfolio (combined
    across every portfolio they own, like /analytics) - the same idea as
    GET /funds/popular/live-estimate but applied to whatever the user
    actually holds, weighted by each holding's CURRENT market value share
    of the total (not by any fund's disclosed internal weights).

    A fund holding uses tefas_service.get_live_estimated_return() when its
    composition is known well enough to trust (recursing into sub-fund
    holdings the same way funds.py does), falling back to that fund's last
    real TEFAS daily_return otherwise. A stock holding uses its live
    change_percent. This is explicitly an estimate, not a real intraday
    portfolio NAV recalculation.
    """
    portfolios = db.query(Portfolio).filter(Portfolio.user_id == current_user.id).all()
    all_assets = [asset for p in portfolios for asset in p.assets]

    if not all_assets:
        return {
            "estimated_change_pct": None, "estimated_daily_gain_value": None,
            "resolved_value_pct": 0.0, "total_value": 0.0, "holdings": [],
        }

    tickers = sorted({a.ticker.upper() for a in all_assets})
    with ThreadPoolExecutor(max_workers=min(len(tickers), 8)) as pool:
        price_by_ticker = dict(zip(tickers, pool.map(lambda t: _fetch_live_price(t, delay), tickers)))

    holdings_out = []
    total_value = 0.0
    weighted_change_sum = 0.0
    resolved_value = 0.0

    for asset in all_assets:
        ticker = asset.ticker.upper()
        price = price_by_ticker.get(ticker) or asset.average_cost
        value = asset.shares * price
        total_value += value

        change_pct = None
        holding_type = "unresolved"

        if len(ticker) == 3:
            live_est = tefas_service.get_live_estimated_return(ticker, delay_minutes=delay)
            if live_est is not None and live_est["resolved_weight_pct"] >= _MIN_TRUSTED_RESOLVED_PCT:
                change_pct = live_est["estimated_change_pct"]
                holding_type = "fund_live"
            else:
                fund = tefas_service.get_fund(ticker)
                if fund is not None:
                    change_pct = fund.get("daily_return")
                    holding_type = "fund_daily"
        else:
            is_known = market_data_service.is_known_ticker(ticker)
            quote = None
            if is_known:
                quote = market_data_service.get_delayed_quote(ticker, delay) if delay > 0 else market_data_service.get_quote(ticker)
            if quote and quote.get("change_percent") is not None:
                change_pct = float(quote["change_percent"])
                holding_type = "stock"

        if change_pct is not None:
            weighted_change_sum += value * change_pct
            resolved_value += value

        holdings_out.append({
            "ticker": ticker,
            "value": round(value, 2),
            "change_pct": change_pct,
            "type": holding_type,
        })

    # None (not 0.0) when nothing resolved - a portfolio with zero coverage
    # genuinely has no estimate, and showing "0.0%" would misleadingly read
    # as "flat today" instead of "unknown".
    estimated_change_pct = round(weighted_change_sum / total_value, 2) if resolved_value > 0 else None
    resolved_value_pct = round(resolved_value / total_value * 100, 2) if total_value > 0 else 0.0
    # weighted_change_sum is already SUM(value * change_pct) over resolved
    # holdings, i.e. the TL-equivalent of the weighted %-change sum divided
    # by 100 - so this is the actual ₺ amount the estimate implies for
    # today, not just a derived re-multiplication of the rounded % above.
    estimated_daily_gain_value = round(weighted_change_sum / 100, 2) if resolved_value > 0 else None

    return {
        "estimated_change_pct": estimated_change_pct,
        "estimated_daily_gain_value": estimated_daily_gain_value,
        "resolved_value_pct": resolved_value_pct,
        "total_value": round(total_value, 2),
        "holdings": sorted(holdings_out, key=lambda h: h["value"], reverse=True),
    }


@router.post("/", response_model=PortfolioResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def create_portfolio(
    request: Request,
    portfolio_in: PortfolioCreate,
    response: Response,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Create a new portfolio. Idempotent by name per user: the frontend
    auto-creates a default "Ana Portföyüm" portfolio whenever a user has
    none, and two concurrent loadData() calls can both see zero portfolios
    and both POST here before either commit lands, producing duplicate
    empty defaults. If a portfolio with this exact name already exists for
    the user, return it instead of creating another one."""
    existing = (
        db.query(Portfolio)
        .filter(Portfolio.user_id == current_user.id, Portfolio.name == portfolio_in.name)
        .first()
    )

    if existing:
        db_portfolio = existing
        response.status_code = status.HTTP_200_OK
    else:
        db_portfolio = Portfolio(name=portfolio_in.name, user_id=current_user.id)
        db.add(db_portfolio)
        db.commit()
        db.refresh(db_portfolio)

    return _portfolio_response(db_portfolio)


def _portfolio_response(portfolio: Portfolio) -> PortfolioResponse:
    """Tek bir portföyü, varlıklarının anlık değerleriyle birlikte
    serileştirir. Liste endpoint'i (get_user_portfolios) fiyatları toplu ve
    eşzamanlı çektiği için ayrı bir yol izliyor; burası tek portföy dönen
    uçlar (oluştur / yeniden adlandır) için."""
    assets_responses = []
    total_cost = 0.0
    total_value = 0.0
    for asset in portfolio.assets:
        metrics = calculate_asset_metrics(asset)
        assets_responses.append(PortfolioAssetResponse(**metrics))
        total_cost += asset.shares * asset.average_cost
        total_value += metrics["total_value"]
    total_profit = total_value - total_cost
    profit_pct = (total_profit / total_cost * 100) if total_cost > 0 else 0.0

    return PortfolioResponse(
        id=portfolio.id,
        user_id=portfolio.user_id,
        name=portfolio.name,
        assets=assets_responses,
        cash_balance=portfolio.cash_balance,
        viop_margin=portfolio.viop_margin,
        usd_cash_balance=portfolio.usd_cash_balance,
        usd_cash_value_try=round(portfolio.usd_cash_balance * _usd_try_rate(), 2),
        total_cost=total_cost,
        total_value=total_value,
        total_profit=total_profit,
        profit_percentage=profit_pct,
        created_at=portfolio.created_at,
        updated_at=portfolio.updated_at
    )

class PortfolioRename(BaseModel):
    name: str


@router.put("/{id}", response_model=PortfolioResponse)
@limiter.limit("30/minute")
def rename_portfolio(
    request: Request,
    id: int,
    payload: PortfolioRename,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Portföyü yeniden adlandırır."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Portföy adı boş olamaz.")

    portfolio.name = name
    db.commit()
    db.refresh(portfolio)
    return _portfolio_response(portfolio)


@router.delete("/{id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("20/minute")
def delete_portfolio(
    request: Request,
    id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Portföyü ve içindeki her şeyi (varlıklar, hareket geçmişi) siler.

    Son kalan portföy silinemez: uygulamanın her yeri en az bir portföyün
    var olduğunu varsayıyor (varsayılan portföy araması, otomatik oluşturma
    akışı), ve sıfır portföyle kullanıcı boş bir ekranda kalırdı. Sayım ve
    silme, aradaki yarışı kapatmak için satır kilidi altında yapılıyor -
    iki sekmeden iki farklı portföyü aynı anda silmek, ikisi de kontrolü
    geçtiği için kullanıcıyı sıfır portföyle bırakabilirdi.
    """
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    siblings = (
        db.query(Portfolio).filter(Portfolio.user_id == current_user.id)
        .with_for_update().all()
    )
    if len(siblings) <= 1:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Son kalan portföyünüzü silemezsiniz.",
        )

    db.delete(portfolio)
    db.commit()
    return None


@router.post("/{id}/assets", response_model=PortfolioAssetResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def add_asset_to_portfolio(
    request: Request,
    id: int,
    asset_in: PortfolioAssetCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Add a stock asset to the portfolio or recalculate weighted cost if it
    already exists. Records a BUY row in the portfolio ledger either way -
    see app/services/portfolio_ledger.py, which owns the weighted-average
    merge so this and the admin managed-portfolio equivalent can't drift."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    asset_obj = portfolio_ledger.record_buy(
        db, portfolio_id=id, ticker=asset_in.ticker,
        shares=asset_in.shares, price=asset_in.average_cost,
        executed_at=asset_in.executed_at,
    )
    db.commit()
    db.refresh(asset_obj)

    metrics = calculate_asset_metrics(asset_obj)
    return PortfolioAssetResponse(**metrics)

@router.delete("/assets/{asset_id}", status_code=status.HTTP_204_NO_CONTENT)
@limiter.limit("30/minute")
def remove_asset_from_portfolio(
    request: Request,
    asset_id: int,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Remove an asset from portfolio."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    db.delete(asset)
    db.commit()
    return None

class AssetUpdate(BaseModel):
    shares: float
    average_cost: float

class UsdCashAdjustIn(BaseModel):
    # Signed delta in raw USD, not TL - positive deposits, negative
    # withdraws/corrects. Same shape as admin.py's ManagedUsdCashAdjustIn,
    # but self-service: the user manages their OWN portfolio's USD cash
    # directly (unlike cash_balance/viop_margin, which stay admin-only via
    # Yönetilen Portföyler for now - see Portfolio.cash_balance's
    # docstring) since they explicitly asked to add dollars to their own
    # Portföyüm without going through an admin.
    amount: float

@router.post("/{id}/usd-cash")
@limiter.limit("30/minute")
def adjust_own_usd_cash(
    request: Request,
    id: int,
    payload: UsdCashAdjustIn,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Deposits (positive amount) or withdraws (negative amount) cash held
    directly in USD in the current user's OWN portfolio - mirrors admin.py's
    adjust_managed_usd_cash, just scoped to the caller's own Portfolio row
    instead of an admin acting on someone else's. Its TL value is computed
    fresh at the live USD/TRY rate on every read (see _usd_try_rate()), not
    converted once at deposit time."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")
    if payload.amount == 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Tutar sıfır olamaz.")

    new_balance = portfolio.usd_cash_balance + payload.amount
    if new_balance < 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Yetersiz döviz nakti: mevcut bakiye ${portfolio.usd_cash_balance:.2f}, "
                   f"${-payload.amount:.2f} çıkarılamaz.",
        )
    portfolio.usd_cash_balance = new_balance

    # Deftere işaretli bir nakit hareketi olarak yazılıyor: bu para portföy
    # değerini yükseltir/düşürür ama performans değildir. Zaman-ağırlıklı
    # getiri bu kaydı görmezse, kullanıcının yatırdığı parayı kazanç sanar
    # (bkz. portfolio_ledger.compute_time_weighted_return). Tutar, işlem
    # anındaki kurdan TL'ye çevrilip saklanıyor - sonradan kur değişse de
    # o gün gerçekte ne kadar para girdiği değişmemeli.
    portfolio_ledger.record_cash_flow(
        db, portfolio_id=portfolio.id,
        amount_try=payload.amount * _usd_try_rate(),
        note=f"Döviz nakit {'girişi' if payload.amount > 0 else 'çıkışı'} (${abs(payload.amount):.2f})",
    )
    db.commit()
    db.refresh(portfolio)

    return {"usd_cash_balance": portfolio.usd_cash_balance, "usd_cash_value_try": round(portfolio.usd_cash_balance * _usd_try_rate(), 2)}

@router.put("/assets/{asset_id}", response_model=PortfolioAssetResponse)
@limiter.limit("30/minute")
def update_portfolio_asset(
    request: Request,
    asset_id: int,
    asset_in: AssetUpdate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Update asset lot quantity and average cost."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    asset.shares = asset_in.shares
    asset.average_cost = asset_in.average_cost
    db.commit()
    db.refresh(asset)

    metrics = calculate_asset_metrics(asset)
    return PortfolioAssetResponse(**metrics)

@router.post("/assets/{asset_id}/sell", response_model=Optional[PortfolioAssetResponse])
@limiter.limit("30/minute")
def sell_portfolio_asset(
    request: Request,
    asset_id: int,
    sell_in: AssetSell,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Sell a partial or complete amount of shares, recording the realized
    profit/loss against the position's average cost at sale time (see
    portfolio_ledger.record_sell). Deletes the asset if nothing is left.

    Previously this just decremented `shares` (or deleted the row) and kept
    NO record at all - not the date, not even the sale price, which it
    didn't ask for - so a user could never see what they had actually
    earned. `price` is optional purely so an older client that doesn't send
    it still works; in that case the current live price is used, which is
    the closest honest stand-in for "sold at market right now"."""
    asset = db.query(PortfolioAsset).join(Portfolio).filter(
        PortfolioAsset.id == asset_id,
        Portfolio.user_id == current_user.id
    ).first()

    if not asset:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Asset not found")

    if sell_in.shares <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Satış adedi sıfırdan büyük olmalı.")
    if sell_in.shares > asset.shares + 1e-9:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Yetersiz pozisyon: elinizde {asset.shares:g} lot var.",
        )

    sell_price = sell_in.price
    if sell_price is None:
        sell_price = _fetch_live_price(asset.ticker) or asset.average_cost

    remaining, _realized = portfolio_ledger.record_sell(
        db, asset, shares=sell_in.shares, price=sell_price,
        executed_at=sell_in.executed_at,
    )
    db.commit()

    if remaining is None:
        return None

    db.refresh(remaining)
    metrics = calculate_asset_metrics(remaining)
    return PortfolioAssetResponse(**metrics)


def _user_portfolio_ids(db: Session, user_id: int) -> List[int]:
    return [row[0] for row in db.query(Portfolio.id).filter(Portfolio.user_id == user_id).all()]


@router.get("/transactions", response_model=List[PortfolioTransactionResponse])
def get_portfolio_transactions(
    ticker: Optional[str] = None,
    limit: int = 200,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """The user's portfolio ledger (alış/satış/temettü/bedelsiz), newest
    first, across all their portfolios - optionally filtered to one ticker
    for the per-holding history view."""
    portfolio_ids = _user_portfolio_ids(db, current_user.id)
    if not portfolio_ids:
        return []

    query = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.portfolio_id.in_(portfolio_ids)
    )
    if ticker:
        query = query.filter(PortfolioTransaction.ticker == ticker.upper())

    rows = query.order_by(
        PortfolioTransaction.executed_at.desc(), PortfolioTransaction.id.desc()
    ).limit(max(1, min(limit, 1000))).all()
    return [PortfolioTransactionResponse.model_validate(r) for r in rows]


@router.get("/realized")
def get_realized_performance(
    year: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Gerçekleşen (kapatılmış) performans - portföyün ANLIK değerinden
    bağımsız olarak, satışlardan elde edilen kâr/zarar ve alınan temettü.

    Bu, sayfanın geri kalanının gösterdiği "şu an elimdekinin kârı"
    (unrealized) rakamından ayrı bir şey: burada satılıp bitmiş işler ve
    cebe giren temettü var. İkisinin toplamı gerçek toplam getiridir.

    `year` verilirse sadece o takvim yılı (yıllık kazanç özeti için).
    """
    portfolio_ids = _user_portfolio_ids(db, current_user.id)
    if not portfolio_ids:
        return {
            "year": year, "realized_pnl": 0.0, "dividend_income": 0.0,
            "total_realized": 0.0, "sell_count": 0, "dividend_count": 0, "by_ticker": [],
        }

    query = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.portfolio_id.in_(portfolio_ids),
        PortfolioTransaction.transaction_type.in_(("SELL", "DIVIDEND")),
    )
    if year:
        # Yıl sınırlarını Python tarafında kurmak, SQLite ve Postgres'te
        # farklı davranan tarih fonksiyonlarına (strftime vs EXTRACT)
        # bağımlı kalmamak için tercih edildi.
        start = datetime(year, 1, 1)
        end = datetime(year + 1, 1, 1)
        query = query.filter(
            PortfolioTransaction.executed_at >= start,
            PortfolioTransaction.executed_at < end,
        )

    rows = query.all()

    realized_pnl = sum(r.realized_pnl or 0.0 for r in rows if r.transaction_type == "SELL")
    dividend_income = sum(r.amount for r in rows if r.transaction_type == "DIVIDEND")

    per_ticker: dict = {}
    for r in rows:
        entry = per_ticker.setdefault(r.ticker, {"ticker": r.ticker, "realized_pnl": 0.0, "dividend_income": 0.0})
        if r.transaction_type == "SELL":
            entry["realized_pnl"] += r.realized_pnl or 0.0
        else:
            entry["dividend_income"] += r.amount

    by_ticker = sorted(
        (
            {**v, "total": round(v["realized_pnl"] + v["dividend_income"], 2),
             "realized_pnl": round(v["realized_pnl"], 2),
             "dividend_income": round(v["dividend_income"], 2)}
            for v in per_ticker.values()
        ),
        key=lambda x: x["total"], reverse=True,
    )

    return {
        "year": year,
        "realized_pnl": round(realized_pnl, 2),
        "dividend_income": round(dividend_income, 2),
        "total_realized": round(realized_pnl + dividend_income, 2),
        "sell_count": sum(1 for r in rows if r.transaction_type == "SELL"),
        "dividend_count": sum(1 for r in rows if r.transaction_type == "DIVIDEND"),
        "by_ticker": by_ticker,
    }


@router.get("/annual-summary")
def get_annual_summary(
    year: Optional[int] = None,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Yıllık kazanç özeti: bir takvim yılında kapatılan işlemlerden doğan
    kâr/zarar ve alınan temettü, hem ORTALAMA MALİYET hem FIFO yöntemiyle.

    İki yöntemi birden veriyor çünkü ikisi de meşru ve farklı sonuç
    veriyor: uygulamanın pozisyon ekranı ortalama maliyet kullanıyor
    (tutarlılık için), vergi hesabında ise genellikle lot sırası
    (FIFO) esas alınır. Hangisinin sizin durumunuza uygun olduğunu
    söylemek bu uygulamanın işi değil - ikisi de gösterilip fark açıkça
    belirtiliyor.

    FIFO, defterin TAMAMI üzerinden yürütülür (yıl filtresi sadece hangi
    satışların sayılacağını belirler) - çünkü bu yıl satılan bir lotun
    maliyeti geçen yılki bir alıştan gelir.
    """
    year = year or datetime.now().year
    portfolio_ids = _user_portfolio_ids(db, current_user.id)

    empty = {
        "year": year, "average_cost": {"realized_pnl": 0.0}, "fifo": {"realized_pnl": 0.0},
        "dividend_income": 0.0, "sell_count": 0, "dividend_count": 0,
        "by_ticker": [], "has_incomplete_basis": False, "available_years": [],
    }
    if not portfolio_ids:
        return empty

    all_tx = (
        db.query(PortfolioTransaction)
        .filter(PortfolioTransaction.portfolio_id.in_(portfolio_ids))
        .order_by(PortfolioTransaction.executed_at.asc(), PortfolioTransaction.id.asc())
        .all()
    )
    if not all_tx:
        return empty

    def _in_year(tx) -> bool:
        executed = tx.executed_at
        if executed is None:
            return False
        # İSTANBUL takvim yılına göre. Daha önce burada .replace(tzinfo=None)
        # vardı, yani Postgres'in UTC değeri yerel saat sanılıyordu: İstanbul
        # UTC+3 olduğu için 1 Ocak gecesi 01:30'da yapılan bir satış UTC'de
        # 31 Aralık 22:30 görünüp BİR ÖNCEKİ vergi yılına düşüyordu. Bu ekran
        # kullanıcıya açıkça "Yıllık Kazanç Özeti" olarak sunulduğu için
        # işlemin hangi yıla sayıldığı doğrudan önemli.
        return portfolio_ledger.local_date(executed).year == year

    year_tx = [t for t in all_tx if _in_year(t)]

    avg_realized = sum(t.realized_pnl or 0.0 for t in year_tx if t.transaction_type == "SELL")
    dividend_income = sum(t.amount for t in year_tx if t.transaction_type == "DIVIDEND")

    # FIFO tüm defterden hesaplanır, sonra sadece bu yılın satışları alınır.
    fifo_all = portfolio_ledger.compute_fifo_realized(all_tx)
    year_dates = {
        t.executed_at.isoformat() if t.executed_at else None
        for t in year_tx if t.transaction_type == "SELL"
    }
    fifo_sales = [s for s in fifo_all["sales"] if s["date"] in year_dates]
    fifo_realized = round(sum(s["realized_pnl"] for s in fifo_sales), 2)

    per_ticker: dict = {}
    for t in year_tx:
        if t.transaction_type not in ("SELL", "DIVIDEND"):
            continue
        e = per_ticker.setdefault(t.ticker, {"ticker": t.ticker, "realized_pnl": 0.0, "dividend_income": 0.0})
        if t.transaction_type == "SELL":
            e["realized_pnl"] += t.realized_pnl or 0.0
        else:
            e["dividend_income"] += t.amount

    available_years = sorted({
        portfolio_ledger.local_date(t.executed_at).year for t in all_tx if t.executed_at
    }, reverse=True)

    return {
        "year": year,
        "average_cost": {"realized_pnl": round(avg_realized, 2)},
        "fifo": {"realized_pnl": fifo_realized, "sales": fifo_sales},
        "dividend_income": round(dividend_income, 2),
        "total_average_cost": round(avg_realized + dividend_income, 2),
        "total_fifo": round(fifo_realized + dividend_income, 2),
        "sell_count": sum(1 for t in year_tx if t.transaction_type == "SELL"),
        "dividend_count": sum(1 for t in year_tx if t.transaction_type == "DIVIDEND"),
        "by_ticker": sorted(
            ({**v, "realized_pnl": round(v["realized_pnl"], 2),
              "dividend_income": round(v["dividend_income"], 2),
              "total": round(v["realized_pnl"] + v["dividend_income"], 2)}
             for v in per_ticker.values()),
            key=lambda x: x["total"], reverse=True,
        ),
        # Defterden önce açılmış bir pozisyonun satışı varsa maliyet tabanı
        # eksiktir; rakamı olduğu gibi "vergi beyanı" diye sunmak yanlış olur.
        "has_incomplete_basis": any(s["incomplete"] for s in fifo_sales),
        "available_years": available_years,
    }


@router.post("/{id}/dividends", response_model=PortfolioTransactionResponse, status_code=status.HTTP_201_CREATED)
@limiter.limit("30/minute")
def add_dividend(
    request: Request,
    id: int,
    payload: DividendCreate,
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user),
):
    """Alınan temettüyü kaydeder. Pozisyonun lotunu/maliyetini değiştirmez -
    sadece nakit geliri olarak deftere işlenir, böylece toplam getiri
    (fiyat kazancı + temettü) hesaplanabilir."""
    portfolio = db.query(Portfolio).filter(Portfolio.id == id, Portfolio.user_id == current_user.id).first()
    if not portfolio:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Portfolio not found")

    if payload.per_share <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lot başına temettü sıfırdan büyük olmalı.")

    shares = payload.shares
    if shares is None:
        # Lot verilmediyse mevcut pozisyondan al - kullanıcının elindeki
        # lotu elle yazmasını gerektirmemek için.
        asset = db.query(PortfolioAsset).filter(
            PortfolioAsset.portfolio_id == id,
            PortfolioAsset.ticker == payload.ticker.upper(),
        ).first()
        if not asset:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Bu hisse portföyünüzde yok - lot adedini elle girin.",
            )
        shares = asset.shares

    if shares <= 0:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Lot adedi sıfırdan büyük olmalı.")

    tx = portfolio_ledger.record_dividend(
        db, portfolio_id=id, ticker=payload.ticker, shares=shares,
        per_share=payload.per_share, tax=payload.tax,
        executed_at=payload.executed_at,
    )
    db.commit()
    db.refresh(tx)
    return PortfolioTransactionResponse.model_validate(tx)

# The Header component polls this every 15s, on every page, for every
# logged-in user (it's a global "AL/SAT" notification badge, not the
# primary trading view) - and each call runs a full 11-indicator technical
# analysis (SMA/EMA/RSI/MACD/VWAP/Supertrend/ATR/ADX) per ticker, falling
# back to a fresh borsapy history() network fetch for any ticker not
# already in the live-stream cache. Without caching, that repeats the same
# computation from scratch every 15s indefinitely for the same holdings -
# a real, constant background load contributing to overall app sluggishness.
# Daily-bar-based indicators don't meaningfully change within a couple of
# minutes, so this is cached per (user, holdings) like /analytics, and for
# the same reason lives in Redis rather than process memory.
_SIGNALS_CACHE_TTL_SECONDS = 120


@router.get("/signals")
def get_portfolio_signals(
    db: Session = Depends(deps.get_db),
    current_user: User = Depends(deps.get_current_user)
):
    """Generate technical analysis buy/sell alerts for portfolio assets."""
    assets = db.query(PortfolioAsset).join(Portfolio).filter(
        Portfolio.user_id == current_user.id
    ).all()

    # If the user has no assets, provide signals for BIST 30 popular stocks
    symbols_to_check = [asset.ticker for asset in assets]
    is_fallback = False
    if not symbols_to_check:
        symbols_to_check = ["THYAO", "EREGL", "TUPRS", "BIMAS", "ODINE"]
        is_fallback = True

    symbols_key = "|".join(sorted(t.upper() for t in symbols_to_check))
    cache_key = f"portfolio_signals:{current_user.id}:{symbols_key}"
    cached = cache_service.get_json(cache_key)
    if cached is not None:
        return cached

    signals = []
    from app.services.technical_analysis import TechnicalAnalysisService

    def _fetch_signal_candles(ticker: str):
        """
        Get daily OHLCV history for indicator calculation. First checks the
        shared live-stream cache (instant, subscribe=False so it never steals
        the single shared chart session that Hisseler/Fon pages rely on - see
        the SPECIAL_EXCHANGES / patched_subscribe_chart notes in
        market_data.py for why that session is exclusive).

        Previously this was the ONLY source, so any ticker whose 1d chart
        hadn't already been opened elsewhere in the app came back empty -
        which is why the Frantic Strateji panel kept showing "Yetersiz
        geçmiş veri" for tickers nobody had happened to chart yet. Now, if
        the cache is empty, it falls back to borsapy's one-shot get_history
        (Ticker(...).history()), which opens its OWN independent TradingView
        WebSocket session and closes it when done - safe to call concurrently
        for several tickers without disturbing anyone's live chart.
        """
        candles = market_data_service.get_candles(ticker, "1d", wait=False, subscribe=False)
        if candles and len(candles) >= 20:
            return ticker, candles

        try:
            import borsapy
            hist_df = borsapy.Ticker(ticker).history(period="1y", interval="1d")
            if hist_df is not None and not hist_df.empty:
                built = []
                for idx, row in hist_df.iterrows():
                    vol = row.get("Volume", 0.0)
                    built.append({
                        "time": int(idx.timestamp()),
                        "open": float(row["Open"]),
                        "high": float(row["High"]),
                        "low": float(row["Low"]),
                        "close": float(row["Close"]),
                        "volume": float(vol) if vol == vol else 0.0,  # NaN-safe
                    })
                if built:
                    return ticker, built
        except Exception as hist_err:
            logger.warning(f"borsapy history fallback failed for {ticker}: {hist_err}")

        return ticker, candles or []

    # Fetch every ticker's candles concurrently (each history() call is an
    # independent WS session) instead of one-by-one, so worst case is a single
    # symbol's timeout rather than N stacked timeouts.
    stock_tickers = [t.upper() for t in symbols_to_check if len(t.upper()) != 3]
    candles_by_ticker = {}
    if stock_tickers:
        with ThreadPoolExecutor(max_workers=min(len(stock_tickers), 5)) as pool:
            for ticker, candles in pool.map(_fetch_signal_candles, stock_tickers):
                candles_by_ticker[ticker] = candles

    for ticker in symbols_to_check:
        ticker = ticker.upper()
        if len(ticker) == 3:  # Skip funds (3 chars)
            continue

        candles = candles_by_ticker.get(ticker, [])
        if not candles or len(candles) < 20:
            signals.append({
                "ticker": ticker,
                "price": 0.0,
                "sma20": 0.0,
                "signal": "Takip Et",
                "description": "Yetersiz geçmiş veri nedeniyle teknik sinyal üretilemedi.",
                "color": "zinc",
                "timestamp": datetime.now().strftime("%H:%M:%S")
            })
            continue

        closes = [float(c["close"]) for c in candles]
        highs = [float(c["high"]) for c in candles]
        lows = [float(c["low"]) for c in candles]
        opens = [float(c["open"]) for c in candles]
        volumes = [float(c["volume"]) for c in candles]
        
        curr = closes[-1]
        
        # Calculate moving averages
        sma20_list = TechnicalAnalysisService.calculate_sma(closes, 20)
        ema20_list = TechnicalAnalysisService.calculate_ema(closes, 20)
        ema50_list = TechnicalAnalysisService.calculate_ema(closes, 50)
        ema200_list = TechnicalAnalysisService.calculate_ema(closes, 200) if len(closes) >= 200 else TechnicalAnalysisService.calculate_ema(closes, 50)
        
        sma20 = sma20_list[-1] if sma20_list else curr
        ema20 = ema20_list[-1] if ema20_list else curr
        ema50 = ema50_list[-1] if ema50_list else curr
        ema200 = ema200_list[-1] if ema200_list else curr
        
        # Calculate RSI
        rsi_list = TechnicalAnalysisService.calculate_rsi(closes, 14)
        rsi = rsi_list[-1] if rsi_list and rsi_list[-1] is not None else 50.0
        
        # Calculate MACD
        macd_line, sig_line, _ = TechnicalAnalysisService.calculate_macd(closes)
        macd_val = macd_line[-1] if macd_line and macd_line[-1] is not None else 0.0
        sig_val = sig_line[-1] if sig_line and sig_line[-1] is not None else 0.0
        
        # Calculate VWAP
        vwap_list = TechnicalAnalysisService.calculate_vwap(highs, lows, closes, volumes)
        vwap = vwap_list[-1] if vwap_list and vwap_list[-1] is not None else curr
        
        # Calculate Supertrend
        st_line, st_signals = TechnicalAnalysisService.calculate_supertrend(highs, lows, closes)
        st_signal = st_signals[-1] if st_signals else "Takip Et"
        
        # Calculate ATR & ADX
        atr_list = TechnicalAnalysisService.calculate_atr(highs, lows, closes, 14)
        atr = atr_list[-1] if atr_list and atr_list[-1] is not None else 1.0
        adx_list = TechnicalAnalysisService.calculate_adx(highs, lows, closes, 14)
        adx = adx_list[-1] if adx_list and adx_list[-1] is not None else 25.0
        
        # 11 Indicators Scoring
        buy_score = 0
        sell_score = 0
        
        # 1. SMA20
        if curr > sma20: buy_score += 1
        else: sell_score += 1
        
        # 2. EMA20
        if curr > ema20: buy_score += 1
        else: sell_score += 1
        
        # 3. EMA50
        if curr > ema50: buy_score += 1
        else: sell_score += 1
        
        # 4. EMA200
        if curr > ema200: buy_score += 1
        else: sell_score += 1
        
        # 5. RSI
        if rsi < 30: buy_score += 2
        elif rsi < 45: buy_score += 1
        elif rsi > 70: sell_score += 2
        elif rsi > 55: sell_score += 1
        
        # 6. MACD
        if macd_val > sig_val: buy_score += 1
        else: sell_score += 1
        
        # 7. Volume Spike
        avg_vol_10 = sum(volumes[-10:]) / 10.0 if len(volumes) >= 10 else 1.0
        if volumes[-1] > (1.8 * avg_vol_10):
            if curr > opens[-1]: buy_score += 1
            else: sell_score += 1
            
        # 8. VWAP
        if curr > vwap: buy_score += 1
        else: sell_score += 1
        
        # 9. Supertrend
        if st_signal == "AL": buy_score += 1
        elif st_signal == "SAT": sell_score += 1
        
        # 10. ATR (Volatility confirmation)
        vol_ratio = atr / curr if curr > 0 else 0
        if vol_ratio < 0.02 and curr > sma20:
            buy_score += 1
        elif vol_ratio > 0.04 and curr < sma20:
            sell_score += 1
            
        # 11. ADX (Trend strength)
        if adx > 25:
            if curr > ema50: buy_score += 1
            else: sell_score += 1

        # Map scores to output
        if buy_score >= 8:
            sig = "Güçlü AL"
            color = "emerald"
        elif buy_score >= 5:
            sig = "AL"
            color = "green"
        elif sell_score >= 8:
            sig = "Güçlü SAT"
            color = "rose"
        elif sell_score >= 5:
            sig = "SAT"
            color = "orange"
        else:
            sig = "Takip Et"
            color = "zinc"
            
        # Build dynamic details description
        total_ind = buy_score + sell_score
        desc = f"11 indikatörün {buy_score}'i AL, {sell_score}'si SAT yönünde. "
        
        # Highlights
        highlights = []
        if rsi < 30: highlights.append("RSI aşırı satım (ucuz) bölgesinde.")
        elif rsi > 70: highlights.append("RSI aşırı alım (pahalı) bölgesinde.")
        
        if macd_val > sig_val: highlights.append("MACD AL kesişimi koruyor.")
        else: highlights.append("MACD SAT kesişimi baskı oluşturuyor.")
        
        if curr > ema200: highlights.append("Fiyat uzun vadeli EMA200 trend desteğinin üzerinde.")
        else: highlights.append("Fiyat uzun vadeli EMA200 direncinin altında.")
        
        if st_signal == "AL": highlights.append("Supertrend AL sinyalini sürdürüyor.")
        
        desc += " ".join(highlights[:2])

        signals.append({
            "ticker": ticker,
            "price": round(curr, 2),
            "sma20": round(sma20, 2),
            "signal": sig,
            "description": desc,
            "color": color,
            "buy_score": buy_score,
            "sell_score": sell_score,
            "total_indicators": 11,
            "timestamp": datetime.now().strftime("%H:%M:%S")
        })

    result = {
        "is_fallback": is_fallback,
        "signals": signals
    }
    cache_service.set_json(cache_key, result, expire_seconds=_SIGNALS_CACHE_TTL_SECONDS)
    return result
