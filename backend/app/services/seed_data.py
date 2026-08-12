import logging

logger = logging.getLogger(__name__)


def seed_companies() -> None:
    """One-time (idempotent) seed of the `company` table.

    PortfolioAsset.ticker (and Alert/FinancialStatement/KapDisclosure.ticker)
    has a foreign key to company.ticker, but nothing anywhere in this
    codebase ever inserted a row into `company` - confirmed on production,
    where the table had 0 rows. That means every attempt to add a stock or
    fund to a portfolio has been failing with a 500 ForeignKeyViolation
    (psycopg2.errors.ForeignKeyViolation on portfolio_asset_ticker_fkey).

    Seeded from the same static ticker/name list market_data_service already
    uses, plus TEFAS fund codes - funds aren't literally companies, but the
    app already treats `company` as the FK target for any tradable
    instrument a user can hold (the Add Asset dialog explicitly accepts
    both a stock ticker and a 3-letter fund code).
    """
    from app.db.session import SessionLocal
    from app.models.company import Company
    from app.services.market_data import market_data_service
    from app.services.sectors import get_sector
    from app.services.tefas import BASE_FUNDS

    db = SessionLocal()
    try:
        existing = {row[0] for row in db.query(Company.ticker).all()}
        to_add = []

        for t in market_data_service.tickers:
            ticker = t.get("ticker")
            if not ticker or ticker in existing:
                continue
            to_add.append(Company(ticker=ticker, name=t.get("name") or ticker, sector=get_sector(ticker)))
            existing.add(ticker)

        for code, info in BASE_FUNDS.items():
            if code in existing:
                continue
            to_add.append(Company(ticker=code, name=info["name"], sector="Yatırım Fonu"))
            existing.add(code)

        # Döviz/altın - market_data_service already keeps a live FX_IDC
        # subscription for both (see SPECIAL_EXCHANGES), but neither is a
        # BIST stock or a TEFAS fund code, so they need their own explicit
        # Company row to be addable as a Yönetilen Portföyler holding.
        for ticker, name in [("USDTRY", "Dolar / TL"), ("XAUTRYG", "Gram Altın")]:
            if ticker in existing:
                continue
            to_add.append(Company(ticker=ticker, name=name, sector="Döviz / Emtia"))
            existing.add(ticker)

        if to_add:
            db.add_all(to_add)
            db.commit()
            logger.info(f"Seeded {len(to_add)} missing rows into company table.")
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to seed company table: {e}")
    finally:
        db.close()
