"""Drop the setting that hid columns removed from Taiga: a period shows what it used."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Drop whether removed columns were shown, per card type."""
    op.drop_table("item_type_display")


def downgrade() -> None:
    """Create the setting again, every removed column hidden."""
    op.create_table(
        "item_type_display",
        sa.Column("project_id", sa.Integer, primary_key=True),
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("show_removed", sa.Boolean, nullable=False),
        sa.Column("updated_at", postgresql.TIMESTAMP(timezone=True), nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )
