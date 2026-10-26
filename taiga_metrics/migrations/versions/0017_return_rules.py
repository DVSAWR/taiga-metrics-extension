"""What counts as a return per card type, and pause or triage columns."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the return rules of card types and the return mode of columns."""
    op.create_table(
        "return_rules",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("earlier", sa.Boolean, nullable=False),
        sa.Column("out_of_done", sa.Boolean, nullable=False),
        sa.Column("misclick_minutes", sa.Integer, nullable=False),
        sa.Column("credit", sa.Text, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )
    op.create_table(
        "column_return",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("status_id", sa.Integer, primary_key=True),
        sa.Column("mode", sa.Text, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop the return settings."""
    op.drop_table("column_return")
    op.drop_table("return_rules")
