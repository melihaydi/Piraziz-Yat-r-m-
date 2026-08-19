"""Portföy hareket defteri: alış/satış geçmişi, gerçekleşen kâr/zarar,
temettü ve bedelsiz düzeltmesi."""
from datetime import date, datetime, timezone

import pytest

from app.models.portfolio import Portfolio, PortfolioAsset
from app.models.portfolio_transaction import PortfolioTransaction
from app.services import corporate_actions, portfolio_ledger
from app.services.corporate_actions import CorporateAction


@pytest.fixture
def portfolio(db):
    p = Portfolio(user_id=1, name="Test Portföy")
    db.add(p)
    db.commit()
    db.refresh(p)
    return p


# --- alış / maliyet birleştirme -------------------------------------------

def test_buy_creates_position_and_ledger_row(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=300.0)
    db.commit()

    assert asset.shares == 10
    assert asset.average_cost == 300.0

    rows = db.query(PortfolioTransaction).all()
    assert len(rows) == 1
    assert rows[0].transaction_type == "BUY"
    assert rows[0].ticker == "THYAO"
    assert rows[0].amount == 3000.0
    assert rows[0].realized_pnl is None


def test_second_buy_merges_at_weighted_average_cost(db, portfolio):
    portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=300.0)
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=20, price=315.0)
    db.commit()

    # (10*300 + 20*315) / 30 = 310
    assert asset.shares == 30
    assert asset.average_cost == pytest.approx(310.0)
    # Geçmiş iki ayrı işlem olarak korunuyor, tek satıra ezilmiyor.
    assert db.query(PortfolioTransaction).count() == 2


# --- satış / gerçekleşen K/Z ----------------------------------------------

def test_partial_sell_records_realized_profit(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=300.0)
    db.commit()

    remaining, realized = portfolio_ledger.record_sell(db, asset, shares=4, price=350.0)
    db.commit()

    # (350 - 300) * 4 = 200
    assert realized == pytest.approx(200.0)
    assert remaining is not None
    assert remaining.shares == pytest.approx(6)
    # Kalan pozisyonun maliyeti satıştan etkilenmemeli.
    assert remaining.average_cost == pytest.approx(300.0)

    sell_row = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.transaction_type == "SELL"
    ).one()
    assert sell_row.realized_pnl == pytest.approx(200.0)
    assert sell_row.price == 350.0


def test_full_sell_deletes_position_but_keeps_history(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=300.0)
    db.commit()

    remaining, realized = portfolio_ledger.record_sell(db, asset, shares=10, price=250.0)
    db.commit()

    assert remaining is None
    assert realized == pytest.approx(-500.0)
    assert db.query(PortfolioAsset).count() == 0
    # Pozisyon silindi ama geçmişi durmalı - bu tablonun bütün varlık sebebi.
    assert db.query(PortfolioTransaction).count() == 2


def test_sell_of_float_dust_closes_position_cleanly(db, portfolio):
    """Kesirli lotta 'hepsini sat' tam eşitlik aramamalı, yoksa 1e-16
    lotluk hayalet pozisyon kalır."""
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=0.1 + 0.2, price=100.0)
    db.commit()

    remaining, _ = portfolio_ledger.record_sell(db, asset, shares=0.3, price=100.0)
    db.commit()

    assert remaining is None
    assert db.query(PortfolioAsset).count() == 0


def test_realized_pnl_uses_cost_basis_at_sale_time(db, portfolio):
    """Satıştan SONRA yapılan alış, önceki satışın kaydedilmiş K/Z'sini
    değiştirmemeli."""
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=100.0)
    db.commit()
    _, realized = portfolio_ledger.record_sell(db, asset, shares=5, price=150.0)
    db.commit()
    assert realized == pytest.approx(250.0)

    portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=500.0)
    db.commit()

    sell_row = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.transaction_type == "SELL"
    ).one()
    assert sell_row.realized_pnl == pytest.approx(250.0)


# --- temettü ---------------------------------------------------------------

def test_dividend_does_not_change_position(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=100, price=300.0)
    db.commit()

    portfolio_ledger.record_dividend(db, portfolio.id, "THYAO", shares=100, per_share=2.5, tax=0.0)
    db.commit()
    db.refresh(asset)

    assert asset.shares == 100
    assert asset.average_cost == pytest.approx(300.0)

    row = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.transaction_type == "DIVIDEND"
    ).one()
    assert row.amount == pytest.approx(250.0)


def test_dividend_amount_is_net_of_tax(db, portfolio):
    portfolio_ledger.record_dividend(db, portfolio.id, "THYAO", shares=100, per_share=2.0, tax=20.0)
    db.commit()
    row = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.transaction_type == "DIVIDEND"
    ).one()
    assert row.amount == pytest.approx(180.0)
    assert row.commission == pytest.approx(20.0)


# --- bedelsiz / bölünme ----------------------------------------------------

