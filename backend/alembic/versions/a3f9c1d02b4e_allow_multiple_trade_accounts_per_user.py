"""allow multiple trade accounts per user

Revision ID: a3f9c1d02b4e
Revises: 1cc98dba1cf3
Create Date: 2026-08-03 15:30:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3f9c1d02b4e'
down_revision: Union[str, Sequence[str], None] = '1cc98dba1cf3'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # batch mode: SQLite cannot ALTER constraints at all ("No support for
    # ALTER of constraints in SQLite dialect"), which made the whole
    # migration chain unreplayable on SQLite and so untestable in CI. On
    # Postgres (production) batch mode emits the same plain ALTER as before.
    with op.batch_alter_table('trade_account') as batch_op:
        batch_op.drop_constraint('trade_account_user_id_key', type_='unique')
    op.create_index(op.f('ix_trade_account_user_id'), 'trade_account', ['user_id'], unique=False)
    op.add_column('trade_account', sa.Column('name', sa.String(length=100), nullable=False, server_default='Portföy 1'))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('trade_account', 'name')
    op.drop_index(op.f('ix_trade_account_user_id'), table_name='trade_account')
    with op.batch_alter_table('trade_account') as batch_op:
        batch_op.create_unique_constraint('trade_account_user_id_key', ['user_id'])
