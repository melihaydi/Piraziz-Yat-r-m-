"""Add trade pending orders (limit orders) and locked_cash

Revision ID: 23565f675cec
Revises: e74c7fc7bce6
Create Date: 2026-07-25 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '23565f675cec'
down_revision: Union[str, Sequence[str], None] = 'e74c7fc7bce6'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _create_trade_tables_if_missing() -> None:
    """Creates the base trade_* tables when they don't exist yet.

    These tables were originally created out-of-band by SQLAlchemy's
    create_all (see app/db/session.py) and never had a migration of their
    own, because app/models/__init__.py - the module alembic's env.py builds
    target_metadata from - didn't import app.models.trade, so autogenerate
    literally could not see them. The result: `alembic upgrade head` against
    an EMPTY database died right here, on the ALTER below, with "no such
    table: trade_account". Existing databases (production included) never
    noticed, because the tables were already there.

    Guarded by an inspector check rather than added as a new migration, so
    it is a no-op everywhere this revision has already been applied and only
    does real work on a genuinely fresh database (new environment, disaster
    recovery, a contributor's first local setup).

    Note the shape below is the schema as it stood AT THIS POINT IN HISTORY,
    not today's model: trade_account still has its UNIQUE(user_id) and no
    `name` column, because the later a3f9c1d02b4e revision drops that
    constraint and adds that column. Creating today's final shape here would
    make that revision fail on a fresh database ("constraint does not
    exist" / "duplicate column"), just moving the breakage further down the
    chain.
    """
    bind = op.get_bind()
    existing = set(sa.inspect(bind).get_table_names())

    if 'trade_account' not in existing:
        op.create_table(
            'trade_account',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('user_id', sa.Integer(), nullable=False),
            sa.Column('broker', sa.String(length=50), nullable=False),
            sa.Column('starting_balance', sa.Float(), nullable=False, server_default='325000'),
            sa.Column('cash_balance', sa.Float(), nullable=False, server_default='325000'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.ForeignKeyConstraint(['user_id'], ['user.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            # Explicitly named to match Postgres's own auto-generated name,
            # so a3f9c1d02b4e's drop_constraint finds it on both backends.
            sa.UniqueConstraint('user_id', name='trade_account_user_id_key'),
        )
        op.create_index(op.f('ix_trade_account_id'), 'trade_account', ['id'], unique=False)

    if 'trade_position' not in existing:
        op.create_table(
            'trade_position',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('account_id', sa.Integer(), nullable=False),
            sa.Column('instrument_type', sa.String(length=10), nullable=False),
            sa.Column('symbol', sa.String(length=30), nullable=False),
            sa.Column('lot', sa.Float(), nullable=False, server_default='0'),
            sa.Column('avg_cost', sa.Float(), nullable=False, server_default='0'),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.Column('updated_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.ForeignKeyConstraint(['account_id'], ['trade_account.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_trade_position_id'), 'trade_position', ['id'], unique=False)
        op.create_index(op.f('ix_trade_position_account_id'), 'trade_position', ['account_id'], unique=False)

    if 'trade_order' not in existing:
        op.create_table(
            'trade_order',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('account_id', sa.Integer(), nullable=False),
            sa.Column('instrument_type', sa.String(length=10), nullable=False),
            sa.Column('symbol', sa.String(length=30), nullable=False),
            sa.Column('side', sa.String(length=4), nullable=False),
            sa.Column('lot', sa.Float(), nullable=False),
            sa.Column('price', sa.Float(), nullable=False),
            sa.Column('commission', sa.Float(), nullable=False, server_default='0'),
            sa.Column('total', sa.Float(), nullable=False),
            sa.Column('realized_pnl', sa.Float(), nullable=True),
            sa.Column('executed_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.ForeignKeyConstraint(['account_id'], ['trade_account.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
        )
        op.create_index(op.f('ix_trade_order_id'), 'trade_order', ['id'], unique=False)
        op.create_index(op.f('ix_trade_order_account_id'), 'trade_order', ['account_id'], unique=False)

    if 'trade_daily_snapshot' not in existing:
        op.create_table(
            'trade_daily_snapshot',
            sa.Column('id', sa.Integer(), nullable=False),
            sa.Column('account_id', sa.Integer(), nullable=False),
            sa.Column('snapshot_date', sa.Date(), nullable=False),
            sa.Column('equity_value', sa.Float(), nullable=False),
            sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
            sa.ForeignKeyConstraint(['account_id'], ['trade_account.id'], ondelete='CASCADE'),
            sa.PrimaryKeyConstraint('id'),
            sa.UniqueConstraint('account_id', 'snapshot_date', name='uq_trade_snapshot_account_date'),
        )
        op.create_index(op.f('ix_trade_daily_snapshot_id'), 'trade_daily_snapshot', ['id'], unique=False)


def upgrade() -> None:
    """Upgrade schema."""
    _create_trade_tables_if_missing()
    op.add_column(
        'trade_account',
        sa.Column('locked_cash', sa.Float(), nullable=False, server_default='0'),
    )
    op.create_table(
        'trade_pending_order',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('account_id', sa.Integer(), nullable=False),
        sa.Column('instrument_type', sa.String(length=10), nullable=False),
        sa.Column('symbol', sa.String(length=30), nullable=False),
        sa.Column('side', sa.String(length=4), nullable=False),
        sa.Column('lot', sa.Float(), nullable=False),
        sa.Column('limit_price', sa.Float(), nullable=False),
        sa.Column('reserved_cash', sa.Float(), nullable=False, server_default='0'),
        sa.Column('status', sa.String(length=10), nullable=False, server_default='PENDING'),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.Column('filled_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['account_id'], ['trade_account.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index(op.f('ix_trade_pending_order_id'), 'trade_pending_order', ['id'], unique=False)
    op.create_index(op.f('ix_trade_pending_order_account_id'), 'trade_pending_order', ['account_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_trade_pending_order_account_id'), table_name='trade_pending_order')
    op.drop_index(op.f('ix_trade_pending_order_id'), table_name='trade_pending_order')
    op.drop_table('trade_pending_order')
    op.drop_column('trade_account', 'locked_cash')
