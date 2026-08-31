"""add index_membership and index_change_event tables

Revision ID: c9e5a3f7d2b6
Revises: b8d4f2a6c3e1
Create Date: 2026-08-31 04:20:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c9e5a3f7d2b6'
down_revision: Union[str, Sequence[str], None] = 'b8d4f2a6c3e1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'index_membership',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('index_code', sa.String(length=10), nullable=False),
        sa.Column('ticker', sa.String(length=20), nullable=False),
        sa.Column('snapshot_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('index_code', 'ticker', 'snapshot_date', name='uq_index_membership_code_ticker_date'),
    )
    op.create_index(op.f('ix_index_membership_id'), 'index_membership', ['id'], unique=False)
    op.create_index(op.f('ix_index_membership_index_code'), 'index_membership', ['index_code'], unique=False)
    op.create_index(op.f('ix_index_membership_ticker'), 'index_membership', ['ticker'], unique=False)
    op.create_index(op.f('ix_index_membership_snapshot_date'), 'index_membership', ['snapshot_date'], unique=False)

    op.create_table(
        'index_change_event',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('index_code', sa.String(length=10), nullable=False),
        sa.Column('ticker', sa.String(length=20), nullable=False),
        sa.Column('change_type', sa.String(length=10), nullable=False),
        sa.Column('detected_date', sa.Date(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_index_change_event_id'), 'index_change_event', ['id'], unique=False)
    op.create_index(op.f('ix_index_change_event_index_code'), 'index_change_event', ['index_code'], unique=False)
    op.create_index(op.f('ix_index_change_event_ticker'), 'index_change_event', ['ticker'], unique=False)
    op.create_index(op.f('ix_index_change_event_detected_date'), 'index_change_event', ['detected_date'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_index_change_event_detected_date'), table_name='index_change_event')
    op.drop_index(op.f('ix_index_change_event_ticker'), table_name='index_change_event')
    op.drop_index(op.f('ix_index_change_event_index_code'), table_name='index_change_event')
    op.drop_index(op.f('ix_index_change_event_id'), table_name='index_change_event')
    op.drop_table('index_change_event')

    op.drop_index(op.f('ix_index_membership_snapshot_date'), table_name='index_membership')
    op.drop_index(op.f('ix_index_membership_ticker'), table_name='index_membership')
    op.drop_index(op.f('ix_index_membership_index_code'), table_name='index_membership')
    op.drop_index(op.f('ix_index_membership_id'), table_name='index_membership')
    op.drop_table('index_membership')
