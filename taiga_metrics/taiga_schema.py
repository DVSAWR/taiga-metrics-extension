"""The part of Taiga's database schema the extension depends on, and a check against it.

Taiga upgrades may rename or drop tables and columns. Checking them up front turns a
silent wrong number into an explicit incompatibility report.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import TYPE_CHECKING

from sqlalchemy import text

if TYPE_CHECKING:
    from collections.abc import Mapping, Set

    from sqlalchemy.ext.asyncio import AsyncConnection

EXPECTED_SCHEMA: Mapping[str, frozenset[str]] = {
    "projects_project": frozenset(
        {
            "id",
            "name",
            "slug",
            "description",
            "owner_id",
            "is_backlog_activated",
            "is_kanban_activated",
            "is_epics_activated",
            "is_issues_activated",
            "is_wiki_activated",
            "archived_code",
            "blocked_code",
            "tags_colors",
            "logo",
        }
    ),
    "projects_userstorystatus": frozenset(
        {
            "id",
            "project_id",
            "name",
            "slug",
            "order",
            "is_closed",
            "is_archived",
            "wip_limit",
            "color",
        }
    ),
    "projects_taskstatus": frozenset(
        {"id", "project_id", "name", "slug", "order", "is_closed", "color"}
    ),
    "projects_issuestatus": frozenset(
        {"id", "project_id", "name", "slug", "order", "is_closed", "color"}
    ),
    "projects_epicstatus": frozenset(
        {"id", "project_id", "name", "slug", "order", "is_closed", "color"}
    ),
    "projects_swimlane": frozenset({"id", "project_id", "name", "order"}),
    "projects_swimlaneuserstorystatus": frozenset({"swimlane_id", "status_id", "wip_limit"}),
    "projects_membership": frozenset({"id", "project_id", "user_id", "role_id", "is_admin"}),
    "users_user": frozenset(
        {"id", "username", "full_name", "is_active", "is_system", "is_superuser", "photo"}
    ),
    "easy_thumbnails_source": frozenset({"id", "name"}),
    "wiki_wikipage": frozenset({"id", "project_id"}),
    "easy_thumbnails_thumbnail": frozenset({"id", "name", "source_id"}),
    "users_role": frozenset({"id", "project_id", "name", "slug", "order", "computable"}),
    "userstories_userstory": frozenset(
        {
            "id",
            "ref",
            "project_id",
            "status_id",
            "swimlane_id",
            "milestone_id",
            "subject",
            "created_date",
            "owner_id",
            "tags",
        }
    ),
    "userstories_userstory_assigned_users": frozenset({"userstory_id", "user_id"}),
    "tasks_task": frozenset(
        {
            "id",
            "ref",
            "project_id",
            "status_id",
            "user_story_id",
            "milestone_id",
            "assigned_to_id",
            "is_iocaine",
            "finished_date",
            "subject",
            "created_date",
            "owner_id",
            "tags",
        }
    ),
    "issues_issue": frozenset(
        {
            "finished_date",
            "id",
            "ref",
            "project_id",
            "status_id",
            "milestone_id",
            "assigned_to_id",
            "subject",
            "created_date",
            "owner_id",
            "tags",
        }
    ),
    "epics_epic": frozenset(
        {"id", "ref", "project_id", "status_id", "subject", "created_date", "owner_id", "tags"}
    ),
    "epics_relateduserstory": frozenset({"epic_id", "user_story_id"}),
    "milestones_milestone": frozenset(
        {"id", "project_id", "name", "estimated_start", "estimated_finish", "closed"}
    ),
    "history_historyentry": frozenset(
        {
            "id",
            "key",
            "type",
            "user",
            "created_at",
            "diff",
            "snapshot",
            "values",
            "comment",
            "is_hidden",
            "delete_comment_date",
            "edit_comment_date",
            "project_id",
        }
    ),
}


@dataclass(frozen=True)
class SchemaReport:
    """Tables and columns the extension expects but Taiga's database does not have."""

    missing_tables: tuple[str, ...]
    missing_columns: tuple[str, ...]

    @property
    def compatible(self) -> bool:
        """Whether every expected table and column is present."""
        return not self.missing_tables and not self.missing_columns


def compare_schema(
    expected: Mapping[str, Set[str]], actual: Mapping[str, Set[str]]
) -> SchemaReport:
    """Compare the expected schema with the actual one.

    Missing columns are reported as ``table.column`` and only for tables that exist.
    """
    missing_tables = sorted(table for table in expected if table not in actual)
    missing_columns = sorted(
        f"{table}.{column}"
        for table, columns in expected.items()
        if table in actual
        for column in columns - actual[table]
    )
    return SchemaReport(tuple(missing_tables), tuple(missing_columns))


async def read_schema(connection: AsyncConnection, tables: Set[str]) -> dict[str, set[str]]:
    """Read the columns of the given tables from ``information_schema``."""
    rows = await connection.execute(
        text(
            "select table_name, column_name from information_schema.columns "
            "where table_schema = 'public' and table_name = any(:tables)"
        ),
        {"tables": sorted(tables)},
    )
    schema: dict[str, set[str]] = {}
    for table, column in rows:
        schema.setdefault(table, set()).add(column)
    return schema


async def check_schema(connection: AsyncConnection) -> SchemaReport:
    """Check Taiga's database against ``EXPECTED_SCHEMA``."""
    actual = await read_schema(connection, set(EXPECTED_SCHEMA))
    return compare_schema(EXPECTED_SCHEMA, actual)
