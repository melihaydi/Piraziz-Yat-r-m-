"""add portfolio_snapshot table

Revision ID: 8f43db0c254e
Revises: 23565f675cec
Create Date: 2026-07-29 04:25:05.996628

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '8f43db0c254e'
down_revision: Union[str, Sequence[str], None] = '23565f675cec'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'portfolio_snapshot',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('total_value', sa.Float(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id', 'snapshot_date', name='uq_portfolio_snapshot_user_date'),
    )
    op.create_index(op.f('ix_portfolio_snapshot_id'), 'portfolio_snapshot', ['id'], unique=False)
    op.create_index(op.f('ix_portfolio_snapshot_user_id'), 'portfolio_snapshot', ['user_id'], unique=False)
    op.create_index(op.f('ix_portfolio_snapshot_snapshot_date'), 'portfolio_snapshot', ['snapshot_date'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_portfolio_snapshot_snapshot_date'), table_name='portfolio_snapshot')
    op.drop_index(op.f('ix_portfolio_snapshot_user_id'), table_name='portfolio_snapshot')
    op.drop_index(op.f('ix_portfolio_snapshot_id'), table_name='portfolio_snapshot')
    op.drop_table('portfolio_snapshot')
