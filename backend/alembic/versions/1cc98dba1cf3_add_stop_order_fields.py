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
    op.alter_column('trade_pending_order', 'limit_price', existing_type=sa.Float(), nullable=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.alter_column('trade_pending_order', 'limit_price', existing_type=sa.Float(), nullable=False)
    op.drop_column('trade_pending_order', 'stop_price')
    op.drop_column('trade_pending_order', 'order_type')
