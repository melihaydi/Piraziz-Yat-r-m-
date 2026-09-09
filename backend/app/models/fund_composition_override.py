from sqlalchemy import Column, Integer, String, Date, DateTime, JSON, ForeignKey
from sqlalchemy.sql import func
from app.db.base_class import Base


class FundCompositionOverride(Base):
    """Admin-edited replacement for one fund's assets_distribution - lets an
    admin update a tracked fund's holding weights from the admin panel
    ("Fon Ağırlık Ayarlamaları") instead of needing a code change + deploy
    every time TEFAS publishes a new composition. tefas_service.py checks
    this table first and only falls back to the hardcoded FUND_DETAILS_MAP
    default when no row exists for a given fund_code - so funds nobody has
    edited yet keep working exactly as before.

    assets_distribution mirrors FUND_DETAILS_MAP's own shape: a JSON list of
    {"name": <ticker or category label>, "value": <weight percent>}."""
    fund_code = Column(String(10), primary_key=True)
    assets_distribution = Column(JSON, nullable=False)
    # Same role as FUND_DETAILS_MAP[code]["as_of"] - the reference date
    # get_live_estimated_return's weight-drift adjustment measures each
    # holding's price move since. Left null to skip drift adjustment
    # (plain static weights), same as a fund with no "as_of" set today.
    as_of = Column(Date, nullable=True)
    # Bu override YAZILIRKEN kodun (FUND_DETAILS_MAP) o fon icin sahip
    # oldugu dagilimin parmak izi. tefas_service._resolve_composition
    # bununla kodun verisinin sonradan degisip degismedigini anliyor:
    # degistiyse override BAYATTIR ve kod kazanir.
    #
    # Neden gerekli: onceden override kodu KOSULSUZ eziyordu, yani bir
    # kerelik bir duzenleme sonraki TUM veri guncellemelerini sessizce
    # gomuyordu. Tarih karsilastirmasi da yetmedi - ayni gun yapilan
    # deploy ile duzenleme ayirt edilemiyordu.
    #
    # NULL = parmak izi alanindan once yazilmis eski satir; o durumda kod
    # tercih ediliyor (bkz. _resolve_composition).
    base_fingerprint = Column(String(64), nullable=True)
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())
    updated_by_user_id = Column(Integer, ForeignKey("user.id", ondelete="SET NULL"), nullable=True)
