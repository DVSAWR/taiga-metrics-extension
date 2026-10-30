"""One sync run: copy Taiga's dictionaries and items, append new history, verify.

Taiga is read inside a single repeatable-read transaction, so items and history come
from the same moment. Everything written to the extension's database for one run is
committed together, so a failed run leaves the previous state untouched.
"""

from __future__ import annotations

import logging
from dataclasses import asdict
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Any, Final

from sqlalchemy import and_, bindparam, delete, func, insert, select, text, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from taiga_metrics import store
from taiga_metrics.sync import reader
from taiga_metrics.sync.history import parse_entry, parse_key

if TYPE_CHECKING:
    from collections.abc import Sequence
    from datetime import timedelta

    from sqlalchemy import Table
    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

    from taiga_metrics.sync.history import Assignment, DeletedItem, HistoryEntry, Transition

logger = logging.getLogger(__name__)

LOCK_KEY: Final = 7_236_451_001
WATERMARK_KEY: Final = "history_watermark"
MISMATCH_SAMPLE_SIZE: Final = 50

MISMATCHES = text(
    """
    with last_status as (
        select distinct on (item_type, item_id) item_type, item_id, to_status_id
          from transition
         where kind <> 'delete'
         order by item_type, item_id, happened_at desc, history_id desc
    )
    select w.item_type, w.id as item_id, w.project_id, p.slug as project_slug, w.ref,
           w.subject, w.status_id as actual_status_id, actual.name as actual_status,
           l.to_status_id as history_status_id, recorded.name as history_status,
           case when l.item_id is null then 'no_history' else 'mismatch' end as reason
      from work_item w
      left join last_status l on l.item_type = w.item_type and l.item_id = w.id
      left join taiga_project p on p.id = w.project_id
      left join taiga_status actual
             on actual.item_type = w.item_type and actual.id = w.status_id
      left join taiga_status recorded
             on recorded.item_type = w.item_type and recorded.id = l.to_status_id
     where not w.is_deleted and l.to_status_id is distinct from w.status_id
     order by w.project_id, w.item_type, w.ref
    """
)


KNOWN_STATUS_NAMES = """
    select distinct on (item_type, status_id) item_type, status_id, project_id, name
      from (
          select item_type, from_status_id as status_id, project_id,
                 from_status_name as name, happened_at
            from transition
           where from_status_id is not null and from_status_name is not null
          union all
          select item_type, to_status_id, project_id, to_status_name, happened_at
            from transition
           where to_status_id is not null and to_status_name is not null
      ) named
     order by item_type, status_id, happened_at desc
"""

FILL_NAMES_FROM_HISTORY = tuple(
    text(
        f"""
        update transition t
           set {side}_status_name = known.name
          from ({KNOWN_STATUS_NAMES}) known
         where t.{side}_status_name is null
           and known.item_type = t.item_type
           and known.status_id = t.{side}_status_id
        """
    )
    for side in ("from", "to")
)

ADD_REMOVED_STATUSES = text(
    f"""
    insert into taiga_status (item_type, id, project_id, name, slug, position, is_closed,
                              is_archived, wip_limit, is_deleted, color)
    select used.item_type, used.status_id, used.project_id,
           coalesce(known.name, 'Removed column ' || used.status_id), '',
           1000000 + used.status_id, false, false, null, true, ''
      from (
          select distinct on (item_type, status_id) item_type, status_id, project_id
            from (
                select item_type, from_status_id as status_id, project_id from transition
                union all
                select item_type, to_status_id, project_id from transition
            ) ends
           where status_id is not null
           order by item_type, status_id
      ) used
      left join ({KNOWN_STATUS_NAMES}) known
             on known.item_type = used.item_type and known.status_id = used.status_id
     where not exists (
         select 1 from taiga_status s
          where s.item_type = used.item_type and s.id = used.status_id
     )
    """
)

FILL_STATUS_NAMES = tuple(
    text(
        f"""
        update transition t
           set {side}_status_name = s.name
          from taiga_status s
         where t.{side}_status_name is null
           and s.item_type = t.item_type
           and s.id = t.{side}_status_id
        """
    )
    for side in ("from", "to")
)


