"""add upcoming_payment table

Kullanicinin kendi ekledigi yaklasan odeme kayitlari - "Yaklasan Odemeler"
paneli simdiye kadar yalnizca KAP bildirimlerini gosteriyordu ve kullanicinin
ekleyebilecegi hicbir sey yoktu.

Revision ID: d1f7b3c8e4a2
Revises: c9e5a3f7d2b6
"""
from alembic import op
import sqlalchemy as sa

revision = "d1f7b3c8e4a2"
down_revision = "c9e5a3f7d2b6"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "upcoming_payment",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("user_id", sa.Integer(), nullable=False),
        sa.Column("title", sa.String(length=120), nullable=False),
        sa.Column("ticker", sa.String(length=20), nullable=True),
        sa.Column("amount_try", sa.Numeric(precision=18, scale=2), nullable=True),
        sa.Column("due_date", sa.Date(), nullable=False),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=True),
        sa.ForeignKeyConstraint(["user_id"], ["user.id"], ondelete="CASCADE"),
        sa.PrimaryKeyConstraint("id"),
    )
    op.create_index(op.f("ix_upcoming_payment_id"), "upcoming_payment", ["id"])
    op.create_index(op.f("ix_upcoming_payment_user_id"), "upcoming_payment", ["user_id"])
    op.create_index(op.f("ix_upcoming_payment_ticker"), "upcoming_payment", ["ticker"])
    op.create_index(op.f("ix_upcoming_payment_due_date"), "upcoming_payment", ["due_date"])


def downgrade() -> None:
    op.drop_index(op.f("ix_upcoming_payment_due_date"), table_name="upcoming_payment")
    op.drop_index(op.f("ix_upcoming_payment_ticker"), table_name="upcoming_payment")
    op.drop_index(op.f("ix_upcoming_payment_user_id"), table_name="upcoming_payment")
    op.drop_index(op.f("ix_upcoming_payment_id"), table_name="upcoming_payment")
    op.drop_table("upcoming_payment")
