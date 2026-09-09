"""add base_fingerprint to fund_composition_override

Admin override'i, YAZILDIGI ANDAKI kod dagiliminin parmak izini tasiyor.
Boylece kodun verisi sonradan degistiginde override'in bayatladigi
anlasiliyor ve kod kazaniyor - elle guncellenen bir "revizyon" sabiti
gerekmeden.

Revision ID: e2a8c4d1f9b3
Revises: d1f7b3c8e4a2
"""
from alembic import op
import sqlalchemy as sa

revision = "e2a8c4d1f9b3"
down_revision = "d1f7b3c8e4a2"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # nullable: mevcut satirlarin hangi veriye dayandigi bilinmiyor.
    # _resolve_composition NULL'i "bayat" sayip kodu tercih ediyor.
    op.add_column("fund_composition_override",
                  sa.Column("base_fingerprint", sa.String(length=64), nullable=True))


def downgrade() -> None:
    op.drop_column("fund_composition_override", "base_fingerprint")
