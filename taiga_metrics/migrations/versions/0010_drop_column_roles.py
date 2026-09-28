"""Drop the roles responsible for each column: the setting is gone."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop the column to role assignments."""
    op.drop_table("column_role")


def downgrade() -> None:
    """Create the column to role assignments again, empty."""
    op.create_table(
        "column_role",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("status_id", sa.Integer, primary_key=True),
        sa.Column("role_id", sa.Integer, primary_key=True),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )
