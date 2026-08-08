"""add email verification and terms acceptance fields to user

Revision ID: f1a2b3c4d5e6
Revises: d76f7f1e5153
Create Date: 2026-08-08 01:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f1a2b3c4d5e6'
down_revision: Union[str, Sequence[str], None] = 'd76f7f1e5153'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('user', sa.Column('is_email_verified', sa.Boolean(), nullable=True, server_default=sa.text('false')))
    op.add_column('user', sa.Column('terms_accepted_at', sa.DateTime(timezone=True), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('user', 'terms_accepted_at')
    op.drop_column('user', 'is_email_verified')
