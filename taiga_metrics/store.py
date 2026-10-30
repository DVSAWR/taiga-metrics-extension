"""Table definitions of the extension's own database, used to build queries.

The schema itself is created by the Alembic migrations, not from this metadata.
"""

from __future__ import annotations

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

metadata = sa.MetaData()
TIMESTAMP = sa.DateTime(timezone=True)

taiga_project = sa.Table(
    "taiga_project",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("name", sa.Text),
    sa.Column("slug", sa.Text),
    sa.Column("description", sa.Text),
    sa.Column("owner_id", sa.Integer),
    sa.Column("is_blocked", sa.Boolean),
    sa.Column("tag_colors", postgresql.JSONB),
)

taiga_status = sa.Table(
    "taiga_status",
    metadata,
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project_id", sa.Integer),
    sa.Column("name", sa.Text),
    sa.Column("slug", sa.Text),
    sa.Column("position", sa.Integer),
    sa.Column("is_closed", sa.Boolean),
    sa.Column("is_archived", sa.Boolean),
    sa.Column("wip_limit", sa.Integer),
    sa.Column("is_deleted", sa.Boolean),
    sa.Column("color", sa.Text),
)

taiga_user = sa.Table(
    "taiga_user",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("username", sa.Text),
    sa.Column("full_name", sa.Text),
    sa.Column("is_active", sa.Boolean),
    sa.Column("is_superuser", sa.Boolean),
    sa.Column("is_system", sa.Boolean),
)

taiga_role = sa.Table(
    "taiga_role",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project_id", sa.Integer),
    sa.Column("name", sa.Text),
    sa.Column("slug", sa.Text),
    sa.Column("position", sa.Integer),
    sa.Column("computable", sa.Boolean),
)

taiga_membership = sa.Table(
    "taiga_membership",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("user_id", sa.Integer, primary_key=True),
    sa.Column("role_id", sa.Integer),
    sa.Column("is_admin", sa.Boolean),
)

taiga_swimlane = sa.Table(
    "taiga_swimlane",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project_id", sa.Integer),
    sa.Column("name", sa.Text),
    sa.Column("position", sa.BigInteger),
)

taiga_swimlane_status = sa.Table(
    "taiga_swimlane_status",
    metadata,
    sa.Column("swimlane_id", sa.Integer, primary_key=True),
    sa.Column("status_id", sa.Integer, primary_key=True),
    sa.Column("wip_limit", sa.Integer),
)

taiga_milestone = sa.Table(
    "taiga_milestone",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project_id", sa.Integer),
    sa.Column("name", sa.Text),
    sa.Column("estimated_start", sa.Date),
    sa.Column("estimated_finish", sa.Date),
    sa.Column("closed", sa.Boolean),
)

work_item = sa.Table(
    "work_item",
    metadata,
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("project_id", sa.Integer),
    sa.Column("ref", sa.BigInteger),
    sa.Column("subject", sa.Text),
    sa.Column("status_id", sa.Integer),
    sa.Column("created_at", TIMESTAMP),
    sa.Column("is_deleted", sa.Boolean),
    sa.Column("deleted_at", TIMESTAMP),
    sa.Column("owner_id", sa.Integer),
    sa.Column("tags", postgresql.ARRAY(sa.Text)),
    sa.Column("user_story_id", sa.Integer),
    sa.Column("epic_ids", postgresql.ARRAY(sa.Integer)),
    sa.Column("milestone_id", sa.Integer),
    sa.Column("swimlane_id", sa.Integer),
)

transition = sa.Table(
    "transition",
    metadata,
    sa.Column("history_id", sa.Text, primary_key=True),
    sa.Column("item_type", sa.Text),
    sa.Column("item_id", sa.Integer),
    sa.Column("project_id", sa.Integer),
    sa.Column("happened_at", TIMESTAMP),
    sa.Column("user_id", sa.Integer),
    sa.Column("user_name", sa.Text),
    sa.Column("kind", sa.Text),
    sa.Column("from_status_id", sa.Integer),
    sa.Column("to_status_id", sa.Integer),
    sa.Column("from_status_name", sa.Text),
    sa.Column("to_status_name", sa.Text),
)

