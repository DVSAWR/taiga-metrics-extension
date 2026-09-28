"""Read-side queries over the synced data, for the status and project pages."""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics import store

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


class SyncRun(BaseModel):
    """One sync run as shown in the UI."""

    id: int
    trigger: str
    status: str
    started_at: datetime
    finished_at: datetime | None
    history_since: datetime | None
    history_read: int
    transitions_added: int
    assignments_added: int
    items_checked: int
    mismatches: int
    mismatch_sample: list[dict[str, Any]]
    error: str | None


class ProjectSyncSummary(BaseModel):
    """What is stored for one project."""

    id: int
    name: str
    slug: str
    userstories: int
    tasks: int
    issues: int
    epics: int
    deleted_items: int
    transitions: int
    assignments: int
    last_event_at: datetime | None


class SyncSummary(BaseModel):
    """Stored volumes and the newest history entry read."""

    watermark: datetime | None
    projects: list[ProjectSyncSummary]


class SyncData(Protocol):
    """Read access to synced data."""

    async def runs(self, limit: int) -> list[SyncRun]:
        """Newest runs first."""
        ...

    async def summary(self) -> SyncSummary:
        """Stored volumes per project."""
        ...


SUMMARY = text(
    """
    select p.id, p.name, p.slug,
           count(w.id) filter (where w.item_type = 'userstory' and not w.is_deleted) as userstories,
           count(w.id) filter (where w.item_type = 'task' and not w.is_deleted) as tasks,
           count(w.id) filter (where w.item_type = 'issue' and not w.is_deleted) as issues,
           count(w.id) filter (where w.item_type = 'epic' and not w.is_deleted) as epics,
           count(w.id) filter (where w.is_deleted) as deleted_items,
           (select count(*) from transition t where t.project_id = p.id) as transitions,
           (select count(*) from assignment a where a.project_id = p.id) as assignments,
           (select max(t.happened_at) from transition t where t.project_id = p.id)
               as last_event_at
      from taiga_project p
      left join work_item w on w.project_id = p.id
     group by p.id
     order by lower(p.name), p.id
    """
)

WATERMARK = text("select value from sync_state where key = 'history_watermark'")


class StoredSyncData:
    """Synced data read from the extension's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the engine of the extension's database."""
        self.engine = engine

    async def runs(self, limit: int) -> list[SyncRun]:
        """Newest runs first."""
        async with self.engine.connect() as connection:
            rows = await connection.execute(
                store.sync_run.select().order_by(store.sync_run.c.id.desc()).limit(limit)
            )
            return [SyncRun.model_validate(row._mapping) for row in rows]

    async def summary(self) -> SyncSummary:
        """Stored volumes per project."""
        async with self.engine.connect() as connection:
            watermark = (await connection.execute(WATERMARK)).scalar_one_or_none()
            rows = await connection.execute(SUMMARY)
            return SyncSummary(
                watermark=datetime.fromisoformat(watermark) if watermark else None,
                projects=[ProjectSyncSummary.model_validate(row._mapping) for row in rows],
            )
