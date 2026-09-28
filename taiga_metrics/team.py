"""Taiga's team statistics, the numbers of its Team page, read from its database.

Taiga's five are computed exactly as Taiga computes them, including its own idea of
closed (``is_closed`` of the status), so the page matches Taiga's. The extension adds
five of its own: user stories created, cards brought to a Done column as the owner
marked them, column changes made, comments written, and cards sent back for rework
while the person was assigned. Total power adds every count times its weight, so the
last one takes points away.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import BaseModel
from sqlalchemy import text

if TYPE_CHECKING:
    from datetime import datetime

    from sqlalchemy.ext.asyncio import AsyncEngine

Source = Literal["taiga", "extension"]
Module = Literal["issues", "tasks", "wiki"]


class PowerMetric(BaseModel):
    """One column of the team table."""

    key: str
    title: str
    explanation: str
    icon: str
    module: Module | None
    source: Source
    weight: int = 1


class TeamStats(BaseModel):
    """Every metric's count per user, and which Taiga modules are switched on."""

    metrics: list[PowerMetric]
    values: dict[str, dict[int, int]]
    modules: list[Module]


TAIGA_METRICS: list[PowerMetric] = [
    PowerMetric(
        key="closed_bugs",
        title="Mr. Wolf",
        explanation="Closed issues",
        icon="briefcase",
        module="issues",
        source="taiga",
    ),
    PowerMetric(
        key="iocaine_tasks",
        title="Iocaine Drinker",
        explanation="Iocaine doses ingested",
        icon="iocaine",
        module="tasks",
        source="taiga",
    ),
    PowerMetric(
        key="wiki_changes",
        title="Cervantes",
        explanation="Wiki pages edited",
        icon="edit",
        module="wiki",
        source="taiga",
    ),
    PowerMetric(
        key="created_bugs",
        title="Bug Hunter",
        explanation="Issues reported",
        icon="bug",
        module="issues",
        source="taiga",
    ),
    PowerMetric(
        key="closed_tasks",
        title="Night Shift",
        explanation="Tasks closed",
        icon="task",
        module="tasks",
        source="taiga",
    ),
]

EXTENSION_METRICS: list[PowerMetric] = [
    PowerMetric(
        key="created_stories",
        title="Storyteller",
        explanation="User stories created",
        icon="bulb",
        module=None,
        source="extension",
    ),
    PowerMetric(
        key="finished_cards",
        title="Workhorse",
        explanation="Cards brought to Done",
        icon="horse",
        module=None,
        source="extension",
    ),
    PowerMetric(
        key="moves",
        title="Traveler",
        explanation="Column changes made",
        icon="traveler",
        module=None,
        source="extension",
    ),
    PowerMetric(
        key="comments",
        title="Chatterbox",
        explanation="Comments written",
        icon="message",
        module=None,
        source="extension",
    ),
    PowerMetric(
        key="sent_back",
        title="Doombringer",
        explanation="Cards sent back for rework",
        icon="reload",
        module=None,
        source="extension",
        weight=-1,
    ),
]