class SyncAlreadyRunningError(RuntimeError):
    """Another sync holds the lock."""


class SyncService:
    """Runs syncs from Taiga's database into the extension's database."""

    def __init__(
        self, taiga_engine: AsyncEngine, metrics_engine: AsyncEngine, overlap: timedelta
    ) -> None:
        """Keep both engines and how far back each incremental read re-reads history."""
        self.taiga_engine = taiga_engine
        self.metrics_engine = metrics_engine
        self.overlap = overlap

    async def run(self, trigger: str) -> int:
        """Run one sync and return the id of its ``sync_run`` row.

        Raises ``SyncAlreadyRunningError`` when another sync is in progress.
        """
        async with self.metrics_engine.connect() as lock_connection:
            locked: bool = (
                await lock_connection.execute(select(func.pg_try_advisory_lock(LOCK_KEY)))
            ).scalar_one()
            await lock_connection.commit()
            if not locked:
                raise SyncAlreadyRunningError
            try:
                return await self.run_locked(trigger)
            finally:
                await lock_connection.execute(select(func.pg_advisory_unlock(LOCK_KEY)))
                await lock_connection.commit()

    async def run_locked(self, trigger: str) -> int:
        """Run one sync while holding the lock."""
        await self.close_interrupted_runs()
        run_id = await self.start_run(trigger)
        try:
            counters = await self.copy()
        except Exception as error:
            logger.exception("Sync %s failed", run_id)
            await self.finish_run(run_id, "failed", {"error": f"{type(error).__name__}: {error}"})
            raise
        await self.finish_run(run_id, "succeeded", counters)
        logger.info("Sync %s finished: %s", run_id, counters)
        return run_id

    async def close_interrupted_runs(self) -> None:
        """Runs still marked running were cut short, since this process holds the lock."""
        async with self.metrics_engine.begin() as connection:
            await connection.execute(
                update(store.sync_run)
                .where(store.sync_run.c.status == "running")
                .values(status="interrupted", finished_at=datetime.now(UTC))
            )

    async def start_run(self, trigger: str) -> int:
        """Record a running sync."""
        async with self.metrics_engine.begin() as connection:
            result = await connection.execute(
                insert(store.sync_run)
                .values(trigger=trigger, status="running", started_at=datetime.now(UTC))
                .returning(store.sync_run.c.id)
            )
            run_id: int = result.scalar_one()
            return run_id

    async def finish_run(self, run_id: int, status: str, values: dict[str, Any]) -> None:
        """Record the outcome of a sync."""
        async with self.metrics_engine.begin() as connection:
            await connection.execute(
                update(store.sync_run)
                .where(store.sync_run.c.id == run_id)
                .values(status=status, finished_at=datetime.now(UTC), **values)
            )

    async def copy(self) -> dict[str, Any]:
        """Copy everything and verify it; return the counters stored on the run."""
        async with self.taiga_engine.connect() as connection:
            source = await connection.execution_options(isolation_level="REPEATABLE READ")
            async with self.metrics_engine.begin() as target:
                await replace_dictionaries(source, target)
                items = await reader.fetch_all(source, reader.ITEMS)
                await upsert_items(target, items)
                since = await read_since(target, self.overlap)
                history_read = transitions_added = assignments_added = 0
                watermark = since + self.overlap if since is not None else None
                async for batch in reader.stream_history(source, since):
                    history_read += len(batch)
                    added = await store_batch(target, batch)
                    transitions_added += added[0]
                    assignments_added += added[1]
                    watermark = max(filter(None, (watermark, batch[-1].created_at)))
                await mark_missing_items(target, items)
                await fill_created_at(target)
                for statement in (*FILL_STATUS_NAMES, *FILL_NAMES_FROM_HISTORY):
                    await target.execute(statement)
                await target.execute(ADD_REMOVED_STATUSES)
                if watermark is not None:
                    await write_watermark(target, watermark)
                mismatches = [dict(row._mapping) for row in await target.execute(MISMATCHES)]
                items_checked = (
                    await target.execute(
                        select(func.count())
                        .select_from(store.work_item)
                        .where(store.work_item.c.is_deleted.is_(False))
                    )
                ).scalar_one()
        return {
            "history_since": since,
            "history_read": history_read,
            "transitions_added": transitions_added,
            "assignments_added": assignments_added,
            "items_checked": items_checked,
            "mismatches": len(mismatches),
            "mismatch_sample": mismatches[:MISMATCH_SAMPLE_SIZE],
        }


