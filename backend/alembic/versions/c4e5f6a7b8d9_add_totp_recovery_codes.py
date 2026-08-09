"""add totp recovery codes to user

Revision ID: c4e5f6a7b8d9
Revises: b3d4e5f6a7c8
Create Date: 2026-08-09 04:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'c4e5f6a7b8d9'
down_revision: Union[str, Sequence[str], None] = 'b3d4e5f6a7c8'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('user', sa.Column('totp_recovery_codes', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user', 'totp_recovery_codes')
