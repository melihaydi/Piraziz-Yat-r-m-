"""add strategy_signal table

Revision ID: a7c3e9f1b2d4
Revises: f4a1b9c2d6e7
Create Date: 2026-08-28 14:35:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c3e9f1b2d4'
down_revision: Union[str, Sequence[str], None] = 'f4a1b9c2d6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'strategy_signal',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('ticker', sa.String(length=20), nullable=False),
        sa.Column('direction', sa.String(length=5), nullable=False),
        sa.Column('entry_price', sa.Float(), nullable=False),
        sa.Column('stop_price', sa.Float(), nullable=False),
        sa.Column('target_price', sa.Float(), nullable=False),
        sa.Column('confidence', sa.String(length=10), nullable=False),
        sa.Column('fired_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('resolved_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('outcome', sa.String(length=10), nullable=True),
        sa.Column('return_pct', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('ticker', 'fired_at', name='uq_strategy_signal_ticker_fired_at'),
    )
    op.create_index(op.f('ix_strategy_signal_id'), 'strategy_signal', ['id'], unique=False)
    op.create_index(op.f('ix_strategy_signal_ticker'), 'strategy_signal', ['ticker'], unique=False)
    op.create_index(op.f('ix_strategy_signal_fired_at'), 'strategy_signal', ['fired_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_strategy_signal_fired_at'), table_name='strategy_signal')
    op.drop_index(op.f('ix_strategy_signal_ticker'), table_name='strategy_signal')
    op.drop_index(op.f('ix_strategy_signal_id'), table_name='strategy_signal')
    op.drop_table('strategy_signal')
