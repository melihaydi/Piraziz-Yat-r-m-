"""add fund_estimate_snapshot table

Revision ID: d4e8a72f9b1c
Revises: a3f9c1d02b4e
Create Date: 2026-08-03 22:40:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd4e8a72f9b1c'
down_revision: Union[str, Sequence[str], None] = 'a3f9c1d02b4e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'fund_estimate_snapshot',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('fund_code', sa.String(length=10), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('estimated_change_pct', sa.Float(), nullable=True),
        sa.Column('resolved_weight_pct', sa.Float(), nullable=True),
        sa.Column('actual_change_pct', sa.Float(), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('fund_code', 'snapshot_date', name='uq_fund_estimate_snapshot_code_date'),
    )
    op.create_index(op.f('ix_fund_estimate_snapshot_id'), 'fund_estimate_snapshot', ['id'], unique=False)
    op.create_index(op.f('ix_fund_estimate_snapshot_fund_code'), 'fund_estimate_snapshot', ['fund_code'], unique=False)
    op.create_index(op.f('ix_fund_estimate_snapshot_snapshot_date'), 'fund_estimate_snapshot', ['snapshot_date'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_fund_estimate_snapshot_snapshot_date'), table_name='fund_estimate_snapshot')
    op.drop_index(op.f('ix_fund_estimate_snapshot_fund_code'), table_name='fund_estimate_snapshot')
    op.drop_index(op.f('ix_fund_estimate_snapshot_id'), table_name='fund_estimate_snapshot')
    op.drop_table('fund_estimate_snapshot')
