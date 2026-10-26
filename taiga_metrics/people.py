"""One person in one project: who they are and everything they did there; and the
whole team's activity per day.

The profile comes from the synced dictionaries. A former member, who has left the
project but stays in its history, has a profile too, marked as not a member. Activity
is read on request from Taiga's history, read-only, like card comments: every entry
the person made in the project except order-only changes, newest first, each with one
kind. Creating and deleting come first, then a status change, then a change of
assignees; a comment without other changes is a comment, and any other change is an
edit. Days are counted in the project's time zone. Integration bots (Taiga's system
users) are left out of the team's activity.
"""

from __future__ import annotations

from collections import Counter
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Final, Literal, Protocol
from zoneinfo import ZoneInfo

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics.sync.history import ITEM_TYPES

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence

    from sqlalchemy.ext.asyncio import AsyncEngine

    from taiga_metrics.metrics.loader import CardKey

Kind = Literal["create", "move", "assign", "comment", "edit", "delete"]
KINDS: Final[tuple[Kind, ...]] = ("create", "move", "assign", "comment", "edit", "delete")
COMMENT_PREVIEW: Final = 300
OTHER_MODELS: Final = {
    "wiki.wikipage": "Wiki page",
    "milestones.milestone": "Sprint",
    "projects.project": "Project",
}
ASSIGNEE_FIELDS: Final = frozenset({"assigned_users", "assigned_to"})
SILENT_FIELDS: Final = frozenset(
    {"kanban_order", "sprint_order", "backlog_order", "us_order", "taskboard_order"}
)


class PersonProfile(BaseModel):
    """A person as the project knows them.

    ``item_types`` are the card types the person was ever assigned to or moved.
    """

    id: int
    name: str
    username: str
    role: str | None
    role_id: int | None = None
    is_member: bool
    is_owner: bool
    is_admin: bool
    is_active: bool
    item_types: list[str]


class ActivityEvent(BaseModel):
    """One thing the person did.

    ``item_type`` and ``item_id`` name the card; for anything else, such as a wiki page
    or a sprint, ``other`` says what it was. ``day`` is the day in the project's time
    zone. ``fields`` are the changed fields of an
    edit; ``comment`` is the start of a comment's text.
    """

    id: str
    happened_at: datetime
    day: date
    kind: Kind
    item_type: str | None
    item_id: int | None
    ref: int | None = None
    subject: str | None = None
    is_deleted: bool = False
    other: str | None = None
    from_status_id: int | None = None
    to_status_id: int | None = None
    from_status: str | None = None
    to_status: str | None = None
    from_color: str | None = None
    to_color: str | None = None
    fields: list[str] = []
    comment: str | None = None


class ActivityDay(BaseModel):
    """How many things of each kind the person did on one day."""

    day: date
    counts: dict[str, int]


class PersonActivity(BaseModel):
    """The person's activity: the newest events and every day with any.

    ``total`` counts every event of the period; ``events`` holds at most ``limit`` of
    them, so ``truncated`` tells that older ones are left out of the list.
    """

    events: list[ActivityEvent]
    days: list[ActivityDay]
    totals: dict[str, int]
    total: int
    truncated: bool


class TeamEvent(ActivityEvent):
    """One thing someone in the team did, with who did it."""

    user_id: int
    user_name: str


class TeamEvents(BaseModel):
    """The team's newest events of a stretch, at most ``limit`` of ``total``."""

    events: list[TeamEvent]
    total: int
    truncated: bool


class TeamActivityDay(BaseModel):
    """What the team did on one day: per kind, how many things each person did, and
    each person's things per kind.
    """

    day: date
    counts: dict[str, int]
    people: dict[int, int]
    person_kinds: dict[int, dict[str, int]] = {}


class TeamActivity(BaseModel):
    """The team's activity per day, with the names of everyone in it."""

    days: list[TeamActivityDay]
    totals: dict[str, int]
    total: int
    people: dict[int, str]


class PeopleSource(Protocol):
    """Anything that can describe a person and their activity in a project."""

    async def profile(self, project_id: int, user_id: int) -> PersonProfile | None:
        """The person, or ``None`` if they never took part in the project."""
        ...

    async def activity(
        self,
        project_id: int,
        user_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        limit: int,
        cards: Collection[CardKey] | None = None,
    ) -> PersonActivity:
        """What the person did between ``since`` and ``until``, limited to ``cards``."""
        ...

    async def team_activity(
        self,
        project_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        cards: Collection[CardKey] | None = None,
        users: Collection[int] | None = None,
    ) -> TeamActivity:
        """What everyone did per day between ``since`` and ``until``, limited to ``cards``
        and to ``users`` when given.
        """
        ...

    async def team_events(
        self,
        project_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        limit: int,
        kind: str | None = None,
        cards: Collection[CardKey] | None = None,
        users: Collection[int] | None = None,
    ) -> TeamEvents:
        """The newest things everyone did, of ``kind`` when given, by ``users`` when given."""
        ...


