"""add stop order fields to trade_pending_order

Revision ID: 1cc98dba1cf3
Revises: c371ce67a9fa
Create Date: 2026-08-03 11:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '1cc98dba1cf3'
down_revision: Union[str, Sequence[str], None] = 'c371ce67a9fa'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('trade_pending_order', sa.Column('order_type', sa.String(length=12), nullable=False, server_default='LIMIT'))
    op.add_column('trade_pending_order', sa.Column('stop_price', sa.Float(), nullable=True))
    # batch_alter_table, not a plain alter_column: SQLite has no ALTER COLUMN
    # at all, so the bare version raised 'near "ALTER": syntax error' and made
    # the whole migration chain unrunnable on SQLite. Production is Postgres
    # (where batch mode is just a normal ALTER, no behaviour change), but the
    # chain has to be replayable on SQLite for the fresh-database migration
    # test in CI to be able to run it at all.
    with op.batch_alter_table('trade_pending_order') as batch_op:
        batch_op.alter_column('limit_price', existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('trade_pending_order') as batch_op:
        batch_op.alter_column('limit_price', existing_type=sa.Float(), nullable=False)
    op.drop_column('trade_pending_order', 'stop_price')
    op.drop_column('trade_pending_order', 'order_type')
