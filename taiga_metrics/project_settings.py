"""What project owners configure: what each column means, and working calendars.

Taiga knows neither: its ``is_closed`` flag is unreliable, and it has no calendar. The
project's managers mark every column as queue, work, done, or cancelled, name the roles
responsible for the work in it, and set the project's time zone and working weekdays,
optionally different weekdays per member, and, without Taiga's Scrum, the cadence of
the reporting periods.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final, Literal, Protocol, get_args
from zoneinfo import available_timezones

from pydantic import BaseModel, Field
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from taiga_metrics import store
from taiga_metrics.metrics.returns import ColumnMode, Credit
from taiga_metrics.reporting import Cadence

if TYPE_CHECKING:
    from collections.abc import Iterable

    from sqlalchemy.ext.asyncio import AsyncEngine

ColumnType = Literal["queue", "work", "done", "cancelled"]
COLUMN_TYPES: Final[tuple[ColumnType, ...]] = get_args(ColumnType)
ITEM_TYPE_ORDER: Final = ("userstory", "task", "issue", "epic")
DEFAULT_TIMEZONE: Final = "UTC"
DEFAULT_WORKING_DAYS: Final = (1, 2, 3, 4, 5)


def valid_timezone(name: str) -> bool:
    """Whether ``name`` is an IANA time zone known to this system."""
    return name in available_timezones()


def normalize_days(days: list[int]) -> list[int]:
    """ISO weekdays, 1 for Monday to 7 for Sunday, sorted and without duplicates."""
    return sorted({day for day in days if 1 <= day <= 7})


class ReturnSettings(BaseModel):
    """What counts as a return in one card type, and to whom it is credited.

    ``misclick_minutes`` is how quickly a move must be undone to be a mistake; a stay
    shorter than that only passed through a column.
    """

    earlier: bool = True
    out_of_done: bool = True
    misclick_minutes: int = Field(default=5, ge=0, le=1440)
    credit: Credit = "assignees"


class ReturnPair(BaseModel):
    """A move from one column to another marked a return, or no return, over the rules."""

    from_status: int
    to_status: int
    is_return: bool


class ColumnInfo(BaseModel):
    """One column of one card type, with the type and the responsible roles the owner gave it.

    ``return_mode`` makes it a pause, where cards wait without going back, or a triage,
    whose returns are credited to the column a card is sent to next.
    """

    status_id: int
    name: str
    color: str
    position: int
    is_closed: bool
    is_archived: bool
    is_deleted: bool
    cards: int
    type: ColumnType | None
    roles: list[int] = []
    return_mode: ColumnMode = "normal"


class ItemTypeColumns(BaseModel):
    """All columns of one card type in Taiga's order, with its return rules and the moves
    marked over them.
    """

    item_type: str
    columns: list[ColumnInfo]
    returns: ReturnSettings = ReturnSettings()
    return_pairs: list[ReturnPair] = []


class MemberCalendar(BaseModel):
    """A member and their own working weekdays, if the owner set any."""

    user_id: int
    name: str
    role: str
    working_days: list[int] | None


class CalendarSettings(BaseModel):
    """The calendar of a project."""

    timezone: str
    working_days: list[int]
    members: list[MemberCalendar]


class ProjectSettingsStore(Protocol):
    """Anything that stores what owners configure."""

    async def columns(self, project_id: int) -> list[ItemTypeColumns]:
        """Columns of every card type with their configured types."""
        ...

    async def set_column_type(
        self,
        project_id: int,
        item_type: str,
        status_id: int,
        column_type: ColumnType | None,
        by_user: int,
    ) -> bool:
        """Set or clear a column type; ``False`` if the column is not in the project."""
        ...

    async def set_column_roles(
        self, project_id: int, item_type: str, status_id: int, role_ids: list[int], by_user: int
    ) -> bool:
        """Replace the roles responsible for a column; ``False`` if it is not in the project."""
        ...

    async def calendar(self, project_id: int) -> CalendarSettings:
        """The project calendar, defaults filled in."""
        ...

    async def cadences(self, project_ids: Iterable[int]) -> dict[int, Cadence]:
        """The reporting cadence of each project; switched off when none is stored."""
        ...

    async def set_return_settings(
        self, project_id: int, item_type: str, settings: ReturnSettings, by_user: int
    ) -> None:
        """Store what counts as a return in one card type."""
        ...

    async def set_column_return(
        self, project_id: int, item_type: str, status_id: int, mode: ColumnMode, by_user: int
    ) -> bool:
        """Make a column normal, a pause, or a triage; ``False`` if it is not in the project."""
        ...

    async def set_return_pairs(
        self, project_id: int, item_type: str, pairs: list[ReturnPair], by_user: int
    ) -> None:
        """Replace the marked moves of one card type; moves of unknown columns are dropped."""
        ...

    async def set_cadence(self, project_id: int, cadence: Cadence, by_user: int) -> None:
        """Store the reporting cadence, or remove it when it is switched off."""
        ...

    async def set_calendar(
        self, project_id: int, timezone: str, working_days: list[int], by_user: int
    ) -> None:
        """Store the project calendar."""
        ...

    async def set_member_days(
        self, project_id: int, user_id: int, working_days: list[int] | None, by_user: int
    ) -> bool:
        """Set or clear a member's own weekdays; ``False`` if they are not a member."""
        ...