def test_bonus_issue_keeps_total_cost_constant(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=100, price=33.816)
    db.commit()
    cost_before = asset.shares * asset.average_cost

    portfolio_ledger.apply_bonus_issue(db, asset, ratio=3.3816)
    db.commit()

    assert asset.shares == pytest.approx(338.16)
    assert asset.average_cost == pytest.approx(10.0)
    # Bedelsizin özü: lot artar, maliyet düşer, TOPLAM maliyet sabit kalır.
    assert asset.shares * asset.average_cost == pytest.approx(cost_before)

    row = db.query(PortfolioTransaction).filter(
        PortfolioTransaction.transaction_type == "BONUS"
    ).one()
    assert row.price == 0.0
    assert row.amount == 0.0


def test_bonus_issue_rejects_nonpositive_ratio(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=10, price=10.0)
    db.commit()
    with pytest.raises(ValueError):
        portfolio_ledger.apply_bonus_issue(db, asset, ratio=0)


# --- kurumsal işlem planlaması --------------------------------------------

_ACTION = CorporateAction(
    ticker="KTLEV", ratio=3.3816, ex_date=date(2026, 8, 3), description="test bedelsiz",
)


def _backdate_asset(db, asset, when: datetime):
    """created_at server_default ile dolduğu için testte elle geriye çekiyoruz."""
    asset.created_at = when
    db.commit()
    db.refresh(asset)


def test_plan_marks_pre_exdate_position_applicable(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=100, price=33.816)
    db.commit()
    _backdate_asset(db, asset, datetime(2026, 7, 1, tzinfo=timezone.utc))
    # Alış kaydını da ex-date öncesine çek - aksi halde "ex-date sonrası
    # alış var" kuralına takılır.
    db.query(PortfolioTransaction).filter(
        PortfolioTransaction.ticker == "KTLEV"
    ).update({"executed_at": datetime(2026, 7, 1, tzinfo=timezone.utc)})
    db.commit()

    plans = corporate_actions.plan_adjustments(db, _ACTION)
    assert len(plans) == 1
    assert plans[0].applicable
    assert plans[0].new_shares == pytest.approx(338.16)


def test_plan_skips_position_opened_after_exdate(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=100, price=10.0)
    db.commit()
    _backdate_asset(db, asset, datetime(2026, 8, 10, tzinfo=timezone.utc))

    plans = corporate_actions.plan_adjustments(db, _ACTION)
    assert not plans[0].applicable
    assert "sonra" in plans[0].reason


def test_apply_is_idempotent(db, portfolio):
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=100, price=33.816)
    db.commit()
    _backdate_asset(db, asset, datetime(2026, 7, 1, tzinfo=timezone.utc))
    db.query(PortfolioTransaction).filter(
        PortfolioTransaction.ticker == "KTLEV"
    ).update({"executed_at": datetime(2026, 7, 1, tzinfo=timezone.utc)})
    db.commit()

    corporate_actions.apply_action(db, _ACTION)
    db.refresh(asset)
    shares_after_first = asset.shares

    # İkinci kez çalıştırmak lot sayısını tekrar çarpmamalı.
    plans = corporate_actions.apply_action(db, _ACTION)
    db.refresh(asset)
    assert asset.shares == pytest.approx(shares_after_first)
    assert not any(p.applicable for p in plans)


def test_quote_correction_reads_the_same_ratio_source(db):
    """market_data'nın kotasyon düzeltmesi ile portföy düzeltmesi aynı
    tanımdan beslenmeli - ikisi ayrı yerde tanımlıyken portföy tarafı
    yıllarca sessizce yanlış kaldı."""
    from app.services.market_data import _corporate_action_ratio
    assert _corporate_action_ratio("KTLEV") == corporate_actions.get_action("KTLEV").ratio
    assert _corporate_action_ratio("THYAO") is None


# --- FIFO -----------------------------------------------------------------

def test_fifo_differs_from_average_cost_and_uses_oldest_lot_first(db, portfolio):
    """FIFO'nun ayrı bir yöntem olmasının sebebi tam olarak bu: aynı
    satış, iki yöntemde farklı kâr verir."""
    portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=100.0)
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=10, price=200.0)
    db.commit()
    # Ortalama maliyet artık 150.
    assert asset.average_cost == pytest.approx(150.0)

    _, avg_realized = portfolio_ledger.record_sell(db, asset, shares=10, price=250.0)
    db.commit()
    # Ortalama maliyetle: (250-150)*10 = 1000
    assert avg_realized == pytest.approx(1000.0)

    txs = db.query(PortfolioTransaction).order_by(PortfolioTransaction.id).all()
    fifo = portfolio_ledger.compute_fifo_realized(txs)
    # FIFO ile ilk lot (100'den alınan) satılır: (250-100)*10 = 1500
    assert fifo["realized_pnl"] == pytest.approx(1500.0)
    assert fifo["by_ticker"]["THYAO"] == pytest.approx(1500.0)


