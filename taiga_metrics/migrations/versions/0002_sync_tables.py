"""Mirror of Taiga dictionaries, work items, transition and assignment logs, sync runs."""

from __future__ import annotations

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

TIMESTAMP = sa.DateTime(timezone=True)


def upgrade() -> None:
    """Create the tables filled by the sync."""
    op.create_table(
        "taiga_project",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("description", sa.Text, nullable=False),
        sa.Column("owner_id", sa.Integer),
        sa.Column("is_blocked", sa.Boolean, nullable=False),
    )
    op.create_table(
        "taiga_status",
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("project_id", sa.Integer, nullable=False, index=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("is_closed", sa.Boolean, nullable=False),
        sa.Column("is_archived", sa.Boolean, nullable=False),
        sa.Column("wip_limit", sa.Integer),
        sa.Column("is_deleted", sa.Boolean, nullable=False),
    )
    op.create_table(
        "taiga_user",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("username", sa.Text, nullable=False),
        sa.Column("full_name", sa.Text, nullable=False),
        sa.Column("is_active", sa.Boolean, nullable=False),
        sa.Column("is_superuser", sa.Boolean, nullable=False),
        sa.Column("is_system", sa.Boolean, nullable=False),
    )
    op.create_table(
        "taiga_role",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("project_id", sa.Integer, nullable=False, index=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, nullable=False),
        sa.Column("position", sa.Integer, nullable=False),
        sa.Column("computable", sa.Boolean, nullable=False),
    )
    op.create_table(
        "taiga_membership",
        sa.Column("project_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("user_id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("role_id", sa.Integer, nullable=False),
        sa.Column("is_admin", sa.Boolean, nullable=False),
    )
    op.create_table(
        "taiga_swimlane",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("project_id", sa.Integer, nullable=False, index=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("position", sa.BigInteger, nullable=False),
    )
    op.create_table(
        "taiga_milestone",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("project_id", sa.Integer, nullable=False, index=True),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("estimated_start", sa.Date, nullable=False),
        sa.Column("estimated_finish", sa.Date, nullable=False),
        sa.Column("closed", sa.Boolean, nullable=False),
    )
    op.create_table(
        "work_item",
        sa.Column("item_type", sa.Text, primary_key=True),
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=False),
        sa.Column("project_id", sa.Integer, nullable=False, index=True),
        sa.Column("ref", sa.BigInteger),
        sa.Column("subject", sa.Text, nullable=False),
        sa.Column("status_id", sa.Integer),
        sa.Column("created_at", TIMESTAMP),
        sa.Column("is_deleted", sa.Boolean, nullable=False),
        sa.Column("deleted_at", TIMESTAMP),
    )
    op.create_table(
        "transition",
        sa.Column("history_id", sa.Text, primary_key=True),
        sa.Column("item_type", sa.Text, nullable=False),
        sa.Column("item_id", sa.Integer, nullable=False),
        sa.Column("project_id", sa.Integer, nullable=False),
        sa.Column("happened_at", TIMESTAMP, nullable=False),
        sa.Column("user_id", sa.Integer),
        sa.Column("user_name", sa.Text, nullable=False),
        sa.Column("kind", sa.Text, nullable=False),
        sa.Column("from_status_id", sa.Integer),
        sa.Column("to_status_id", sa.Integer),
        sa.Column("from_status_name", sa.Text),
        sa.Column("to_status_name", sa.Text),
    )
    op.create_index("transition_item", "transition", ["item_type", "item_id", "happened_at"])
    op.create_index("transition_project", "transition", ["project_id", "happened_at"])
    op.create_table(
        "assignment",
        sa.Column("history_id", sa.Text, primary_key=True),
        sa.Column("item_type", sa.Text, nullable=False),
        sa.Column("item_id", sa.Integer, nullable=False),
        sa.Column("project_id", sa.Integer, nullable=False),
        sa.Column("happened_at", TIMESTAMP, nullable=False),
        sa.Column("user_id", sa.Integer),
        sa.Column("user_name", sa.Text, nullable=False),
        sa.Column("assignee_ids", postgresql.ARRAY(sa.Integer), nullable=False),
    )
    op.create_index("assignment_item", "assignment", ["item_type", "item_id", "happened_at"])
    op.create_table(
        "sync_run",
        sa.Column("id", sa.Integer, primary_key=True),
        sa.Column("trigger", sa.Text, nullable=False),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("started_at", TIMESTAMP, nullable=False),
        sa.Column("finished_at", TIMESTAMP),
        sa.Column("history_since", TIMESTAMP),
        sa.Column("history_read", sa.Integer, nullable=False, server_default="0"),
        sa.Column("transitions_added", sa.Integer, nullable=False, server_default="0"),
        sa.Column("assignments_added", sa.Integer, nullable=False, server_default="0"),
        sa.Column("items_checked", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mismatches", sa.Integer, nullable=False, server_default="0"),
        sa.Column("mismatch_sample", postgresql.JSONB, nullable=False, server_default="[]"),
        sa.Column("error", sa.Text),
    )
    op.create_table(
        "sync_state",
        sa.Column("key", sa.Text, primary_key=True),
        sa.Column("value", sa.Text, nullable=False),
    )


def downgrade() -> None:
    """Drop the tables filled by the sync."""
    for table in (
        "sync_state",
        "sync_run",
        "assignment",
        "transition",
        "work_item",
        "taiga_milestone",
        "taiga_swimlane",
        "taiga_membership",
        "taiga_role",
        "taiga_user",
        "taiga_status",
        "taiga_project",
    ):
        op.drop_table(table)
