"""add asset_type to watchlist_item

Revision ID: f4a1b9c2d6e7
Revises: d1e2f3a4b5c6
Create Date: 2026-08-22 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'f4a1b9c2d6e7'
down_revision: Union[str, Sequence[str], None] = 'd1e2f3a4b5c6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'watchlist_item',
        sa.Column('asset_type', sa.String(length=10), nullable=False, server_default='stock'),
    )
    # batch mode: SQLite cannot ALTER constraints at all ("No support for
    # ALTER of constraints in SQLite dialect"), which made the whole
    # migration chain unreplayable on SQLite and so untestable in CI (see
    # a3f9c1d02b4e for the same fix applied earlier). On Postgres
    # (production) batch mode emits the same plain ALTER as before.
    with op.batch_alter_table('watchlist_item') as batch_op:
        batch_op.drop_constraint('uq_watchlist_user_ticker', type_='unique')
        batch_op.create_unique_constraint(
            'uq_watchlist_user_ticker_type', ['user_id', 'ticker', 'asset_type']
        )


def downgrade() -> None:
    """Downgrade schema."""
    with op.batch_alter_table('watchlist_item') as batch_op:
        batch_op.drop_constraint('uq_watchlist_user_ticker_type', type_='unique')
        batch_op.create_unique_constraint('uq_watchlist_user_ticker', ['user_id', 'ticker'])
        batch_op.drop_column('asset_type')