PROFILE = text(
    """
    select u.id, coalesce(nullif(u.full_name, ''), u.username) as name, u.username,
           u.is_active, r.name as role, m.role_id as role_id, m.user_id is not null as is_member,
           p.owner_id = u.id as is_owner, coalesce(m.is_admin, false) as is_admin
      from taiga_user u
      join taiga_project p on p.id = :project_id
      left join taiga_membership m on m.project_id = p.id and m.user_id = u.id
      left join taiga_role r on r.id = m.role_id
     where u.id = :user_id and not coalesce(u.is_system, false)
    """
)

ITEM_TYPES_OF = text(
    """
    select distinct item_type from transition
     where project_id = :project_id and user_id = :user_id
    union
    select distinct item_type from assignment
     where project_id = :project_id and :user_id = any(assignee_ids)
    """
)

ACTIVITY = text(
    """
    select h.id, h.key, h.type, h.created_at,
           coalesce(array(select jsonb_object_keys(
               case when jsonb_typeof(h.diff) = 'object' then h.diff else '{}'::jsonb end
           )), '{}') as fields,
           h.diff->'status'->>0 as from_status, h.diff->'status'->>1 as to_status,
           h."values"->'status' as status_names,
           h.snapshot->>'status' as created_status,
           left(coalesce(h.comment, ''), :preview) as comment,
           h.delete_comment_date is not null as comment_deleted
      from history_historyentry h
     where h.project_id = :project_id
       and h."user"->>'pk' = :user_key
       and not coalesce(h.is_hidden, false)
       and (cast(:since as timestamptz) is null or h.created_at >= :since)
       and (cast(:until as timestamptz) is null or h.created_at < :until)
     order by h.created_at desc, h.id desc
    """
)

TEAM_ACTIVITY = text(
    """
    select h.key, h.type, h.created_at,
           coalesce(array(select jsonb_object_keys(
               case when jsonb_typeof(h.diff) = 'object' then h.diff else '{}'::jsonb end
           )), '{}') as fields,
           coalesce(h.comment, '') <> '' as commented,
           h.delete_comment_date is not null as comment_deleted,
           u.id as user_id, coalesce(nullif(u.full_name, ''), u.username) as name
      from history_historyentry h
      join users_user u on u.id = cast(h."user"->>'pk' as integer)
     where h.project_id = :project_id
       and not coalesce(h.is_hidden, false)
       and not u.is_system
       and (cast(:since as timestamptz) is null or h.created_at >= :since)
       and (cast(:until as timestamptz) is null or h.created_at < :until)
    """
)

TEAM_EVENTS = text(
    """
    select h.id, h.key, h.type, h.created_at,
           coalesce(array(select jsonb_object_keys(
               case when jsonb_typeof(h.diff) = 'object' then h.diff else '{}'::jsonb end
           )), '{}') as fields,
           h.diff->'status'->>0 as from_status, h.diff->'status'->>1 as to_status,
           h."values"->'status' as status_names,
           h.snapshot->>'status' as created_status,
           left(coalesce(h.comment, ''), :preview) as comment,
           h.delete_comment_date is not null as comment_deleted,
           u.id as user_id, coalesce(nullif(u.full_name, ''), u.username) as name
      from history_historyentry h
      join users_user u on u.id = cast(h."user"->>'pk' as integer)
     where h.project_id = :project_id
       and not coalesce(h.is_hidden, false)
       and not u.is_system
       and (cast(:since as timestamptz) is null or h.created_at >= :since)
       and (cast(:until as timestamptz) is null or h.created_at < :until)
     order by h.created_at desc, h.id desc
    """
)

CARDS = text(
    """
    select w.item_type, w.id, w.ref, w.subject, w.is_deleted
      from work_item w
     where w.project_id = :project_id and w.id = any(:ids)
    """
)

STATUS_NAMES = text(
    "select item_type, id, name, color from taiga_status where project_id = :project_id"
)


def kind_of(
    entry_type: int, fields: Collection[str], commented: bool, deleted: bool
) -> Kind | None:
    """The kind of one history entry; ``None`` for a deleted comment and nothing else."""
    changed = set(fields) - SILENT_FIELDS
    kinds: list[tuple[bool, Kind]] = [
        (entry_type == 2, "create"),
        (entry_type == 3, "delete"),
        ("status" in changed, "move"),
        (bool(ASSIGNEE_FIELDS & changed), "assign"),
        (commented and not deleted and not changed, "comment"),
        (bool(changed), "edit"),
    ]
    return next((kind for matches, kind in kinds if matches), None)


