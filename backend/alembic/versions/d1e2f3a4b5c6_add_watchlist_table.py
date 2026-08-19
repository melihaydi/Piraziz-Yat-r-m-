"""add watchlist table

Revision ID: d1e2f3a4b5c6
Revises: c9a1f4b7e2d3
Create Date: 2026-08-19 14:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd1e2f3a4b5c6'
down_revision: Union[str, Sequence[str], None] = 'c9a1f4b7e2d3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'watchlist_item',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=20), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'ticker', name='uq_watchlist_user_ticker'),
    )
    op.create_index(op.f('ix_watchlist_item_id'), 'watchlist_item', ['id'], unique=False)
    op.create_index(op.f('ix_watchlist_item_user_id'), 'watchlist_item', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_watchlist_item_user_id'), table_name='watchlist_item')
    op.drop_index(op.f('ix_watchlist_item_id'), table_name='watchlist_item')
    op.drop_table('watchlist_item')
