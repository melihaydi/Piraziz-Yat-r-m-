"""add portfolio_transaction table

Revision ID: c9a1f4b7e2d3
Revises: 4a656c0a765d
Create Date: 2026-08-19 10:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9a1f4b7e2d3'
down_revision: Union[str, Sequence[str], None] = '4a656c0a765d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'portfolio_transaction',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('portfolio_id', sa.Integer(), nullable=False),
        # No FK to company.ticker on purpose: a transaction must outlive
        # both the position and any company-table churn (see the model's
        # docstring), and history rows are never used as a price lookup key.
        sa.Column('ticker', sa.String(length=20), nullable=False),
        sa.Column('transaction_type', sa.String(length=20), nullable=False),
        sa.Column('shares', sa.Float(), nullable=False, server_default='0'),
        sa.Column('price', sa.Float(), nullable=False, server_default='0'),
        sa.Column('amount', sa.Float(), nullable=False, server_default='0'),
        sa.Column('commission', sa.Float(), nullable=False, server_default='0'),
        sa.Column('realized_pnl', sa.Float(), nullable=True),
        sa.Column('executed_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=False),
        sa.Column('note', sa.String(length=255), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['portfolio_id'], ['portfolio.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_portfolio_transaction_id'), 'portfolio_transaction', ['id'], unique=False)
    op.create_index(op.f('ix_portfolio_transaction_portfolio_id'), 'portfolio_transaction', ['portfolio_id'], unique=False)
    op.create_index(op.f('ix_portfolio_transaction_ticker'), 'portfolio_transaction', ['ticker'], unique=False)
    op.create_index(op.f('ix_portfolio_transaction_executed_at'), 'portfolio_transaction', ['executed_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_portfolio_transaction_executed_at'), table_name='portfolio_transaction')
    op.drop_index(op.f('ix_portfolio_transaction_ticker'), table_name='portfolio_transaction')
    op.drop_index(op.f('ix_portfolio_transaction_portfolio_id'), table_name='portfolio_transaction')
    op.drop_index(op.f('ix_portfolio_transaction_id'), table_name='portfolio_transaction')
    op.drop_table('portfolio_transaction')
