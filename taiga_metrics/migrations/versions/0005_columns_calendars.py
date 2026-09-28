"""Column types and calendars configured by project owners; status colors from Taiga."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    """Create column types and calendars, add status colors."""
    op.add_column("taiga_status", sa.Column("color", sa.Text, nullable=False, server_default=""))
    op.create_table(
        "column_type",
        sa.Column("project_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("status_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("type", sa.Text, nullable=False),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )
    op.create_table(
        "project_calendar",
        sa.Column("project_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("timezone", sa.Text, nullable=False),
        sa.Column("working_days", postgresql.ARRAY(sa.Integer), nullable=False),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )
    op.create_table(
        "user_calendar",
        sa.Column("project_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("user_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("working_days", postgresql.ARRAY(sa.Integer), nullable=False),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop calendars and column types, and status colors."""
    op.drop_table("user_calendar")
    op.drop_table("project_calendar")
    op.drop_table("column_type")
    op.drop_column("taiga_status", "color")
