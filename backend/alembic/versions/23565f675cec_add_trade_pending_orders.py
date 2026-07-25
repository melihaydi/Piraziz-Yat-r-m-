"""Add trade pending orders (limit orders) and locked_cash

Revision ID: 23565f675cec
Revises: e74c7fc7bce6
Create Date: 2026-07-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '23565f675cec'
down_revision: Union[str, Sequence[str], None] = 'e74c7fc7bce6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'trade_account',
        sa.Column('locked_cash', sa.Float(), nullable=False, server_default='0'),
    )
    op.create_table(
        'trade_pending_order',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('instrument_type', sa.String(length=10), nullable=False),
        sa.Column('symbol', sa.String(length=30), nullable=False),
        sa.Column('side', sa.String(length=4), nullable=False),
        sa.Column('lot', sa.Float(), nullable=False),
        sa.Column('limit_price', sa.Float(), nullable=False),
        sa.Column('reserved_cash', sa.Float(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('filled_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['trade_account.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_trade_pending_order_id'), 'trade_pending_order', ['id'], unique=False)
    op.create_index(op.f('ix_trade_pending_order_account_id'), 'trade_pending_order', ['account_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_trade_pending_order_account_id'), table_name='trade_pending_order')
    op.drop_index(op.f('ix_trade_pending_order_id'), table_name='trade_pending_order')
    op.drop_table('trade_pending_order')
    op.drop_column('trade_account', 'locked_cash')