COUNTS = {
    "closed_bugs": text(
        """
        select i.assigned_to_id as user_id, count(*) as total
          from issues_issue i
          join projects_issuestatus s on s.id = i.status_id
         where i.project_id = :project_id and s.is_closed and i.assigned_to_id is not null
           and (cast(:since as timestamptz) is null or i.finished_date >= :since) and (cast(:until as timestamptz) is null or i.finished_date < :until)
         group by 1
        """
    ),
    "iocaine_tasks": text(
        """
        select assigned_to_id as user_id, count(*) as total
          from tasks_task
         where project_id = :project_id and is_iocaine and assigned_to_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "wiki_changes": text(
        """
        select cast(h."user"->>'pk' as integer) as user_id, count(*) as total
          from history_historyentry h
         where h.key in (
               select 'wiki.wikipage:' || w.id from wiki_wikipage w
                where w.project_id = :project_id
           )
           and h."user"->>'pk' is not null
           and (cast(:since as timestamptz) is null or h.created_at >= :since) and (cast(:until as timestamptz) is null or h.created_at < :until)
         group by 1
        """
    ),
    "created_bugs": text(
        """
        select owner_id as user_id, count(*) as total
          from issues_issue
         where project_id = :project_id and owner_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "closed_tasks": text(
        """
        select t.assigned_to_id as user_id, count(*) as total
          from tasks_task t
          join projects_taskstatus s on s.id = t.status_id
         where t.project_id = :project_id and s.is_closed and t.assigned_to_id is not null
           and (cast(:since as timestamptz) is null or t.finished_date >= :since) and (cast(:until as timestamptz) is null or t.finished_date < :until)
         group by 1
        """
    ),
}

TAIGA_EXTENSION_COUNTS = {
    "created_stories": text(
        """
        select owner_id as user_id, count(*) as total
          from userstories_userstory
         where project_id = :project_id and owner_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "comments": text(
        """
        select cast(h."user"->>'pk' as integer) as user_id, count(*) as total
          from history_historyentry h
         where h.project_id = :project_id
           and coalesce(h.comment, '') <> ''
           and h.delete_comment_date is null
           and (cast(:since as timestamptz) is null or h.created_at >= :since) and (cast(:until as timestamptz) is null or h.created_at < :until)
           and h.key ~ '^(epics\\.epic|userstories\\.userstory|tasks\\.task|issues\\.issue):'
           and h."user"->>'pk' is not null
         group by 1
        """
    ),
}

STORED_COUNTS = {
    "finished_cards": text(
        """
        select t.user_id, count(*) as total
          from transition t
          join column_type target
            on target.project_id = t.project_id and target.item_type = t.item_type
           and target.status_id = t.to_status_id and target.type = 'done'
          left join column_type source
            on source.project_id = t.project_id and source.item_type = t.item_type
           and source.status_id = t.from_status_id
         where t.project_id = :project_id and t.kind = 'move' and t.user_id is not null
           and source.type is distinct from 'done'
           and (cast(:since as timestamptz) is null or t.happened_at >= :since) and (cast(:until as timestamptz) is null or t.happened_at < :until)
         group by 1
        """
    ),
    "moves": text(
        """
        select user_id, count(*) as total
          from transition
         where project_id = :project_id and kind = 'move' and user_id is not null
           and (cast(:since as timestamptz) is null or happened_at >= :since) and (cast(:until as timestamptz) is null or happened_at < :until)
         group by 1
        """
    ),
    "sent_back": text(
        """
        with steps as (
            select t.item_type, t.item_id, t.project_id, t.kind, t.happened_at,
                   t.from_status_id, t.to_status_id,
                   lag(t.happened_at) over (
                       partition by t.item_type, t.item_id order by t.happened_at, t.history_id
                   ) as entered_at
              from transition t
             where t.project_id = :project_id
        ),
        back as (
            select s.item_type, s.item_id, s.happened_at
              from steps s
              join taiga_status source
                on source.item_type = s.item_type and source.id = s.from_status_id
              join taiga_status target
                on target.item_type = s.item_type and target.id = s.to_status_id
              left join column_type source_type
                on source_type.project_id = s.project_id and source_type.item_type = s.item_type
               and source_type.status_id = s.from_status_id
              left join column_type target_type
                on target_type.project_id = s.project_id and target_type.item_type = s.item_type
               and target_type.status_id = s.to_status_id
             where s.kind = 'move'
               and (cast(:since as timestamptz) is null or s.happened_at >= :since) and (cast(:until as timestamptz) is null or s.happened_at < :until)
               and (s.entered_at is null or s.happened_at - s.entered_at >= interval '5 minutes')
               and source_type.type is distinct from 'cancelled'
               and target_type.type is distinct from 'cancelled'
               and (
                   (target_type.type = 'rework' and source_type.type is distinct from 'rework')
                   or (source_type.type = 'done' and target_type.type is distinct from 'done')
                   or (target.position < source.position
                       and source_type.type is distinct from 'rework')
               )
        )
        select person as user_id, count(*) as total
          from back b
          cross join lateral (
              select a.assignee_ids from assignment a
               where a.item_type = b.item_type and a.item_id = b.item_id
                 and a.happened_at < b.happened_at
               order by a.happened_at desc, a.history_id desc
               limit 1
          ) assigned
          cross join lateral unnest(assigned.assignee_ids) as person
         group by 1
        """
    ),
}

MODULES = text(
    """
    select is_issues_activated as issues,
           is_kanban_activated or is_backlog_activated as tasks,
           is_wiki_activated as wiki
      from projects_project
     where id = :project_id
    """
)


class TeamSource(Protocol):
    """Anything that can count the team statistics of a project."""

    async def stats(
        self, project_id: int, since: datetime | None = None, until: datetime | None = None
    ) -> TeamStats:
        """Every metric's count per user of the project, over the period if one is given."""
        ...


class DatabaseTeamStats:
    """Counts from Taiga's database, read-only, and from the synced transitions."""

    def __init__(self, taiga_engine: AsyncEngine, metrics_engine: AsyncEngine) -> None:
        """Keep both engines."""
        self.taiga_engine = taiga_engine
        self.metrics_engine = metrics_engine

    async def stats(
        self, project_id: int, since: datetime | None = None, until: datetime | None = None
    ) -> TeamStats:
        """Every count for everyone who has any, of events between ``since`` and ``until``."""
        params = {"project_id": project_id, "since": since, "until": until}
        values: dict[str, dict[int, int]] = {}
        async with self.taiga_engine.connect() as connection:
            for key, query in {**COUNTS, **TAIGA_EXTENSION_COUNTS}.items():
                values[key] = {
                    row.user_id: row.total for row in await connection.execute(query, params)
                }
            row = (await connection.execute(MODULES, params)).first()
        async with self.metrics_engine.connect() as connection:
            for key, query in STORED_COUNTS.items():
                values[key] = {
                    row.user_id: row.total for row in await connection.execute(query, params)
                }
        modules: list[Module] = []
        if row is not None:
            modules = [module for module in ("issues", "tasks", "wiki") if row._mapping[module]]
        return TeamStats(
            metrics=[*TAIGA_METRICS, *EXTENSION_METRICS], values=values, modules=modules
        )