def test_fifo_spans_multiple_lots_for_one_sale(db, portfolio):
    portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=5, price=100.0)
    asset = portfolio_ledger.record_buy(db, portfolio.id, "THYAO", shares=5, price=200.0)
    db.commit()
    portfolio_ledger.record_sell(db, asset, shares=8, price=300.0)
    db.commit()

    txs = db.query(PortfolioTransaction).order_by(PortfolioTransaction.id).all()
    fifo = portfolio_ledger.compute_fifo_realized(txs)
    # 5 lot @100 + 3 lot @200 = 1100 maliyet; hasılat 8*300 = 2400
    assert fifo["realized_pnl"] == pytest.approx(1300.0)


def test_fifo_flags_sale_with_no_recorded_purchase(db, portfolio):
    """Defterden önce açılmış bir pozisyonun satışı - maliyet tabanı
    bilinmiyor, uydurulmamalı, işaretlenmeli."""
    asset = PortfolioAsset(portfolio_id=portfolio.id, ticker="THYAO", shares=10, average_cost=100.0)
    db.add(asset)
    db.commit()

    portfolio_ledger.record_sell(db, asset, shares=10, price=150.0)
    db.commit()

    txs = db.query(PortfolioTransaction).order_by(PortfolioTransaction.id).all()
    fifo = portfolio_ledger.compute_fifo_realized(txs)
    # Karşılığı olmayan satış hiç sayılmaz (uydurma maliyet yerine boş).
    assert fifo["realized_pnl"] == pytest.approx(0.0)
    assert fifo["sales"] == []


def test_fifo_accounts_for_bonus_issue(db, portfolio):
    """Bedelsiz sonrası FIFO maliyeti de ölçeklenmiş olmalı, yoksa
    satışta olmayan bir kâr çıkar."""
    asset = portfolio_ledger.record_buy(db, portfolio.id, "KTLEV", shares=100, price=30.0)
    db.commit()
    portfolio_ledger.apply_bonus_issue(db, asset, ratio=3.0)
    db.commit()
    # 300 lot, birim maliyet 10.
    portfolio_ledger.record_sell(db, asset, shares=300, price=10.0)
    db.commit()

    txs = db.query(PortfolioTransaction).order_by(PortfolioTransaction.id).all()
    fifo = portfolio_ledger.compute_fifo_realized(txs)
    # Aynı fiyattan satıldı: kâr sıfır olmalı. Bedelsiz göz ardı edilseydi
    # maliyet 30 kalır ve sahte bir zarar çıkardı.
    assert fifo["realized_pnl"] == pytest.approx(0.0)


# --- KAP'tan bedelsiz adayı tespiti ---------------------------------------

def _kap_row(db, notif_id, ticker, title, days_ago=1):
    from app.models.kap import KapNotification
    from datetime import timedelta
    db.add(KapNotification(
        id=notif_id, ticker=ticker, title=title, summary=title,
        publish_date=datetime.now(timezone.utc) - timedelta(days=days_ago),
    ))
    db.commit()


def test_kap_detection_finds_bonus_issue_and_parses_ratio(db):
    _kap_row(db, "1001", "KTLEV", "KTLEV [Katılımevim] %238,16 oranında bedelsiz sermaye artırımı")

    found = corporate_actions.detect_candidates_from_kap(db)
    assert len(found) == 1
    assert found[0]["ticker"] == "KTLEV"
    # %238,16 -> 3.3816x
    assert found[0]["suggested_ratio"] == pytest.approx(3.3816)
    # Bu hisse zaten CORPORATE_ACTIONS'ta tanımlı.
    assert found[0]["already_registered"] is True


def test_kap_detection_ignores_unrelated_disclosures(db):
    _kap_row(db, "1002", "THYAO", "THYAO [Türk Hava Yolları] Yolcu istatistikleri açıklandı")
    _kap_row(db, "1003", "EREGL", "EREGL [Ereğli] Olağan genel kurul toplantısı")

    assert corporate_actions.detect_candidates_from_kap(db) == []


def test_kap_detection_marks_unknown_ticker_as_unregistered(db):
    _kap_row(db, "1004", "ASELS", "ASELS [Aselsan] %50 oranında bedelsiz sermaye artırımı kararı")

    found = corporate_actions.detect_candidates_from_kap(db)
    assert len(found) == 1
    assert found[0]["ticker"] == "ASELS"
    assert found[0]["suggested_ratio"] == pytest.approx(1.5)
    # Henüz tanımlı değil - admin'in ilgilenmesi gereken durum tam olarak bu.
    assert found[0]["already_registered"] is False


def test_kap_detection_returns_no_ratio_when_text_has_none(db):
    """Oran çıkarılamıyorsa uydurulmamalı - None dönmeli ki admin elle baksın."""
    _kap_row(db, "1005", "GARAN", "GARAN [Garanti] Bedelsiz sermaye artırımı başvurusu yapıldı")

    found = corporate_actions.detect_candidates_from_kap(db)
    assert len(found) == 1
    assert found[0]["suggested_ratio"] is None


def test_kap_detection_respects_the_day_window(db):
    _kap_row(db, "1006", "ASELS", "ASELS %50 bedelsiz sermaye artırımı", days_ago=90)

    assert corporate_actions.detect_candidates_from_kap(db, days=30) == []
    assert len(corporate_actions.detect_candidates_from_kap(db, days=120)) == 1
