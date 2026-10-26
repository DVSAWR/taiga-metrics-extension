"""Reporting periods of projects without Taiga's Scrum: every so many weeks from a day."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the cadence of each project."""
    op.create_table(
        "reporting_cadence",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("weeks", sa.Integer, nullable=False),
        sa.Column("start", sa.Date, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop the cadences."""
    op.drop_table("reporting_cadence")
