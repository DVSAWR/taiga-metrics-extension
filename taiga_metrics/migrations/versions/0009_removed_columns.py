"""Whether columns removed from Taiga are shown, per card type."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Create the per card type display settings."""
    op.create_table(
        "item_type_display",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("show_removed", sa.Boolean, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop the per card type display settings."""
    op.drop_table("item_type_display")
