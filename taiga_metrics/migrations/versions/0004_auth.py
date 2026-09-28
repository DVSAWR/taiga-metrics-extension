"""Sessions of signed-in users and per-role access settings of projects."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    """Create sessions and role permissions."""
    op.create_table(
        "app_session",
        sa.Column("token_hash", sa.Text, primary_key=True),
        sa.Column("user_id", sa.Integer, nullable=False, index=True),
        sa.Column("created_at", TIMESTAMP, nullable=False),
        sa.Column("expires_at", TIMESTAMP, nullable=False),
    )
    op.create_table(
        "role_permission",
        sa.Column("project_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("role_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("pages", postgresql.ARRAY(sa.Text), nullable=False, server_default="{}"),
        sa.Column("scope", sa.Text, nullable=False, server_default="all"),
        sa.Column("updated_at", TIMESTAMP, nullable=False),
        sa.Column("updated_by", sa.Integer, nullable=False),
    )


def downgrade() -> None:
    """Drop sessions and role permissions."""
    op.drop_table("role_permission")
    op.drop_table("app_session")