COLUMNS = text(
    """
    select s.item_type, s.id as status_id, s.name, s.color, s.position, s.is_closed,
           s.is_archived, s.is_deleted,
           (select count(*) from work_item w
             where w.item_type = s.item_type and w.status_id = s.id and not w.is_deleted)
               as cards,
           c.type,
           coalesce(array(
               select cr.role_id from column_role cr
                where cr.project_id = s.project_id and cr.item_type = s.item_type
                  and cr.status_id = s.id
                order by cr.role_id
           ), '{}') as roles,
           coalesce(cret.mode, 'normal') as return_mode
      from taiga_status s
      left join column_type c
             on c.project_id = s.project_id and c.item_type = s.item_type
            and c.status_id = s.id
      left join column_return cret
             on cret.project_id = s.project_id and cret.item_type = s.item_type
            and cret.status_id = s.id
     where s.project_id = :project_id
     order by s.is_deleted, s.position, s.id
    """
)

STATUS_EXISTS = text(
    "select 1 from taiga_status where project_id = :project_id and item_type = :item_type "
    "and id = :status_id"
)

MEMBERS = text(
    """
    select u.id as user_id, coalesce(nullif(u.full_name, ''), u.username) as name,
           coalesce(r.name, '') as role, uc.working_days
      from taiga_membership m
      join taiga_user u on u.id = m.user_id
      left join taiga_role r on r.id = m.role_id
      left join user_calendar uc on uc.project_id = m.project_id and uc.user_id = m.user_id
     where m.project_id = :project_id and u.is_active and not u.is_system
     order by r.position nulls last, lower(coalesce(nullif(u.full_name, ''), u.username))
    """
)


PROJECT_ROLES = text("select id from taiga_role where project_id = :project_id")

IS_MEMBER = text(
    "select 1 from taiga_membership where project_id = :project_id and user_id = :user_id"
)


