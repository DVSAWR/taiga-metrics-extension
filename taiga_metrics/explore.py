"""Project members, card search, and card history over the synced data."""

from __future__ import annotations

import re
from collections import Counter
from collections.abc import Mapping
from datetime import date, datetime
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics.filters import NONE, CardFacts, Category, apply, facet_counts, status_value

if TYPE_CHECKING:
    from collections import Counter
    from collections.abc import Mapping

    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

    from taiga_metrics.filters import Selection

REF_PATTERN = re.compile(r"^#?(\d+)$")


class Member(BaseModel):
    """A member of a project with their role there."""

    user_id: int
    username: str
    full_name: str
    role: str
    is_owner: bool
    is_admin: bool
    is_active: bool


class Person(BaseModel):
    """A user as shown next to a card; ``username`` opens their Taiga profile."""

    id: int
    name: str
    username: str | None = None


class CardRow(BaseModel):
    """A card with its current column and assignees."""

    item_type: str
    item_id: int
    ref: int | None
    subject: str
    status_id: int | None = None
    status: str | None
    is_deleted: bool
    created_at: datetime | None
    assignees: list[Person]


class CardEvent(BaseModel):
    """One event in a card's history: a column change or an assignee change.

    ``user`` is who made it, when Taiga knows the user.
    """

    history_id: str
    happened_at: datetime
    user_name: str
    kind: str
    from_status: str | None
    to_status: str | None
    assignees: list[Person] | None
    user: Person | None = None


class FilterValue(BaseModel):
    """One selectable value with the number of cards carrying it."""

    value: str
    label: str
    count: int
    color: str | None = None


class FilterCategory(BaseModel):
    """One category of the filter panel."""

    key: Category
    title: str
    values: list[FilterValue]


class FilterPanel(BaseModel):
    """Everything the filter panel shows."""

    categories: list[FilterCategory]
    total: int
    matching: int


CardKey = tuple[str, int]


class Sprint(BaseModel):
    """A sprint of a project: its name and planned dates."""

    id: int
    name: str
    start: date | None
    finish: date | None
    closed: bool


class SwimlaneRef(BaseModel):
    """A swimlane of the board with the work in progress limit of each status in it."""

    id: int
    name: str
    wip: dict[int, int] = {}


class Swimlanes(BaseModel):
    """The swimlanes of a project and the swimlane each card of a type is in now.

    Only user stories have swimlanes in Taiga; a task is in the one of its user story.
    ``cards`` maps a card id to its swimlane, ``None`` for cards in no swimlane.
    """

    lanes: list[SwimlaneRef]
    cards: dict[int, int | None]


class ProjectRef(BaseModel):
    """A synced project, by id and name."""

    id: int
    name: str


class RoleRef(BaseModel):
    """A role of a project."""

    id: int
    name: str