async def replace_rows(
    target: AsyncConnection, table: Table, rows: Sequence[dict[str, Any]]
) -> None:
    """Replace the whole content of a mirror table."""
    await target.execute(delete(table))
    if rows:
        await target.execute(insert(table), list(rows))


async def replace_dictionaries(source: AsyncConnection, target: AsyncConnection) -> None:
    """Copy projects, users, roles, memberships, swimlanes, milestones, and statuses.

    Statuses removed from Taiga are kept and flagged, because old transitions still
    point at them. Statuses removed before the first sync are added later from the
    transitions, named after what the history last called them.
    """
    await replace_rows(target, store.taiga_project, await reader.fetch_projects(source))
    for table, query in (
        (store.taiga_user, reader.USERS),
        (store.taiga_role, reader.ROLES),
        (store.taiga_membership, reader.MEMBERSHIPS),
        (store.taiga_swimlane, reader.SWIMLANES),
        (store.taiga_swimlane_status, reader.SWIMLANE_STATUSES),
        (store.taiga_milestone, reader.MILESTONES),
    ):
        await replace_rows(target, table, await reader.fetch_all(source, query))
    statuses = await reader.fetch_all(source, reader.STATUSES)
    await target.execute(update(store.taiga_status).values(is_deleted=True))
    if statuses:
        statement = pg_insert(store.taiga_status)
        await target.execute(
            statement.on_conflict_do_update(
                index_elements=["item_type", "id"],
                set_={
                    column: statement.excluded[column]
                    for column in (
                        "project_id",
                        "name",
                        "slug",
                        "position",
                        "is_closed",
                        "is_archived",
                        "wip_limit",
                        "is_deleted",
                        "color",
                    )
                },
            ),
            [{**status, "is_deleted": False} for status in statuses],
        )


async def upsert_items(target: AsyncConnection, items: Sequence[dict[str, Any]]) -> None:
    """Insert or refresh every item that currently exists in Taiga."""
    if not items:
        return
    statement = pg_insert(store.work_item)
    await target.execute(
        statement.on_conflict_do_update(
            index_elements=["item_type", "id"],
            set_={
                "project_id": statement.excluded.project_id,
                "ref": statement.excluded.ref,
                "subject": statement.excluded.subject,
                "status_id": statement.excluded.status_id,
                "created_at": statement.excluded.created_at,
                "owner_id": statement.excluded.owner_id,
                "tags": statement.excluded.tags,
                "user_story_id": statement.excluded.user_story_id,
                "epic_ids": statement.excluded.epic_ids,
                "milestone_id": statement.excluded.milestone_id,
                "swimlane_id": statement.excluded.swimlane_id,
                "is_deleted": False,
                "deleted_at": None,
            },
        ),
        [{**item, "is_deleted": False, "deleted_at": None} for item in items],
    )


async def read_since(target: AsyncConnection, overlap: timedelta) -> datetime | None:
    """Where to resume reading history: the last watermark minus the overlap."""
    value: str | None = (
        await target.execute(
            select(store.sync_state.c.value).where(store.sync_state.c.key == WATERMARK_KEY)
        )
    ).scalar_one_or_none()
    if value is None:
        return None
    return datetime.fromisoformat(value) - overlap


async def write_watermark(target: AsyncConnection, watermark: datetime) -> None:
    """Remember the newest history entry read."""
    statement = pg_insert(store.sync_state).values(key=WATERMARK_KEY, value=watermark.isoformat())
    await target.execute(
        statement.on_conflict_do_update(
            index_elements=["key"], set_={"value": statement.excluded.value}
        )
    )


