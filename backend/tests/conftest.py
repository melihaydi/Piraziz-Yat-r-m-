from unittest.mock import patch
import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import StaticPool

from app.db.base_class import Base
from app.api.deps import get_db
from app.main import app

# Create in-memory SQLite database for testing
SQLALCHEMY_DATABASE_URL = "sqlite:///:memory:"

engine = create_engine(
    SQLALCHEMY_DATABASE_URL,
    connect_args={"check_same_thread": False},
    poolclass=StaticPool,
)
TestingSessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

@pytest.fixture(scope="function")
def db():
    """Create a fresh database for each test function."""
    Base.metadata.create_all(bind=engine)
    connection = engine.connect()
    transaction = connection.begin()
    session = TestingSessionLocal(bind=connection)
    
    yield session
    
    session.close()
    transaction.rollback()
    connection.close()
    Base.metadata.drop_all(bind=engine)

@pytest.fixture(autouse=True)
def _reset_rate_limiter():
    """The rate limiter (app/core/limiter.py) is a module-level singleton,
    so without this its in-memory counters persist ACROSS test functions in
    the same pytest process - multiple tests calling /auth/login a few
    times each would eventually trip the same 5/minute limit and start
    failing with 429s that have nothing to do with what that test is
    actually checking (this broke test_auth, test_portfolio_alert_api, and
    test_subscription the moment rate limiting was added, until this
    fixture was added)."""
    from app.core.limiter import limiter
    limiter.reset()
    yield

@pytest.fixture(scope="function")
def client(db):
    """Create a TestClient with overridden get_db dependency."""
    def override_get_db():
        try:
            yield db
        finally:
            pass

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as test_client:
        yield test_client
    app.dependency_overrides.clear()


@pytest.fixture(autouse=True)
def _no_external_free_quote_calls(request):
    """Testler Is Yatirim'in canli ucuna CIKMASIN.

    free_market_data devreye girdikten sonra, gecikmeli kotasyon yolundan
    gecen her test gercek bir HTTP istegi yapmaya basladi: paket suresi
    ~3:45'ten ~10 dakikaya cikti ve sonuclar ucuncu parti bir servisin o
    andaki durumuna bagli hale geldi. Varsayilan olarak "kaynak veri
    dondurmedi" davranisi veriliyor; free yolu ozellikle test eden dosyalar
    kendi patch'leriyle bunu zaten eziyor.
    """
    # free yolun KENDISINI test eden dosyalar bu muhafizdan muaf:
    # @pytest.mark.free_quote ile isaretleniyorlar ve saglayiciyi kendileri
    # taklit ediyorlar (yine aga cikmiyorlar).
    if request.node.get_closest_marker("free_quote"):
        yield
        return
    # get_daily_candles ve prefetch de aga cikiyor - ucu de kapatiliyor.
    with patch("app.services.free_market_data.get_quote", return_value=None),          patch("app.services.free_market_data.get_daily_candles", return_value=None),          patch("app.services.free_market_data.prefetch", return_value=None):
        yield
