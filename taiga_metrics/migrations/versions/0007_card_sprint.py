"""Sprint of each card."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the sprint a card belongs to now."""
    op.add_column("work_item", sa.Column("milestone_id", sa.Integer))


def downgrade() -> None:
    """Drop the sprint of cards."""
    op.drop_column("work_item", "milestone_id")
