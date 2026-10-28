"""The achievements of a person page: Taiga's Team page counts and five of the extension.

Taiga's five are computed exactly as Taiga computes them, including its own idea of
closed (``is_closed`` of the status), so they match Taiga's. The extension adds five of
its own: user stories created, cards brought to a Done column as the owner marked them,
column changes made, comments written, and how much of the person's own work came back,
the returns credited to them by the project's return rules. Total power adds every count
times its weight, so the last one takes points away.
"""

from __future__ import annotations

from collections import Counter
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics.comments import history_key
from taiga_metrics.metrics.engine import FlowOptions, card_returns, in_period
from taiga_metrics.metrics.loader import StoredFlowData
from taiga_metrics.sync.history import ITEM_TYPES

if TYPE_CHECKING:
    from collections.abc import Collection

    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

    from taiga_metrics.explore import CardKey

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
        explanation="Own cards that came back",
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
         where (not cast(:filtered as boolean) or i.id = any(cast(:issue_ids as integer[])))
           and i.project_id = :project_id and s.is_closed and i.assigned_to_id is not null
           and (cast(:since as timestamptz) is null or i.finished_date >= :since) and (cast(:until as timestamptz) is null or i.finished_date < :until)
         group by 1
        """
    ),
    "iocaine_tasks": text(
        """
        select assigned_to_id as user_id, count(*) as total
          from tasks_task
         where (not cast(:filtered as boolean) or id = any(cast(:task_ids as integer[])))
           and project_id = :project_id and is_iocaine and assigned_to_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "wiki_changes": text(
        """
        select cast(h."user"->>'pk' as integer) as user_id, count(*) as total
          from history_historyentry h
         where not cast(:filtered as boolean) and h.key in (
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
         where (not cast(:filtered as boolean) or id = any(cast(:issue_ids as integer[])))
           and project_id = :project_id and owner_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "closed_tasks": text(
        """
        select t.assigned_to_id as user_id, count(*) as total
          from tasks_task t
          join projects_taskstatus s on s.id = t.status_id
         where (not cast(:filtered as boolean) or t.id = any(cast(:task_ids as integer[])))
           and t.project_id = :project_id and s.is_closed and t.assigned_to_id is not null
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
         where (not cast(:filtered as boolean) or id = any(cast(:userstory_ids as integer[])))
           and project_id = :project_id and owner_id is not null
           and (cast(:since as timestamptz) is null or created_date >= :since) and (cast(:until as timestamptz) is null or created_date < :until)
         group by 1
        """
    ),
    "comments": text(
        """
        select cast(h."user"->>'pk' as integer) as user_id, count(*) as total
          from history_historyentry h
         where (not cast(:filtered as boolean) or h.key = any(cast(:history_keys as text[])))
           and h.project_id = :project_id
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
         where (not cast(:filtered as boolean) or (t.item_type, t.item_id) in (
             select * from unnest(cast(:key_types as text[]), cast(:key_ids as integer[]))
           )) and t.project_id = :project_id and t.kind = 'move' and t.user_id is not null
           and source.type is distinct from 'done'
           and (cast(:since as timestamptz) is null or t.happened_at >= :since) and (cast(:until as timestamptz) is null or t.happened_at < :until)
         group by 1
        """
    ),
    "moves": text(
        """
        select user_id, count(*) as total
          from transition
         where (not cast(:filtered as boolean) or (item_type, item_id) in (
             select * from unnest(cast(:key_types as text[]), cast(:key_ids as integer[]))
           )) and project_id = :project_id and kind = 'move' and user_id is not null
           and (cast(:since as timestamptz) is null or happened_at >= :since) and (cast(:until as timestamptz) is null or happened_at < :until)
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


async def credited_returns(
    connection: AsyncConnection,
    project_id: int,
    since: datetime | None,
    until: datetime | None,
    keys: Collection[CardKey] | None = None,
) -> dict[int, int]:
    """How many returns of every card type each person is credited with in the period.

    The project's return rules decide what counts and to whom it is credited.
    """
    data = StoredFlowData
    counts: Counter[int] = Counter()
    now = datetime.now(UTC)
    for item_type in ITEM_TYPES.values():
        params = {"project_id": project_id, "item_type": item_type}
        item_ids = (
            None if keys is None else [item_id for kind, item_id in keys if kind == item_type]
        )
        if item_ids is not None and not item_ids:
            continue
        columns, cards = await data.cards(connection, params, item_ids)
        rules, misclick = await data.return_options(connection, project_id, item_type)
        by_id = {column.status_id: column for column in columns}
        options = FlowOptions(
            now=now,
            since=since,
            until=until,
            working_days=True,
            misclick=misclick,
            returns=rules,
        )
        for card in cards:
            for item in card_returns(card, by_id, options):
                if in_period(item.happened_at, options):
                    counts.update(item.credited)
    return dict(counts)


class TeamSource(Protocol):
    """Anything that can count the team statistics of a project."""

    async def stats(
        self,
        project_id: int,
        since: datetime | None = None,
        until: datetime | None = None,
        *,
        cards: Collection[CardKey] | None = None,
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
        self,
        project_id: int,
        since: datetime | None = None,
        until: datetime | None = None,
        *,
        cards: Collection[CardKey] | None = None,
    ) -> TeamStats:
        """Every count for everyone who has any, of events between ``since`` and ``until``."""
        params = {
            "project_id": project_id,
            "since": since,
            "until": until,
            "filtered": cards is not None,
            "issue_ids": [item_id for kind, item_id in cards or [] if kind == "issue"],
            "task_ids": [item_id for kind, item_id in cards or [] if kind == "task"],
            "userstory_ids": [item_id for kind, item_id in cards or [] if kind == "userstory"],
            "history_keys": [history_key(kind, item_id) for kind, item_id in cards or []],
            "key_types": [kind for kind, _ in cards or []],
            "key_ids": [item_id for _, item_id in cards or []],
        }
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
            values["sent_back"] = await credited_returns(
                connection, project_id, since, until, cards
            )
        modules: list[Module] = []
        if row is not None:
            modules = [module for module in ("issues", "tasks", "wiki") if row._mapping[module]]
        return TeamStats(
            metrics=[*TAIGA_METRICS, *EXTENSION_METRICS], values=values, modules=modules
        )
