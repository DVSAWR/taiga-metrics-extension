"""Moves between two columns marked as a return or as no return, over the rules."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the marked moves of card types."""
    op.create_table(
        "return_pair",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("from_status", sa.Integer, primary_key=True),
        sa.Column("to_status", sa.Integer, primary_key=True),
        sa.Column("is_return", sa.Boolean, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop the marked moves."""
    op.drop_table("return_pair")
