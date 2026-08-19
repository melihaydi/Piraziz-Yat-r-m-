"""Migration zincirinin sağlığı.

Bu dosyanın varlık sebebi: uygulama testleri şemayı `Base.metadata.create_all`
ile kuruyor (conftest.py), production ise Alembic ile. İkisi sessizce
ayrışabilir ve ayrışmıştı da - `alembic upgrade head` boş bir veritabanında
"no such table: trade_account" ile ölüyordu, çünkü trade modelleri
app/models/__init__.py'de import edilmediği için autogenerate onları hiç
görmemiş, dolayısıyla hiçbir migration oluşturmamıştı. Mevcut kurulumlar
(prod dahil) fark etmiyordu: tablolar create_all ile çoktan oluşmuştu.

Yani bu testler olmadan, sıfırdan bir kurulumun (yeni ortam, felaket
kurtarma, yeni bir geliştiricinin ilk kurulumu) çalışmadığını ancak o an
öğrenirdik.
"""
import subprocess
import sys
from pathlib import Path

import pytest
from sqlalchemy import create_engine, inspect

BACKEND_DIR = Path(__file__).resolve().parents[1]


@pytest.fixture(scope="module")
def migrated_db(tmp_path_factory):
    """Boş bir veritabanına tüm migration zincirini uygular ve yolunu döner."""
    db_path = tmp_path_factory.mktemp("migrations") / "chain.db"
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", "head"],
        cwd=BACKEND_DIR,
        env={
            **_clean_env(),
            "DATABASE_URL": f"sqlite:///{db_path.as_posix()}",
        },
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        pytest.fail(
            "Migration zinciri boş bir veritabanında çalışmadı:\n"
            f"{result.stdout}\n{result.stderr}"
        )
    return db_path


def _clean_env():
    import os
    # DATABASE_URL dışındaki her şeyi olduğu gibi geçiriyoruz; PATH olmadan
    # alt süreç python'u bulamaz.
    return {k: v for k, v in os.environ.items() if k != "DATABASE_URL"}


def test_migration_chain_runs_on_empty_database(migrated_db):
    """Zincirin baştan sona çalışması - kurulum yapılabilirliğin kendisi."""
    assert migrated_db.exists()


def test_migrated_schema_matches_models(migrated_db):
    """Alembic'in ürettiği şema ile modellerin tanımladığı şema aynı olmalı.

    Ayrıştıklarında belirti şu olur: testler geçer (create_all modelleri
    kullanır) ama production'da o kolon/tablo yoktur ve istek 500 döner.
    """
    from app.models import Base
    import app.models  # noqa: F401 - tüm modelleri metadata'ya kaydeder

    engine = create_engine(f"sqlite:///{migrated_db.as_posix()}")
    inspector = inspect(engine)

    db_tables = set(inspector.get_table_names()) - {"alembic_version"}
    model_tables = set(Base.metadata.tables.keys())

    assert model_tables - db_tables == set(), (
        "Modelde tanımlı ama hiçbir migration'ın oluşturmadığı tablolar var - "
        "production'da bunlara her erişim hata verir."
    )
    assert db_tables - model_tables == set(), (
        "Migration'ın oluşturduğu ama artık modelde olmayan tablolar var."
    )

    for table in sorted(model_tables):
        db_columns = {c["name"] for c in inspector.get_columns(table)}
        model_columns = set(Base.metadata.tables[table].columns.keys())
        assert model_columns - db_columns == set(), (
            f"{table}: modelde olup migration'da olmayan kolon(lar) - "
            f"{sorted(model_columns - db_columns)}"
        )
        assert db_columns - model_columns == set(), (
            f"{table}: migration'da olup modelde olmayan kolon(lar) - "
            f"{sorted(db_columns - model_columns)}"
        )


def test_single_migration_head():
    """Tek bir head olmalı - iki head, birleştirilmemiş dallanma demektir ve
    `alembic upgrade head` belirsizleşir."""
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "heads"],
        cwd=BACKEND_DIR,
        env=_clean_env(),
        capture_output=True,
        text=True,
    )
    heads = [line for line in result.stdout.splitlines() if "(head)" in line]
    assert len(heads) == 1, f"Beklenen 1 head, bulunan {len(heads)}:\n{result.stdout}"