class DatabaseProjectSettings:
    """Owner settings in the extension's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the engine of the extension's database."""
        self.engine = engine

    async def columns(self, project_id: int) -> list[ItemTypeColumns]:
        """Columns grouped by card type, removed columns last within each type."""
        async with self.engine.connect() as connection:
            rows = await connection.execute(COLUMNS, {"project_id": project_id})
            grouped: dict[str, list[ColumnInfo]] = {}
            for row in rows:
                grouped.setdefault(row.item_type, []).append(
                    ColumnInfo.model_validate(row._mapping)
                )
            table = store.return_rules
            rules = {
                row.item_type: ReturnSettings.model_validate(row._mapping)
                for row in await connection.execute(
                    select(table).where(table.c.project_id == project_id)
                )
            }
            marked: dict[str, list[ReturnPair]] = {}
            pairs = store.return_pair
            for row in await connection.execute(
                select(pairs)
                .where(pairs.c.project_id == project_id)
                .order_by(pairs.c.from_status, pairs.c.to_status)
            ):
                marked.setdefault(row.item_type, []).append(
                    ReturnPair.model_validate(row._mapping)
                )
        return [
            ItemTypeColumns(
                item_type=item_type,
                columns=grouped[item_type],
                returns=rules.get(item_type, ReturnSettings()),
                return_pairs=marked.get(item_type, []),
            )
            for item_type in ITEM_TYPE_ORDER
            if item_type in grouped
        ]

    async def set_column_type(
        self,
        project_id: int,
        item_type: str,
        status_id: int,
        column_type: ColumnType | None,
        by_user: int,
    ) -> bool:
        """Set or clear the type of one column."""
        key = {"project_id": project_id, "item_type": item_type, "status_id": status_id}
        table = store.column_type
        async with self.engine.begin() as connection:
            if (await connection.execute(STATUS_EXISTS, key)).first() is None:
                return False
            if column_type is None:
                await connection.execute(
                    delete(table).where(
                        table.c.project_id == project_id,
                        table.c.item_type == item_type,
                        table.c.status_id == status_id,
                    )
                )
                return True
            statement = pg_insert(table).values(
                **key, type=column_type, updated_at=datetime.now(UTC), updated_by=by_user
            )
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id", "item_type", "status_id"],
                    set_={
                        "type": statement.excluded.type,
                        "updated_at": statement.excluded.updated_at,
                        "updated_by": statement.excluded.updated_by,
                    },
                )
            )
        return True

    async def set_column_roles(
        self, project_id: int, item_type: str, status_id: int, role_ids: list[int], by_user: int
    ) -> bool:
        """Replace the responsible roles of one column; roles of other projects are dropped."""
        key = {"project_id": project_id, "item_type": item_type, "status_id": status_id}
        table = store.column_role
        async with self.engine.begin() as connection:
            if (await connection.execute(STATUS_EXISTS, key)).first() is None:
                return False
            known = {
                row.id
                for row in await connection.execute(PROJECT_ROLES, {"project_id": project_id})
            }
            await connection.execute(
                delete(table).where(
                    table.c.project_id == project_id,
                    table.c.item_type == item_type,
                    table.c.status_id == status_id,
                )
            )
            wanted = sorted(set(role_ids) & known)
            if wanted:
                now = datetime.now(UTC)
                await connection.execute(
                    pg_insert(table).values(
                        [
                            {**key, "role_id": role_id, "updated_at": now, "updated_by": by_user}
                            for role_id in wanted
                        ]
                    )
                )
        return True

    async def set_return_settings(
        self, project_id: int, item_type: str, settings: ReturnSettings, by_user: int
    ) -> None:
        """Insert or replace the return rules of one card type."""
        statement = pg_insert(store.return_rules).values(
            project_id=project_id,
            item_type=item_type,
            **settings.model_dump(),
            updated_at=datetime.now(UTC),
            updated_by=by_user,
        )
        async with self.engine.begin() as connection:
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id", "item_type"],
                    set_={
                        column: statement.excluded[column]
                        for column in (*ReturnSettings.model_fields, "updated_at", "updated_by")
                    },
                )
            )

    async def set_column_return(
        self, project_id: int, item_type: str, status_id: int, mode: ColumnMode, by_user: int
    ) -> bool:
        """Store the return mode of one column; a normal column keeps no row."""
        key = {"project_id": project_id, "item_type": item_type, "status_id": status_id}
        table = store.column_return
        async with self.engine.begin() as connection:
            if (await connection.execute(STATUS_EXISTS, key)).first() is None:
                return False
            await connection.execute(
                delete(table).where(
                    table.c.project_id == project_id,
                    table.c.item_type == item_type,
                    table.c.status_id == status_id,
                )
            )
            if mode != "normal":
                await connection.execute(
                    pg_insert(table).values(
                        **key, mode=mode, updated_at=datetime.now(UTC), updated_by=by_user
                    )
                )
        return True

    async def set_return_pairs(
        self, project_id: int, item_type: str, pairs: list[ReturnPair], by_user: int
    ) -> None:
        """Replace the marked moves of one card type, keeping those between its columns."""
        table = store.return_pair
        params = {"project_id": project_id, "item_type": item_type}
        now = datetime.now(UTC)
        async with self.engine.begin() as connection:
            known = {
                row.id
                for row in await connection.execute(
                    text(
                        "select id from taiga_status "
                        "where project_id = :project_id and item_type = :item_type"
                    ),
                    params,
                )
            }
            await connection.execute(
                delete(table).where(
                    table.c.project_id == project_id, table.c.item_type == item_type
                )
            )
            kept = {
                (pair.from_status, pair.to_status): pair.is_return
                for pair in pairs
                if pair.from_status in known
                and pair.to_status in known
                and pair.from_status != pair.to_status
            }
            if kept:
                await connection.execute(
                    pg_insert(table).values(
                        [
                            {
                                **params,
                                "from_status": source,
                                "to_status": target,
                                "is_return": is_return,
                                "updated_at": now,
                                "updated_by": by_user,
                            }
                            for (source, target), is_return in sorted(kept.items())
                        ]
                    )
                )

    async def cadences(self, project_ids: Iterable[int]) -> dict[int, Cadence]:
        """The stored cadences; projects without one get a switched off cadence."""
        ids = sorted(set(project_ids))
        table = store.reporting_cadence
        found: dict[int, Cadence] = {project_id: Cadence() for project_id in ids}
        if not ids:
            return found
        async with self.engine.connect() as connection:
            for row in await connection.execute(select(table).where(table.c.project_id.in_(ids))):
                found[row.project_id] = Cadence(weeks=row.weeks, start=row.start)
        return found

    async def set_cadence(self, project_id: int, cadence: Cadence, by_user: int) -> None:
        """Insert, replace, or remove the cadence of a project."""
        table = store.reporting_cadence
        async with self.engine.begin() as connection:
            if not cadence.active:
                await connection.execute(delete(table).where(table.c.project_id == project_id))
                return
            statement = pg_insert(table).values(
                project_id=project_id,
                weeks=cadence.weeks,
                start=cadence.start,
                updated_at=datetime.now(UTC),
                updated_by=by_user,
            )
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id"],
                    set_={
                        column: statement.excluded[column]
                        for column in ("weeks", "start", "updated_at", "updated_by")
                    },
                )
            )

    async def calendar(self, project_id: int) -> CalendarSettings:
        """The stored calendar, or the default Monday to Friday in UTC."""
        table = store.project_calendar
        async with self.engine.connect() as connection:
            row = (
                await connection.execute(select(table).where(table.c.project_id == project_id))
            ).first()
            members = [
                MemberCalendar.model_validate(member._mapping)
                for member in await connection.execute(MEMBERS, {"project_id": project_id})
            ]
        return CalendarSettings(
            timezone=row.timezone if row else DEFAULT_TIMEZONE,
            working_days=list(row.working_days) if row else list(DEFAULT_WORKING_DAYS),
            members=members,
        )

    async def set_calendar(
        self, project_id: int, timezone: str, working_days: list[int], by_user: int
    ) -> None:
        """Insert or replace the project calendar."""
        statement = pg_insert(store.project_calendar).values(
            project_id=project_id,
            timezone=timezone,
            working_days=normalize_days(working_days),
            updated_at=datetime.now(UTC),
            updated_by=by_user,
        )
        async with self.engine.begin() as connection:
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id"],
                    set_={
                        column: statement.excluded[column]
                        for column in ("timezone", "working_days", "updated_at", "updated_by")
                    },
                )
            )

    async def set_member_days(
        self, project_id: int, user_id: int, working_days: list[int] | None, by_user: int
    ) -> bool:
        """Set a member's own weekdays, or go back to the project calendar with ``None``."""
        table = store.user_calendar
        key = {"project_id": project_id, "user_id": user_id}
        async with self.engine.begin() as connection:
            if (await connection.execute(IS_MEMBER, key)).first() is None:
                return False
            if working_days is None:
                await connection.execute(
                    delete(table).where(
                        table.c.project_id == project_id, table.c.user_id == user_id
                    )
                )
                return True
            statement = pg_insert(table).values(
                **key,
                working_days=normalize_days(working_days),
                updated_at=datetime.now(UTC),
                updated_by=by_user,
            )
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id", "user_id"],
                    set_={
                        column: statement.excluded[column]
                        for column in ("working_days", "updated_at", "updated_by")
                    },
                )
            )
        return True