async def store_batch(target: AsyncConnection, batch: Sequence[HistoryEntry]) -> tuple[int, int]:
    """Store transitions, assignments, and deleted items of a batch.

    Returns how many transitions and assignments were new; already stored entries are
    skipped, which makes re-reading the overlap harmless.
    """
    transitions: list[Transition] = []
    assignments: list[Assignment] = []
    deleted: list[DeletedItem] = []
    activity = []
    for entry in batch:
        key = parse_key(entry.key)
        if key is not None:
            activity.append(
                {
                    "history_id": entry.id,
                    "item_type": key[0],
                    "item_id": key[1],
                    "project_id": entry.project_id,
                    "happened_at": entry.created_at,
                    "is_activity": entry.is_activity,
                }
            )
        parsed = parse_entry(entry)
        if parsed.transition is not None:
            transitions.append(parsed.transition)
        if parsed.assignment is not None:
            assignments.append(parsed.assignment)
        if parsed.deleted_item is not None:
            deleted.append(parsed.deleted_item)
    added_transitions = await insert_new(
        target, store.transition, [asdict(t) for t in transitions]
    )
    added_assignments = await insert_new(
        target,
        store.assignment,
        [{**asdict(a), "assignee_ids": list(a.assignee_ids)} for a in assignments],
    )
    if activity:
        statement = pg_insert(store.card_activity)
        await target.execute(
            statement.on_conflict_do_update(
                index_elements=["history_id"],
                set_={"is_activity": statement.excluded.is_activity},
            ),
            activity,
        )
    await store_deleted(target, deleted)
    return added_transitions, added_assignments


async def insert_new(target: AsyncConnection, table: Table, rows: list[dict[str, Any]]) -> int:
    """Insert rows keyed by ``history_id``, skipping existing ones; return how many were new."""
    if not rows:
        return 0
    statement = (
        pg_insert(table)
        .on_conflict_do_nothing(index_elements=["history_id"])
        .returning(table.c.history_id)
    )
    result = await target.execute(statement, rows)
    return len(result.all())


async def store_deleted(target: AsyncConnection, deleted: Sequence[DeletedItem]) -> None:
    """Keep items deleted in Taiga, flagged, so their history stays attributable."""
    if not deleted:
        return
    statement = pg_insert(store.work_item)
    await target.execute(
        statement.on_conflict_do_update(
            index_elements=["item_type", "id"],
            set_={
                "is_deleted": True,
                "deleted_at": statement.excluded.deleted_at,
                "ref": func.coalesce(store.work_item.c.ref, statement.excluded.ref),
                "subject": func.coalesce(
                    func.nullif(store.work_item.c.subject, ""), statement.excluded.subject
                ),
            },
        ),
        [
            {
                "item_type": item.item_type,
                "id": item.item_id,
                "project_id": item.project_id,
                "ref": item.ref,
                "subject": item.subject,
                "status_id": None,
                "created_at": None,
                "is_deleted": True,
                "deleted_at": item.deleted_at,
            }
            for item in deleted
        ],
    )


async def mark_missing_items(target: AsyncConnection, items: Sequence[dict[str, Any]]) -> None:
    """Flag items that disappeared from Taiga without a deletion entry in history."""
    present = select(
        func.unnest(
            bindparam("types", [item["item_type"] for item in items], type_=store.ARRAY_TEXT)
        ).label("item_type"),
        func.unnest(bindparam("ids", [item["id"] for item in items], type_=store.ARRAY_INT)).label(
            "id"
        ),
    ).subquery()
    await target.execute(
        update(store.work_item)
        .where(
            store.work_item.c.is_deleted.is_(False),
            ~select(present.c.id)
            .where(
                and_(
                    present.c.item_type == store.work_item.c.item_type,
                    present.c.id == store.work_item.c.id,
                )
            )
            .exists(),
        )
        .values(
            is_deleted=True, deleted_at=func.coalesce(store.work_item.c.deleted_at, func.now())
        )
    )


async def fill_created_at(target: AsyncConnection) -> None:
    """Deleted items have no Taiga row; take their creation time from history."""
    creation = (
        select(store.transition.c.happened_at)
        .where(
            store.transition.c.kind == "create",
            store.transition.c.item_type == store.work_item.c.item_type,
            store.transition.c.item_id == store.work_item.c.id,
        )
        .limit(1)
        .scalar_subquery()
    )
    await target.execute(
        update(store.work_item)
        .where(store.work_item.c.created_at.is_(None))
        .values(created_at=creation)
    )