card_activity = sa.Table(
    "card_activity",
    metadata,
    sa.Column("history_id", sa.Text, primary_key=True),
    sa.Column("item_type", sa.Text),
    sa.Column("item_id", sa.Integer),
    sa.Column("project_id", sa.Integer),
    sa.Column("happened_at", TIMESTAMP),
    sa.Column("is_activity", sa.Boolean),
)

assignment = sa.Table(
    "assignment",
    metadata,
    sa.Column("history_id", sa.Text, primary_key=True),
    sa.Column("item_type", sa.Text),
    sa.Column("item_id", sa.Integer),
    sa.Column("project_id", sa.Integer),
    sa.Column("happened_at", TIMESTAMP),
    sa.Column("user_id", sa.Integer),
    sa.Column("user_name", sa.Text),
    sa.Column("assignee_ids", postgresql.ARRAY(sa.Integer)),
)

sync_run = sa.Table(
    "sync_run",
    metadata,
    sa.Column("id", sa.Integer, primary_key=True),
    sa.Column("trigger", sa.Text),
    sa.Column("status", sa.Text),
    sa.Column("started_at", TIMESTAMP),
    sa.Column("finished_at", TIMESTAMP),
    sa.Column("history_since", TIMESTAMP),
    sa.Column("history_read", sa.Integer),
    sa.Column("transitions_added", sa.Integer),
    sa.Column("assignments_added", sa.Integer),
    sa.Column("items_checked", sa.Integer),
    sa.Column("mismatches", sa.Integer),
    sa.Column("mismatch_sample", postgresql.JSONB),
    sa.Column("error", sa.Text),
)

sync_state = sa.Table(
    "sync_state",
    metadata,
    sa.Column("key", sa.Text, primary_key=True),
    sa.Column("value", sa.Text),
)

ARRAY_TEXT = postgresql.ARRAY(sa.Text)
ARRAY_INT = postgresql.ARRAY(sa.Integer)

app_session = sa.Table(
    "app_session",
    metadata,
    sa.Column("token_hash", sa.Text, primary_key=True),
    sa.Column("user_id", sa.Integer),
    sa.Column("created_at", TIMESTAMP),
    sa.Column("expires_at", TIMESTAMP),
)

role_permission = sa.Table(
    "role_permission",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("role_id", sa.Integer, primary_key=True),
    sa.Column("pages", postgresql.ARRAY(sa.Text)),
    sa.Column("scope", sa.Text),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

column_type = sa.Table(
    "column_type",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("status_id", sa.Integer, primary_key=True),
    sa.Column("type", sa.Text),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

column_role = sa.Table(
    "column_role",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("status_id", sa.Integer, primary_key=True),
    sa.Column("role_id", sa.Integer, primary_key=True),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

project_calendar = sa.Table(
    "project_calendar",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("timezone", sa.Text),
    sa.Column("working_days", postgresql.ARRAY(sa.Integer)),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

return_rules = sa.Table(
    "return_rules",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("earlier", sa.Boolean),
    sa.Column("out_of_done", sa.Boolean),
    sa.Column("misclick_minutes", sa.Integer),
    sa.Column("credit", sa.Text),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

column_return = sa.Table(
    "column_return",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("status_id", sa.Integer, primary_key=True),
    sa.Column("mode", sa.Text),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

return_pair = sa.Table(
    "return_pair",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("item_type", sa.Text, primary_key=True),
    sa.Column("from_status", sa.Integer, primary_key=True),
    sa.Column("to_status", sa.Integer, primary_key=True),
    sa.Column("is_return", sa.Boolean),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

reporting_cadence = sa.Table(
    "reporting_cadence",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("weeks", sa.Integer),
    sa.Column("start", sa.Date),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)

user_calendar = sa.Table(
    "user_calendar",
    metadata,
    sa.Column("project_id", sa.Integer, primary_key=True),
    sa.Column("user_id", sa.Integer, primary_key=True),
    sa.Column("working_days", postgresql.ARRAY(sa.Integer)),
    sa.Column("updated_at", TIMESTAMP),
    sa.Column("updated_by", sa.Integer),
)
