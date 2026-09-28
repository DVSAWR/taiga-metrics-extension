"""Tag colors of projects, as Taiga shows them."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Add tag colors to the project mirror."""
    op.add_column(
        "taiga_project",
        sa.Column("tag_colors", postgresql.JSONB, nullable=False, server_default="{}"),
    )


def downgrade() -> None:
    """Drop tag colors."""
    op.drop_column("taiga_project", "tag_colors")