class ProjectData(Protocol):
    """Read access to one project's members and cards."""

    async def project(self, slug: str) -> ProjectRef | None:
        """The synced project with this slug."""
        ...

    async def roles(self, slug: str) -> list[RoleRef] | None:
        """Roles of the project in Taiga's order, or ``None`` if the project is unknown."""
        ...

    async def members(self, slug: str) -> list[Member] | None:
        """Members of the project, or ``None`` if the project is unknown."""
        ...

    async def search(
        self,
        slug: str,
        query: str,
        item_type: str | None,
        limit: int,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardRow] | None:
        """Cards matching ``query`` and the filters, optionally only of one assignee."""
        ...

    async def filter_panel(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> FilterPanel | None:
        """Filter categories with counters, optionally only over one assignee's cards."""
        ...

    async def matching_keys(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardKey] | None:
        """Cards passing the filters, optionally only of one assignee."""
        ...

    async def card_events(
        self, slug: str, item_type: str, item_id: int, *, assignee: int | None = None
    ) -> list[CardEvent] | None:
        """History of one card, or ``None`` if it is unknown or not the assignee's."""
        ...

    async def sprints(self, slug: str) -> list[Sprint] | None:
        """Sprints of the project, newest first, or ``None`` if the project is unknown."""
        ...

    async def swimlanes(self, slug: str, item_type: str) -> Swimlanes | None:
        """Swimlanes of the project and where each card of the type is now."""
        ...


def parse_query(query: str) -> tuple[int | None, str]:
    """A ``#123`` or ``123`` query searches by reference; anything else by subject."""
    stripped = query.strip()
    match = REF_PATTERN.match(stripped)
    return (int(match.group(1)), "") if match else (None, stripped)


def like_pattern(term: str) -> str:
    """A case-insensitive substring pattern with ``LIKE`` wildcards escaped."""
    escaped = term.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return f"%{escaped}%"


PROJECT_ID = text("select id from taiga_project where slug = :slug")

PROJECT = text("select id, name from taiga_project where slug = :slug")

MEMBERS = text(
    """
    select u.id as user_id, u.username, u.full_name, r.name as role,
           p.owner_id = u.id as is_owner, m.is_admin, u.is_active
      from taiga_membership m
      join taiga_user u on u.id = m.user_id
      join taiga_project p on p.id = m.project_id
      left join taiga_role r on r.id = m.role_id
     where m.project_id = :project_id
     order by r.position nulls last, lower(coalesce(nullif(u.full_name, ''), u.username))
    """
)

CARDS = text(
    """
    with last_assignment as (
        select distinct on (item_type, item_id) item_type, item_id, assignee_ids
          from assignment
         where project_id = :project_id
         order by item_type, item_id, happened_at desc, history_id desc
    )
    select w.item_type, w.id as item_id, w.ref, w.subject, w.status_id, s.name as status,
           w.is_deleted,
           w.created_at, coalesce(a.assignee_ids, '{}') as assignee_ids
      from work_item w
      left join taiga_status s on s.item_type = w.item_type and s.id = w.status_id
      left join last_assignment a on a.item_type = w.item_type and a.item_id = w.id
     where w.project_id = :project_id
       and (cast(:item_type as text) is null or w.item_type = :item_type)
       and (cast(:ref as bigint) is null or w.ref = :ref)
       and (:pattern = '' or w.subject ilike :pattern escape '\\')
       and (not cast(:filtered as boolean) or (w.item_type, w.id) in (
           select * from unnest(cast(:key_types as text[]), cast(:key_ids as integer[]))
       ))
     order by w.is_deleted, w.ref desc nulls last
     limit :limit
    """
)

FACTS = text(
    """
    with last_assignment as (
        select distinct on (item_type, item_id) item_type, item_id, assignee_ids
          from assignment
         where project_id = :project_id
         order by item_type, item_id, happened_at desc, history_id desc
    ),
    ever_assigned as (
        select a.item_type, a.item_id, array_agg(distinct person) as people
          from assignment a, unnest(a.assignee_ids) as person
         where a.project_id = :project_id
         group by a.item_type, a.item_id
    )
    select w.item_type, w.id as item_id, w.owner_id, w.tags, w.epic_ids, w.is_deleted,
           w.status_id,
           case when w.item_type = 'task'
                then (select s.swimlane_id from work_item s
                       where s.item_type = 'userstory' and s.id = w.user_story_id)
                else w.swimlane_id
           end as swimlane_id,
           coalesce(a.assignee_ids, '{}') as assignee_ids,
           coalesce(e.people, '{}') as ever_assigned_ids,
           coalesce(
               (select array_agg(distinct m.role_id)
                  from taiga_membership m
                 where m.project_id = w.project_id and m.user_id = any(e.people)),
               '{}'
           ) as role_ids,
           (select m.role_id from taiga_membership m
             where m.project_id = w.project_id and m.user_id = w.owner_id) as owner_role
      from work_item w
      left join last_assignment a on a.item_type = w.item_type and a.item_id = w.id
      left join ever_assigned e on e.item_type = w.item_type and e.item_id = w.id
     where w.project_id = :project_id
       and (cast(:item_type as text) is null or w.item_type = :item_type)
    """
)

MEMBER_IDS = text("select user_id from taiga_membership where project_id = :project_id")

ROLES = text(
    "select id, name from taiga_role where project_id = :project_id order by position, id"
)

TAG_COLORS = text("select tag_colors from taiga_project where id = :project_id")

STATUSES = text(
    """
    select item_type, id, name, color from taiga_status
     where project_id = :project_id
       and (cast(:item_type as text) is null or item_type = :item_type)
     order by case item_type
                  when 'userstory' then 0 when 'task' then 1 when 'issue' then 2 else 3
              end,
              is_deleted, position, id
    """
)

TYPE_NAMES: dict[str, str] = {
    "userstory": "User stories",
    "task": "Tasks",
    "issue": "Issues",
    "epic": "Epics",
}

EPICS = text(
    "select id, ref, subject from work_item where project_id = :project_id "
    "and item_type = 'epic' and not is_deleted order by ref"
)

SWIMLANES = text(
    "select id, name from taiga_swimlane where project_id = :project_id order by position, id"
)

SWIMLANE_LIMITS = text(
    """
    select l.swimlane_id, l.status_id, l.wip_limit
      from taiga_swimlane_status l
      join taiga_swimlane s on s.id = l.swimlane_id
     where s.project_id = :project_id and l.wip_limit is not null
    """
)

SWIMLANE_TYPES = frozenset({"userstory", "task"})

SPRINTS = text(
    "select id, name, estimated_start as start, estimated_finish as finish, closed "
    "from taiga_milestone where project_id = :project_id "
    "order by estimated_start desc nulls last, id desc"
)

CARD_EXISTS = text(
    "select 1 from work_item where project_id = :project_id and item_type = :item_type "
    "and id = :item_id"
)

CARD_EVENTS = text(
    """
    select history_id, happened_at, user_name, user_id, kind, from_status_name as from_status,
           to_status_name as to_status, null::integer[] as assignee_ids,
           case kind when 'create' then 0 when 'delete' then 2 else 1 end as position
      from transition
     where item_type = :item_type and item_id = :item_id
    union all
    select a.history_id, a.happened_at, a.user_name, a.user_id, 'assign', null, null,
           a.assignee_ids, 1
      from assignment a
     where a.item_type = :item_type and a.item_id = :item_id
       and not (
           cardinality(a.assignee_ids) = 0
           and exists (
               select 1 from transition t
                where t.history_id = a.history_id and t.kind = 'create'
           )
       )
     order by happened_at, history_id, position
    """
)

USER_NAMES = text(
    "select id, coalesce(nullif(full_name, ''), username) as name, username from taiga_user "
    "where id = any(:ids)"
)


EPICLESS_TYPES = frozenset({"issue", "epic"})

CATEGORY_TITLES: dict[Category, str] = {
    "status": "Status",
    "swimlane": "Swimlane",
    "assigned": "Assigned to",
    "role": "Assigned to role",
    "created_by": "Created by",
    "created_by_role": "Created by role",
    "epic": "Epic",
    "tag": "Tags",
}

NONE_LABELS: dict[Category, str] = {
    "status": "No status",
    "swimlane": "Unclassified user stories",
    "assigned": "Unassigned",
    "role": "No role",
    "created_by": "Unknown",
    "created_by_role": "No role",
    "epic": "Not in an epic",
    "tag": "No tags",
}


def fact_from_row(row: Mapping[Any, Any]) -> CardFacts:
    """Card facts from one ``FACTS`` row."""
    return CardFacts(
        item_type=row["item_type"],
        item_id=row["item_id"],
        assignees=frozenset(row["assignee_ids"] or ()),
        roles=frozenset(row["role_ids"] or ()),
        owner_id=row["owner_id"],
        epics=frozenset(row["epic_ids"] or ()),
        tags=frozenset(row["tags"] or ()),
        is_deleted=row["is_deleted"],
        ever_assigned=frozenset(row["ever_assigned_ids"] or ()),
        status_id=row["status_id"],
        owner_role=row["owner_role"],
        swimlane_id=row["swimlane_id"],
    )


def ordered_values(
    category: Category, labels: Mapping[str, str], counts: Counter[str], selected: set[str]
) -> list[FilterValue]:
    """Values of a category: the ``none`` entry first, then the labelled ones in order.

    Values that no card carries are dropped unless they are part of the selection, so
    the list stays as short as Taiga's.
    """
    shown = [NONE, *labels]
    return [
        FilterValue(
            value=value, label=labels.get(value, NONE_LABELS[category]), count=counts[value]
        )
        for value in shown
        if counts[value] > 0 or value in selected
    ]


class StoredProjectData:
    """Members and cards read from the extension's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the engine of the extension's database."""
        self.engine = engine

    async def members(self, slug: str) -> list[Member] | None:
        """Members of the project ordered by role, then name."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            rows = await connection.execute(MEMBERS, {"project_id": project_id})
            return [Member.model_validate(row._mapping) for row in rows]

    async def project(self, slug: str) -> ProjectRef | None:
        """The synced project with this slug."""
        async with self.engine.connect() as connection:
            row = (await connection.execute(PROJECT, {"slug": slug})).first()
        return None if row is None else ProjectRef(id=row.id, name=row.name)

    async def sprints(self, slug: str) -> list[Sprint] | None:
        """Sprints of the project, newest first."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            rows = await connection.execute(SPRINTS, {"project_id": project_id})
            return [Sprint.model_validate(row._mapping) for row in rows]

    async def swimlanes(self, slug: str, item_type: str) -> Swimlanes | None:
        """Swimlanes with their limits, and the swimlane of every live card of the type."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            if item_type not in SWIMLANE_TYPES:
                return Swimlanes(lanes=[], cards={})
            params = {"project_id": project_id}
            lanes = [
                SwimlaneRef(id=row.id, name=row.name)
                for row in await connection.execute(SWIMLANES, params)
            ]
            limits = list(await connection.execute(SWIMLANE_LIMITS, params))
            facts = await self.facts(connection, project_id, item_type)
        by_id = {lane.id: lane for lane in lanes}
        for row in limits:
            lane = by_id.get(row.swimlane_id)
            if lane is not None:
                lane.wip[row.status_id] = row.wip_limit
        return Swimlanes(
            lanes=lanes,
            cards={card.item_id: card.swimlane_id for card in facts if not card.is_deleted},
        )

    async def roles(self, slug: str) -> list[RoleRef] | None:
        """Roles of the project in Taiga's order."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            rows = await connection.execute(ROLES, {"project_id": project_id})
            return [RoleRef(id=row.id, name=row.name) for row in rows]

    async def search(
        self,
        slug: str,
        query: str,
        item_type: str | None,
        limit: int,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardRow] | None:
        """Cards whose reference equals the query or whose subject contains it."""
        ref, term = parse_query(query)
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            keys = None
            if not selection.is_empty or assignee is not None:
                facts = await self.facts(connection, project_id, item_type, assignee=assignee)
                keys = [(card.item_type, card.item_id) for card in apply(facts, selection)]
            rows = [
                dict(row._mapping)
                for row in await connection.execute(
                    CARDS,
                    {
                        "project_id": project_id,
                        "item_type": item_type,
                        "ref": ref,
                        "pattern": like_pattern(term) if term else "",
                        "limit": limit,
                        "filtered": keys is not None,
                        "key_types": [key[0] for key in keys or []],
                        "key_ids": [key[1] for key in keys or []],
                    },
                )
            ]
            people = await self.people(
                connection, {user for row in rows for user in row["assignee_ids"]}
            )
        return [
            CardRow(
                **{key: value for key, value in row.items() if key != "assignee_ids"},
                assignees=[
                    people.get(user, Person(id=user, name=f"#{user}"))
                    for user in row["assignee_ids"]
                ],
            )
            for row in rows
        ]

    async def matching_keys(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardKey] | None:
        """Cards passing the filters."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            facts = await self.facts(connection, project_id, item_type, assignee=assignee)
        return [(card.item_type, card.item_id) for card in apply(facts, selection)]

    async def filter_panel(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> FilterPanel | None:
        """Categories, values with counters, and how many cards match overall."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            facts = await self.facts(connection, project_id, item_type, assignee=assignee)
            member_ids = {
                row.user_id
                for row in await connection.execute(MEMBER_IDS, {"project_id": project_id})
            }
            people = (
                member_ids
                | {user for card in facts for user in card.assignees}
                | {card.owner_id for card in facts if card.owner_id is not None}
            )
            names = await self.user_names(connection, people)
            roles = {
                str(row.id): row.name
                for row in await connection.execute(ROLES, {"project_id": project_id})
            }
            epics = {
                str(row.id): f"#{row.ref} {row.subject}"
                for row in await connection.execute(EPICS, {"project_id": project_id})
            }
            colors: dict[str, str] = (
                await connection.execute(TAG_COLORS, {"project_id": project_id})
            ).scalar() or {}
            statuses = list(
                await connection.execute(
                    STATUSES, {"project_id": project_id, "item_type": item_type}
                )
            )
            swimlanes = {
                str(row.id): row.name
                for row in await connection.execute(SWIMLANES, {"project_id": project_id})
            }
        counts = facet_counts(facts, selection)
        by_name = dict(
            sorted(
                ((str(user), name) for user, name in names.items()),
                key=lambda item: item[1].lower(),
            )
        )
        tags = {
            tag: tag for tag in sorted({tag for card in facts for tag in card.tags}, key=str.lower)
        }
        status_labels = {
            status_value(row.item_type, row.id): row.name
            if item_type
            else f"{row.name} ({TYPE_NAMES.get(row.item_type, row.item_type)})"
            for row in statuses
        }
        status_colors = {status_value(row.item_type, row.id): row.color for row in statuses}
        labels: dict[Category, dict[str, str]] = {
            "status": status_labels,
            "swimlane": swimlanes,
            "assigned": by_name,
            "role": roles,
            "created_by": by_name,
            "created_by_role": roles,
            "epic": epics,
            "tag": tags,
        }
        categories = []
        for category, category_labels in labels.items():
            part = selection.categories.get(category)
            selected = set(part.include | part.exclude) if part else set()
            values = ordered_values(category, category_labels, counts[category], selected)
            if category in {"tag", "status"}:
                palette = colors if category == "tag" else status_colors
                values = [
                    value.model_copy(update={"color": palette.get(value.value)})
                    for value in values
                ]
            if category == "status":
                values = [value for value in values if value.value != NONE]
            if category == "tag" and not tags and not selected:
                continue
            if category == "epic" and item_type in EPICLESS_TYPES:
                continue
            if category == "swimlane" and (item_type not in SWIMLANE_TYPES or not swimlanes):
                continue
            if category == "created_by":
                values = [value for value in values if value.value != NONE or value.count > 0]
            categories.append(
                FilterCategory(key=category, title=CATEGORY_TITLES[category], values=values)
            )
        live = [card for card in facts if not card.is_deleted]
        return FilterPanel(
            categories=categories, total=len(live), matching=len(apply(live, selection))
        )

    async def card_events(
        self, slug: str, item_type: str, item_id: int, *, assignee: int | None = None
    ) -> list[CardEvent] | None:
        """Column and assignee changes of one card, oldest first."""
        async with self.engine.connect() as connection:
            project_id = await self.project_id(connection, slug)
            if project_id is None:
                return None
            params = {"project_id": project_id, "item_type": item_type, "item_id": item_id}
            if (await connection.execute(CARD_EXISTS, params)).first() is None:
                return None
            if assignee is not None:
                own = await self.facts(connection, project_id, item_type, assignee=assignee)
                if all(card.item_id != item_id for card in own):
                    return None
            rows = [dict(row._mapping) for row in await connection.execute(CARD_EVENTS, params)]
            people = await self.people(
                connection,
                {user for row in rows for user in row["assignee_ids"] or []}
                | {row["user_id"] for row in rows if row["user_id"] is not None},
            )
        return [
            CardEvent(
                **{
                    key: value
                    for key, value in row.items()
                    if key not in {"assignee_ids", "position", "user_id"}
                },
                user=None if row["user_id"] is None else people.get(row["user_id"]),
                assignees=None
                if row["assignee_ids"] is None
                else [
                    people.get(user, Person(id=user, name=f"#{user}"))
                    for user in row["assignee_ids"]
                ],
            )
            for row in rows
        ]

    @staticmethod
    async def project_id(connection: AsyncConnection, slug: str) -> int | None:
        """Id of the project with this slug."""
        value: int | None = (await connection.execute(PROJECT_ID, {"slug": slug})).scalar()
        return value

    @staticmethod
    async def facts(
        connection: AsyncConnection,
        project_id: int,
        item_type: str | None,
        *,
        assignee: int | None = None,
    ) -> list[CardFacts]:
        """Filterable facts of the cards of a project, optionally only of one assignee."""
        rows = await connection.execute(FACTS, {"project_id": project_id, "item_type": item_type})
        facts = [fact_from_row(row._mapping) for row in rows]
        if assignee is None:
            return facts
        return [card for card in facts if assignee in card.assignees]

    @staticmethod
    async def user_names(connection: AsyncConnection, ids: set[int]) -> dict[int, str]:
        """Display names of the given users."""
        if not ids:
            return {}
        return {
            user: person.name
            for user, person in (await StoredProjectData.people(connection, ids)).items()
        }

    @staticmethod
    async def people(connection: AsyncConnection, ids: set[int]) -> dict[int, Person]:
        """The given users with their display names and usernames."""
        if not ids:
            return {}
        result = await connection.execute(USER_NAMES, {"ids": sorted(ids)})
        return {row.id: Person(id=row.id, name=row.name, username=row.username) for row in result}
