"""add telegram_link table

Revision ID: b8d4f2a6c3e1
Revises: a7c3e9f1b2d4
Create Date: 2026-08-31 01:50:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'b8d4f2a6c3e1'
down_revision: Union[str, Sequence[str], None] = 'a7c3e9f1b2d4'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'telegram_link',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('link_code', sa.String(length=16), nullable=False),
        sa.Column('chat_id', sa.String(length=64), nullable=True),
        sa.Column('linked_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('daily_digest_enabled', sa.Boolean(), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('user_id'),
        sa.UniqueConstraint('link_code'),
    )
    op.create_index(op.f('ix_telegram_link_id'), 'telegram_link', ['id'], unique=False)
    op.create_index(op.f('ix_telegram_link_user_id'), 'telegram_link', ['user_id'], unique=False)
    op.create_index(op.f('ix_telegram_link_link_code'), 'telegram_link', ['link_code'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_telegram_link_link_code'), table_name='telegram_link')
    op.drop_index(op.f('ix_telegram_link_user_id'), table_name='telegram_link')
    op.drop_index(op.f('ix_telegram_link_id'), table_name='telegram_link')
    op.drop_table('telegram_link')
