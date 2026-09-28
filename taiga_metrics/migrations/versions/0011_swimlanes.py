"""Swimlane of each user story and the work in progress limits per swimlane."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add the swimlane a user story is in now and the limits of each swimlane's statuses."""
    op.add_column("work_item", sa.Column("swimlane_id", sa.Integer))
    op.create_table(
        "taiga_swimlane_status",
        sa.Column("swimlane_id", sa.Integer, primary_key=True),
        sa.Column("status_id", sa.Integer, primary_key=True),
        sa.Column("wip_limit", sa.Integer),
    )


def downgrade() -> None:
    """Drop the swimlane limits and the swimlane of cards."""
    op.drop_table("taiga_swimlane_status")
    op.drop_column("work_item", "swimlane_id")
