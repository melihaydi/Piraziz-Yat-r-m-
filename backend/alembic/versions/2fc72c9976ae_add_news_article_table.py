"""add news_article table

Revision ID: 2fc72c9976ae
Revises: 409190986c1f
Create Date: 2026-08-07 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2fc72c9976ae'
down_revision: Union[str, Sequence[str], None] = '409190986c1f'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table(
        'news_article',
        sa.Column('id', sa.Integer(), nullable=False),
        sa.Column('title', sa.String(length=500), nullable=False),
        sa.Column('url', sa.String(length=1000), nullable=False),
        sa.Column('source', sa.String(length=100), nullable=False),
        sa.Column('summary', sa.Text(), nullable=True),
        sa.Column('published_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('synced_at', sa.DateTime(timezone=True), server_default=sa.text('CURRENT_TIMESTAMP'), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('url', name='uq_news_article_url'),
    )
    op.create_index(op.f('ix_news_article_id'), 'news_article', ['id'], unique=False)
    op.create_index(op.f('ix_news_article_url'), 'news_article', ['url'], unique=True)
    op.create_index(op.f('ix_news_article_published_at'), 'news_article', ['published_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_news_article_published_at'), table_name='news_article')
    op.drop_index(op.f('ix_news_article_url'), table_name='news_article')
    op.drop_index(op.f('ix_news_article_id'), table_name='news_article')
    op.drop_table('news_article')
