"""Card activity timestamps for current and historical inactivity."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Store visible card activity and replay history to populate existing projects."""
    op.create_table(
        "card_activity",
        sa.Column("history_id", sa.Text, primary_key=True),
        sa.Column("item_type", sa.Text, nullable=False),
        sa.Column("item_id", sa.Integer, nullable=False),
        sa.Column("project_id", sa.Integer, nullable=False),
        sa.Column("happened_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("is_activity", sa.Boolean, nullable=False),
    )
    op.create_index(
        "ix_card_activity_project_type_time",
        "card_activity",
        ["project_id", "item_type", "item_id", "happened_at"],
    )
    op.execute("delete from sync_state where key = 'history_watermark'")


def downgrade() -> None:
    """Remove copied activity timestamps."""
    op.drop_table("card_activity")
