"""add totp fields to user

Revision ID: c371ce67a9fa
Revises: 8f43db0c254e
Create Date: 2026-07-29 04:47:24.093131

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c371ce67a9fa'
down_revision: Union[str, Sequence[str], None] = '8f43db0c254e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('user', sa.Column('totp_secret', sa.String(length=64), nullable=True))
    op.add_column('user', sa.Column('totp_enabled', sa.Boolean(), nullable=True, server_default=sa.text('false')))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user', 'totp_enabled')
    op.drop_column('user', 'totp_secret')
