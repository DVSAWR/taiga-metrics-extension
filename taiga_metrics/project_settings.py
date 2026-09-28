"""What project owners configure: what each column means, and working calendars.

Taiga knows neither: its ``is_closed`` flag is unreliable, and it has no calendar. The
project's managers mark every column as queue, work, rework, done, or cancelled, and set
the project's time zone and working weekdays, optionally different weekdays per member.
"""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final, Literal, Protocol, get_args
from zoneinfo import available_timezones

from pydantic import BaseModel
from sqlalchemy import delete, select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from taiga_metrics import store

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

ColumnType = Literal["queue", "work", "rework", "done", "cancelled"]
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


class ColumnInfo(BaseModel):
    """One column of one card type, with the type the owner gave it."""

    status_id: int
    name: str
    color: str
    position: int
    is_closed: bool
    is_archived: bool
    is_deleted: bool
    cards: int
    type: ColumnType | None


class ItemTypeColumns(BaseModel):
    """All columns of one card type in Taiga's order.

    ``show_removed`` tells whether columns removed from Taiga appear in the reports.
    """

    item_type: str
    columns: list[ColumnInfo]
    show_removed: bool = False


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

    async def set_show_removed(
        self, project_id: int, item_type: str, show_removed: bool, by_user: int
    ) -> None:
        """Show or hide the columns removed from Taiga in the reports of a card type."""
        ...

    async def calendar(self, project_id: int) -> CalendarSettings:
        """The project calendar, defaults filled in."""
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
           c.type
      from taiga_status s
      left join column_type c
             on c.project_id = s.project_id and c.item_type = s.item_type
            and c.status_id = s.id
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


SHOWN_REMOVED = text(
    "select item_type from item_type_display where project_id = :project_id and show_removed"
)

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
            shown = {
                row.item_type
                for row in await connection.execute(SHOWN_REMOVED, {"project_id": project_id})
            }
        return [
            ItemTypeColumns(
                item_type=item_type, columns=grouped[item_type], show_removed=item_type in shown
            )
            for item_type in ITEM_TYPE_ORDER
            if item_type in grouped
        ]

    async def set_show_removed(
        self, project_id: int, item_type: str, show_removed: bool, by_user: int
    ) -> None:
        """Store whether removed columns of a card type appear in the reports."""
        statement = pg_insert(store.item_type_display).values(
            project_id=project_id,
            item_type=item_type,
            show_removed=show_removed,
            updated_at=datetime.now(UTC),
            updated_by=by_user,
        )
        async with self.engine.begin() as connection:
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id", "item_type"],
                    set_={
                        key: statement.excluded[key]
                        for key in ("show_removed", "updated_at", "updated_by")
                    },
                )
            )

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
