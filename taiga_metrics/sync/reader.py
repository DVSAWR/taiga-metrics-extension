"""Read-only queries against Taiga's database used by the sync."""

from __future__ import annotations

from typing import TYPE_CHECKING, Any

from sqlalchemy import text

from taiga_metrics.sync.history import HistoryEntry, decode_json

if TYPE_CHECKING:
    from collections.abc import AsyncIterator
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncConnection

HISTORY_BATCH_SIZE = 2000

PROJECTS = text(
    "select id, name, slug, description, owner_id, blocked_code is not null as is_blocked, "
    "coalesce(tags_colors, '{}') as tags_colors from projects_project"
)

STATUSES = text(
    """
    select 'userstory' as item_type, id, project_id, name, slug, "order" as position,
           is_closed, is_archived, wip_limit, color
      from projects_userstorystatus
    union all
    select 'task', id, project_id, name, slug, "order", is_closed, false, null, color
      from projects_taskstatus
    union all
    select 'issue', id, project_id, name, slug, "order", is_closed, false, null, color
      from projects_issuestatus
    union all
    select 'epic', id, project_id, name, slug, "order", is_closed, false, null, color
      from projects_epicstatus
    """
)

USERS = text("select id, username, full_name, is_active, is_superuser, is_system from users_user")

ROLES = text(
    'select id, project_id, name, slug, "order" as position, computable from users_role '
    "where project_id is not null"
)

MEMBERSHIPS = text(
    "select distinct on (project_id, user_id) project_id, user_id, role_id, is_admin "
    "from projects_membership where user_id is not null order by project_id, user_id, id"
)

SWIMLANES = text('select id, project_id, name, "order" as position from projects_swimlane')

SWIMLANE_STATUSES = text(
    "select swimlane_id, status_id, wip_limit from projects_swimlaneuserstorystatus"
)

MILESTONES = text(
    "select id, project_id, name, estimated_start, estimated_finish, closed "
    "from milestones_milestone"
)

ITEMS = text(
    """
    with epics_of_story as (
        select user_story_id, array_agg(epic_id order by epic_id) as epic_ids
          from epics_relateduserstory
         group by user_story_id
    )
    select 'userstory' as item_type, us.id, us.project_id, us.ref, us.subject, us.status_id,
           us.created_date as created_at, us.owner_id, coalesce(us.tags, '{}') as tags,
           null::integer as user_story_id, coalesce(e.epic_ids, '{}') as epic_ids,
           us.milestone_id, us.swimlane_id
      from userstories_userstory us
      left join epics_of_story e on e.user_story_id = us.id
    union all
    select 'task', t.id, t.project_id, t.ref, t.subject, t.status_id, t.created_date,
           t.owner_id, coalesce(t.tags, '{}'), t.user_story_id, coalesce(e.epic_ids, '{}'),
           t.milestone_id, null::integer
      from tasks_task t
      left join epics_of_story e on e.user_story_id = t.user_story_id
    union all
    select 'issue', id, project_id, ref, subject, status_id, created_date, owner_id,
           coalesce(tags, '{}'), null, '{}', milestone_id, null
      from issues_issue
    union all
    select 'epic', id, project_id, ref, subject, status_id, created_date, owner_id,
           coalesce(tags, '{}'), null, '{}', null, null
      from epics_epic
    """
)

HISTORY = text(
    """
    select id, key, type, "user", created_at, project_id, diff, snapshot, "values"
      from history_historyentry
     where key ~ '^(userstories\\.userstory|tasks\\.task|issues\\.issue|epics\\.epic):[0-9]+$'
       and (type in (2, 3) or diff ?| array['status', 'assigned_users', 'assigned_to'])
       and (cast(:since as timestamptz) is null or created_at > cast(:since as timestamptz))
     order by created_at, id
    """
)


async def fetch_all(connection: AsyncConnection, query: Any) -> list[dict[str, Any]]:
    """Run ``query`` and return its rows as dictionaries."""
    result = await connection.execute(query)
    return [dict(row._mapping) for row in result]


def tag_colors(pairs: Any) -> dict[str, str]:
    """Taiga's ``[[name, color], ...]`` as ``{name: color}``, skipping tags without color."""
    colors: dict[str, str] = {}
    for pair in pairs or []:
        if isinstance(pair, list | tuple) and len(pair) == 2 and pair[0] and pair[1]:
            colors[str(pair[0])] = str(pair[1])
    return colors


async def fetch_projects(connection: AsyncConnection) -> list[dict[str, Any]]:
    """Projects with their tag colors turned into a mapping."""
    rows = await fetch_all(connection, PROJECTS)
    return [
        {
            **{key: value for key, value in row.items() if key != "tags_colors"},
            "tag_colors": tag_colors(row["tags_colors"]),
        }
        for row in rows
    ]


def to_entry(row: dict[str, Any]) -> HistoryEntry:
    """Decode one history row."""
    return HistoryEntry(
        id=row["id"],
        key=row["key"],
        type=row["type"],
        user=decode_json(row["user"]) or {},
        created_at=row["created_at"],
        project_id=row["project_id"],
        diff=decode_json(row["diff"]) or {},
        snapshot=decode_json(row["snapshot"]),
        values=decode_json(row["values"]) or {},
    )


async def stream_history(
    connection: AsyncConnection, since: datetime | None
) -> AsyncIterator[list[HistoryEntry]]:
    """History entries relevant to flow metrics, oldest first, in batches."""
    result = await connection.stream(HISTORY, {"since": since})
    async for partition in result.partitions(HISTORY_BATCH_SIZE):
        yield [to_entry(dict(row._mapping)) for row in partition]
