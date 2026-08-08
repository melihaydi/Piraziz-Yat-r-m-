"""add push_subscription table

Revision ID: a7c8d9e0f1b2
Revises: f1a2b3c4d5e6
Create Date: 2026-08-08 03:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a7c8d9e0f1b2'
down_revision: Union[str, Sequence[str], None] = 'f1a2b3c4d5e6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'push_subscription',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('user_id', sa.Integer(), nullable=False),
        sa.Column('endpoint', sa.String(length=500), nullable=False),
        sa.Column('p256dh', sa.String(length=255), nullable=False),
        sa.Column('auth', sa.String(length=255), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()'), nullable=True),
        sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_push_subscription_id'), 'push_subscription', ['id'], unique=False)
    op.create_index(op.f('ix_push_subscription_user_id'), 'push_subscription', ['user_id'], unique=False)
    op.create_index(op.f('ix_push_subscription_endpoint'), 'push_subscription', ['endpoint'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_push_subscription_endpoint'), table_name='push_subscription')
    op.drop_index(op.f('ix_push_subscription_user_id'), table_name='push_subscription')
    op.drop_index(op.f('ix_push_subscription_id'), table_name='push_subscription')
    op.drop_table('push_subscription')