def as_int(value: Any) -> int | None:
    """An integer from a history value, or ``None``."""
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def parse_key(key: str) -> tuple[str | None, int | None, str | None]:
    """Card type and id of a history key, or what else the entry is about."""
    model, _, raw_id = key.partition(":")
    item_type = ITEM_TYPES.get(model)
    if item_type is not None and raw_id.isdigit():
        return item_type, int(raw_id), None
    return None, None, OTHER_MODELS.get(model, model)


class StoredPeople:
    """Profiles from the extension's database, activity from Taiga's history."""

    def __init__(self, taiga_engine: AsyncEngine, metrics_engine: AsyncEngine) -> None:
        """Keep both engines; Taiga's is read-only."""
        self.taiga_engine = taiga_engine
        self.metrics_engine = metrics_engine

    async def profile(self, project_id: int, user_id: int) -> PersonProfile | None:
        """The person, or ``None`` if they are neither a member nor in the history."""
        params = {"project_id": project_id, "user_id": user_id}
        async with self.metrics_engine.connect() as connection:
            row = (await connection.execute(PROFILE, params)).first()
            if row is None:
                return None
            types = {found.item_type for found in await connection.execute(ITEM_TYPES_OF, params)}
        if not row.is_member and not types:
            return None
        return PersonProfile(
            id=row.id,
            name=row.name,
            username=row.username,
            role=row.role,
            is_member=row.is_member,
            is_owner=bool(row.is_owner),
            is_admin=row.is_admin,
            is_active=bool(row.is_active),
            item_types=[item_type for item_type in ITEM_TYPES.values() if item_type in types],
        )

    async def activity(
        self,
        project_id: int,
        user_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        limit: int,
        cards: Collection[CardKey] | None = None,
    ) -> PersonActivity:
        """What the person did, newest first, with counts per day and per kind."""
        zone = ZoneInfo(timezone)
        allowed = set(cards) if cards is not None else None
        params = {
            "project_id": project_id,
            "user_key": str(user_id),
            "since": since,
            "until": until,
            "preview": COMMENT_PREVIEW,
        }
        async with self.taiga_engine.connect() as connection:
            rows = list(await connection.execute(ACTIVITY, params))
        events: list[ActivityEvent] = []
        per_day: dict[date, Counter[str]] = {}
        totals: Counter[str] = Counter()
        total = 0
        for row in rows:
            target = parse_key(row.key)
            item_type, item_id, _ = target
            if allowed is not None and (item_type, item_id) not in allowed:
                continue
            kind = kind_of(row.type, row.fields, bool(row.comment), row.comment_deleted)
            if kind is None:
                continue
            total += 1
            totals[kind] += 1
            day = row.created_at.astimezone(zone).date()
            per_day.setdefault(day, Counter())[kind] += 1
            if len(events) < limit:
                events.append(self.event(row, day, kind, target))
        await self.describe(project_id, events)
        return PersonActivity(
            events=events,
            days=[
                ActivityDay(day=day, counts=dict(counts))
                for day, counts in sorted(per_day.items())
            ],
            totals={kind: totals[kind] for kind in KINDS if totals[kind]},
            total=total,
            truncated=total > len(events),
        )

    async def team_activity(
        self,
        project_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        cards: Collection[CardKey] | None = None,
        users: Collection[int] | None = None,
    ) -> TeamActivity:
        """Per day, what everyone did, by kind and by person; only ``users`` when given."""
        zone = ZoneInfo(timezone)
        allowed = set(cards) if cards is not None else None
        params = {"project_id": project_id, "since": since, "until": until}
        async with self.taiga_engine.connect() as connection:
            rows = list(await connection.execute(TEAM_ACTIVITY, params))
        kinds: dict[date, Counter[str]] = {}
        people: dict[date, Counter[int]] = {}
        person_kinds: dict[date, dict[int, Counter[str]]] = {}
        names: dict[int, str] = {}
        totals: Counter[str] = Counter()
        who = set(users) if users is not None else None
        for row in rows:
            item_type, item_id, _ = parse_key(row.key)
            if allowed is not None and (item_type, item_id) not in allowed:
                continue
            if who is not None and row.user_id not in who:
                continue
            kind = kind_of(row.type, row.fields, row.commented, row.comment_deleted)
            if kind is None:
                continue
            day = row.created_at.astimezone(zone).date()
            kinds.setdefault(day, Counter())[kind] += 1
            people.setdefault(day, Counter())[row.user_id] += 1
            person_kinds.setdefault(day, {}).setdefault(row.user_id, Counter())[kind] += 1
            names[row.user_id] = row.name
            totals[kind] += 1
        return TeamActivity(
            days=[
                TeamActivityDay(
                    day=day,
                    counts=dict(kinds[day]),
                    people=dict(people[day]),
                    person_kinds={
                        user: dict(counts) for user, counts in person_kinds[day].items()
                    },
                )
                for day in sorted(kinds)
            ],
            totals={kind: totals[kind] for kind in KINDS if totals[kind]},
            total=sum(totals.values()),
            people=names,
        )

    async def team_events(
        self,
        project_id: int,
        *,
        since: datetime | None,
        until: datetime | None,
        timezone: str,
        limit: int,
        kind: str | None = None,
        cards: Collection[CardKey] | None = None,
        users: Collection[int] | None = None,
    ) -> TeamEvents:
        """The newest things everyone did, with who did them, newest first."""
        zone = ZoneInfo(timezone)
        allowed = set(cards) if cards is not None else None
        who = set(users) if users is not None else None
        params = {
            "project_id": project_id,
            "since": since,
            "until": until,
            "preview": COMMENT_PREVIEW,
        }
        async with self.taiga_engine.connect() as connection:
            rows = list(await connection.execute(TEAM_EVENTS, params))
        events: list[TeamEvent] = []
        total = 0
        for row in rows:
            target = parse_key(row.key)
            if allowed is not None and (target[0], target[1]) not in allowed:
                continue
            if who is not None and row.user_id not in who:
                continue
            found = kind_of(row.type, row.fields, bool(row.comment), row.comment_deleted)
            if found is None or (kind is not None and found != kind):
                continue
            total += 1
            if len(events) < limit:
                event = self.event(row, row.created_at.astimezone(zone).date(), found, target)
                events.append(
                    TeamEvent(**event.model_dump(), user_id=row.user_id, user_name=row.name)
                )
        await self.describe(project_id, events)
        return TeamEvents(events=events, total=total, truncated=total > len(events))

    @staticmethod
    def event(
        row: Any, day: date, kind: Kind, target: tuple[str | None, int | None, str | None]
    ) -> ActivityEvent:
        """One event from its history row, before card and status names are added.

        ``target`` is the parsed history key: card type, card id, or what else it is.
        """
        item_type, item_id, other = target
        names: Mapping[str, str] = row.status_names if isinstance(row.status_names, dict) else {}
        from_status = as_int(row.from_status) if kind == "move" else None
        to_status = as_int(row.to_status if kind == "move" else row.created_status)
        if kind not in ("move", "create"):
            to_status = None
        return ActivityEvent(
            id=str(row.id),
            happened_at=row.created_at,
            day=day,
            kind=kind,
            item_type=item_type,
            item_id=item_id,
            other=other,
            from_status_id=from_status,
            to_status_id=to_status,
            from_status=names.get(str(from_status)) if from_status is not None else None,
            to_status=names.get(str(to_status)) if to_status is not None else None,
            fields=sorted(set(row.fields) - SILENT_FIELDS) if kind == "edit" else [],
            comment=row.comment or None if kind == "comment" else None,
        )

    async def describe(self, project_id: int, events: Sequence[ActivityEvent]) -> None:
        """Add card numbers, subjects, and missing status names to the events."""
        ids = sorted({event.item_id for event in events if event.item_id is not None})
        if not events:
            return
        async with self.metrics_engine.connect() as connection:
            cards = {
                (row.item_type, row.id): row
                for row in await connection.execute(CARDS, {"project_id": project_id, "ids": ids})
            }
            statuses = {
                (row.item_type, row.id): row
                for row in await connection.execute(STATUS_NAMES, {"project_id": project_id})
            }
        for event in events:
            if event.item_type is None:
                continue
            card = cards.get((event.item_type, event.item_id or -1))
            if card is not None:
                event.ref = card.ref
                event.subject = card.subject
                event.is_deleted = bool(card.is_deleted)
            if event.from_status is None and event.from_status_id is not None:
                status = statuses.get((event.item_type, event.from_status_id))
                event.from_status = status.name if status else None
            if event.to_status is None and event.to_status_id is not None:
                status = statuses.get((event.item_type, event.to_status_id))
                event.to_status = status.name if status else None
            if event.from_status_id is not None:
                status = statuses.get((event.item_type, event.from_status_id))
                event.from_color = status.color if status else None
            if event.to_status_id is not None:
                status = statuses.get((event.item_type, event.to_status_id))
                event.to_color = status.color if status else None
