"""add note table

Revision ID: 409190986c1f
Revises: d4e8a72f9b1c
Create Date: 2026-08-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '409190986c1f'
down_revision: Union[str, Sequence[str], None] = 'd4e8a72f9b1c'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'note',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=200), nullable=False),
        sa.Column('content', sa.Text(), nullable=False),
        sa.Column('ticker', sa.String(length=20), nullable=True),
        sa.Column('category', sa.String(length=20), nullable=False),
        sa.Column('color', sa.String(length=20), nullable=False),
        sa.Column('is_pinned', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_note_id'), 'note', ['id'], unique=False)
    op.create_index(op.f('ix_note_user_id'), 'note', ['user_id'], unique=False)
    op.create_index(op.f('ix_note_ticker'), 'note', ['ticker'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_note_ticker'), table_name='note')
    op.drop_index(op.f('ix_note_user_id'), table_name='note')
    op.drop_index(op.f('ix_note_id'), table_name='note')
    op.drop_table('note')
