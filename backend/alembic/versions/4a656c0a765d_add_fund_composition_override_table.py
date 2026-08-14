"""add fund_composition_override table

Revision ID: 4a656c0a765d
Revises: e6f7a8b9c0d1
Create Date: 2026-08-14 06:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '4a656c0a765d'
down_revision: Union[str, Sequence[str], None] = 'e6f7a8b9c0d1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'fund_composition_override',
        sa.Column('fund_code', sa.String(length=10), nullable=False),
        sa.Column('assets_distribution', sa.JSON(), nullable=False),
        sa.Column('as_of', sa.Date(), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('updated_by_user_id', sa.Integer(), nullable=True),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['user.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('fund_code'),
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_table('fund_composition_override')
