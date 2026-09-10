"""add fund_flow_snapshot table

Fonlarin GUNLUK nakit giris/cikis kaydi. TEFAS yalnizca o anki durumu
yayinliyor, gecmis akis serisi vermiyor - uygulama zaten okudugu portfoy
buyuklugu / pay sayisi degerlerini artik gune bir kez yaziyor.

Revision ID: f3b9d5c2a71e
Revises: e2a8c4d1f9b3
"""
from alembic import op
import sqlalchemy as sa

revision = "f3b9d5c2a71e"
down_revision = "e2a8c4d1f9b3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "fund_flow_snapshot",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("fund_code", sa.String(length=10), nullable=False),
        sa.Column("as_of_date", sa.Date(), nullable=False),
        sa.Column("fund_size_try", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("shares_outstanding", sa.Numeric(precision=20, scale=4), nullable=True),
        sa.Column("investor_count", sa.Integer(), nullable=True),
        sa.Column("net_flow_try", sa.Numeric(precision=20, scale=2), nullable=True),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.PrimaryKeyConstraint("id"),
        # Gunde tek kayit; ayni gun icindeki saatlik yenilemeler ustune yazar.
        sa.UniqueConstraint("fund_code", "as_of_date", name="uq_fund_flow_code_date"),
    )
    op.create_index(op.f("ix_fund_flow_snapshot_id"), "fund_flow_snapshot", ["id"])
    op.create_index(op.f("ix_fund_flow_snapshot_fund_code"), "fund_flow_snapshot", ["fund_code"])
    op.create_index(op.f("ix_fund_flow_snapshot_as_of_date"), "fund_flow_snapshot", ["as_of_date"])


def downgrade() -> None:
    op.drop_index(op.f("ix_fund_flow_snapshot_as_of_date"), table_name="fund_flow_snapshot")
    op.drop_index(op.f("ix_fund_flow_snapshot_fund_code"), table_name="fund_flow_snapshot")
    op.drop_index(op.f("ix_fund_flow_snapshot_id"), table_name="fund_flow_snapshot")
    op.drop_table("fund_flow_snapshot")
