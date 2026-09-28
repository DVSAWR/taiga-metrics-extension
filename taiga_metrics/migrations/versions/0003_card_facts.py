"""Card facts needed by filters: author, tags, parent user story, and epics."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add filterable facts to work items."""
    op.add_column("work_item", sa.Column("owner_id", sa.Integer))
    op.add_column(
        "work_item",
        sa.Column("tags", postgresql.ARRAY(sa.Text), nullable=False, server_default="{}"),
    )
    op.add_column("work_item", sa.Column("user_story_id", sa.Integer))
    op.add_column(
        "work_item",
        sa.Column("epic_ids", postgresql.ARRAY(sa.Integer), nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    """Drop the filterable facts."""
    for column in ("epic_ids", "user_story_id", "tags", "owner_id"):
        op.drop_column("work_item", column)
