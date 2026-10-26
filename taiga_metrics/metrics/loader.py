"""Loading what the flow engine needs from the extension's database."""

from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import UTC, datetime, time, timedelta
from typing import TYPE_CHECKING, Any, Protocol

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics.directions import DirectionRef, direction_flow
from taiga_metrics.explore import Person
from taiga_metrics.filters import AssignmentFilter
from taiga_metrics.metrics.calendar import WorkCalendar
from taiga_metrics.metrics.engine import (
    IN_PROGRESS_TYPES,
    Calendars,
    Card,
    CardReport,
    Column,
    FlowOptions,
    FlowReport,
    Stay,
    StayLevel,
    Step,
    card_report,
    compute_flow,
    finish_samples,
    finish_time,
    finished_by,
    first_work,
    intervals_of,
    stays_of,
    usual_stays,
    with_levels,
)
from taiga_metrics.metrics.periods import (
    OUTSIDE,
    Span,
    days_left,
    group_of,
    span_of,
    spans_for,
    stats_of,
)
from taiga_metrics.metrics.returns import ReturnRules
from taiga_metrics.metrics.share import PersonShare, person_quality, person_share
from taiga_metrics.project_settings import (
    DEFAULT_TIMEZONE,
    DEFAULT_WORKING_DAYS,
    ReturnSettings,
)

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence
    from datetime import date

    from sqlalchemy.ext.asyncio import AsyncConnection, AsyncEngine

    from taiga_metrics.directions import DirectionFlow
    from taiga_metrics.explore import Sprint
    from taiga_metrics.metrics.periods import PeriodKind
    from taiga_metrics.project_settings import ColumnType

CardKey = tuple[str, int]


class FlowResponse(BaseModel):
    """The flow report with display names and usernames of the people it mentions.

    Durations follow the project and member calendars: only working days count.
    ``column_roles`` are the roles responsible for each column, ``roles`` their names.
    """

    report: FlowReport
    people: dict[int, str]
    usernames: dict[int, str] = {}
    column_roles: dict[int, list[int]] = {}
    roles: dict[int, str] = {}
    period_start: datetime | None
    period_end: datetime | None = None
    generated_at: datetime
    timezone: str
    working_weekdays: list[int] = []


class PersonSummary(BaseModel):
    """One person's key numbers over a period: the time they were assigned."""

    user_id: int
    name: str
    username: str | None
    role_id: int | None
    in_progress: int
    stuck: int
    finished: int
    lead_p50: float | None
    cycle_p50: float | None
    passes: int
    clean_passes: int
    returns: int


class Period(BaseModel):
    """The reporting period as moments; either end open when ``None``.

    ``working`` counts only working days in durations; off, every day counts.
    """

    since: datetime | None = None
    until: datetime | None = None
    working: bool = True


class UsualStay(BaseModel):
    """How long past stays in one status took: percentiles and how many there were."""

    stays: int
    p5: float | None
    p15: float | None
    p50: float | None
    p85: float | None
    p95: float | None


class TransitionRow(BaseModel):
    """One transition with its card and who was assigned when it happened.

    ``assignees`` are the people assigned right before a move, or at creation;
    ``user`` is who made it. A move or a deletion also tells how long the card had
    been in the status it left and how that compares with the status's past stays.
    """

    history_id: str
    item_type: str
    item_id: int
    ref: int | None
    subject: str
    is_deleted: bool
    kind: str
    happened_at: datetime
    user_name: str
    from_status: str | None
    to_status: str | None
    from_status_id: int | None = None
    to_status_id: int | None = None
    from_color: str | None = None
    to_color: str | None = None
    assignees: list[Person] = []
    user: Person | None = None
    days_in_status: float | None = None
    level: StayLevel | None = None
    usual: UsualStay | None = None


class CardFlow(BaseModel):
    """The flow of one card with the columns and people it mentions."""

    item_type: str
    item_id: int
    ref: int | None
    subject: str
    status_id: int | None
    created_at: datetime | None
    is_deleted: bool
    report: CardReport
    columns: list[ColumnRef]
    people: dict[int, str]
    usernames: dict[int, str] = {}


class ColumnRef(BaseModel):
    """A column as the card page shows it."""

    status_id: int
    name: str
    color: str
    type: str | None
    is_deleted: bool


class PeriodRef(BaseModel):
    """One column of the period matrix; ``current`` while it is still going."""

    key: str
    label: str
    start: datetime
    end: datetime
    current: bool = False
    days_left: int | None = None


class CellStats(BaseModel):
    """The stays in one status that ended in one period."""

    period: str
    status_id: int
    n: int
    p25: float
    p50: float
    p75: float
    p90: float
    max: float
    mean: float
    sum: float


class SpreadStats(BaseModel):
    """How many, the spread, the longest, the mean and the total of some durations.

    ``slow`` counts the values at or above ``p75``, ``fast`` those at or below ``p25``:
    with ties and nearest-rank percentiles either can be more than a quarter.
    """

    n: int
    p25: float
    p50: float
    p75: float
    p90: float
    max: float
    mean: float
    sum: float
    slow: int = 0
    fast: int = 0


class GroupCell(BaseModel):
    """A row group in one period: each card's time in the group's statuses added up.

    ``stats.n`` counts cards; ``stays`` how many stays they had there.
    """

    period: str
    group: str
    stays: int
    stats: SpreadStats


class TotalCell(BaseModel):
    """The cards that finished in one period: lead and cycle time, waiting and work."""

    period: str
    cards: int
    lead: SpreadStats | None
    cycle: SpreadStats | None
    waiting_days: float
    work_days: float


class OldestInWork(BaseModel):
    """The card that has been in work the longest, counted from its first Work status."""

    item_id: int
    ref: int | None
    subject: str
    days: float


class StatusNow(BaseModel):
    """Cards standing in a status right now and how long the oldest has waited."""

    status_id: int
    cards: int
    oldest_days: float


class PeriodStatusTimes(BaseModel):
    """Time in each status, period by period, oldest period first.

    ``outside`` tells whether some stays ended outside every period; for sprints they
    make a column of their own under the ``outside`` key, never compared.
    """

    kind: str
    periods: list[PeriodRef]
    outside: bool
    columns: list[ColumnRef]
    cells: list[CellStats]
    now: list[StatusNow]
    groups: list[GroupCell] = []
    totals: list[TotalCell] = []
    in_work_now: int = 0
    oldest_in_work: OldestInWork | None = None


class StayRow(BaseModel):
    """One stay behind a cell, with who was assigned when it ended and who moved on."""

    item_id: int
    ref: int | None
    subject: str
    is_deleted: bool
    start: datetime
    end: datetime
    days: float
    assignees: list[int]
    exited_by: int | None


class PeriodStays(BaseModel):
    """The stays of one cell, longest first, with the names and roles of their people."""

    rows: list[StayRow]
    people: dict[int, str]
    usernames: dict[int, str] = {}
    roles: dict[int, str] = {}
    role_of: dict[int, int | None] = {}


class FinishedRow(BaseModel):
    """A card that finished in a period, with its lead and cycle time."""

    item_id: int
    ref: int | None
    subject: str
    is_deleted: bool
    finished_at: datetime
    lead_days: float | None
    cycle_days: float | None
    assignees: list[int]
    finished_by: int | None


class PeriodFinished(BaseModel):
    """The cards finished in one period, with the names of their people."""

    rows: list[FinishedRow]
    people: dict[int, str]
    usernames: dict[int, str] = {}


class TransitionPage(BaseModel):
    """A page of the transition log, newest first."""

    rows: list[TransitionRow]
    has_more: bool


class FlowData(Protocol):
    """Anything that can compute flow metrics of a project."""

    async def period(
        self, project_id: int, date_from: date | None, date_to: date | None
    ) -> Period:
        """The days ``date_from`` to ``date_to``, both included, in the project's zone."""
        ...

    async def flow(
        self,
        project_id: int,
        item_type: str,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        people: AssignmentFilter | None = None,
        column: int | None = None,
    ) -> FlowResponse:
        """Flow metrics of one card type, optionally of some cards and people only.

        ``column`` also lists the cards standing in that column now.
        """
        ...

    async def transitions(
        self,
        project_id: int,
        item_type: str | None,
        *,
        period: Period,
        keys: Collection[CardKey] | None = None,
        people: AssignmentFilter | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> TransitionPage:
        """Transitions in the period, newest first, of the given cards and people."""
        ...

    async def card(
        self, project_id: int, item_type: str, item_id: int, *, working: bool = True
    ) -> CardFlow | None:
        """The flow of one card, or ``None`` if the project has no such card."""
        ...

    async def person_share(
        self,
        project_id: int,
        item_type: str,
        user_id: int,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        every: bool = False,
    ) -> PersonShare:
        """The person's part of the time in every column of the card type."""
        ...

    async def directions(self, project_id: int) -> list[DirectionRef]:
        """Roles answering for at least one column, in Taiga's role order."""
        ...

    async def direction(
        self,
        project_id: int,
        item_type: str,
        *,
        statuses: Collection[int],
        members: Collection[int],
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> DirectionFlow:
        """The direction's columns of one card type over the period."""
        ...

    async def directions_flow(
        self,
        project_id: int,
        item_type: str,
        groups: Sequence[tuple[Collection[int], Collection[int]]],
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> list[DirectionFlow]:
        """Several directions at once, given as their columns and members."""
        ...

    async def people_summary(
        self,
        project_id: int,
        item_type: str,
        users: Collection[int],
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> list[PersonSummary]:
        """The key numbers of each person, the time they were assigned, alphabetically."""
        ...

    async def member_ids(self, project_id: int) -> list[int]:
        """The project's members, integration bots left out."""
        ...

    async def period_status_times(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStatusTimes:
        """Time in each status over the stays that ended in each period."""
        ...

    async def period_stays(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        key: str,
        status_id: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStays:
        """The stays behind one cell of the period matrix."""
        ...

    async def period_finished(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        key: str,
        item_ids: Collection[int] | None = None,
    ) -> PeriodFinished:
        """The cards that finished in one period of the Total chart."""
        ...


ROLE_NAMES = text("select id, name from taiga_role where project_id = :project_id")


@dataclass(frozen=True)
class PeriodScan:
    """Finished stays placed in their periods, the open ones, and the periods."""

    columns: list[Column]
    spans: list[Span]
    placed: list[tuple[Card, Stay, str]]
    open_stays: list[tuple[Card, Stay]]
    now: datetime
    cards: list[Card]
    calendars: Calendars
    options: FlowOptions


COLUMNS = text(
    """
    select s.id, s.name, s.color, s.position, s.is_deleted, c.type
      from taiga_status s
      left join column_type c
             on c.project_id = s.project_id and c.item_type = s.item_type and c.status_id = s.id
     where s.project_id = :project_id and s.item_type = :item_type
    """
)

CARDS = text(
    "select id, ref, subject, created_at, status_id, is_deleted, owner_id from work_item "
    "where project_id = :project_id and item_type = :item_type"
)

ONE_CARD = text(
    "select id, ref, subject, created_at, status_id, is_deleted from work_item "
    "where project_id = :project_id and item_type = :item_type and id = :item_id"
)

CARD_STEPS = text(
    """
    select happened_at, kind, from_status_id, to_status_id, user_id
      from transition
     where item_type = :item_type and item_id = :item_id
     order by happened_at, history_id
    """
)

CARD_ASSIGNMENTS = text(
    """
    select happened_at, assignee_ids
      from assignment
     where item_type = :item_type and item_id = :item_id
     order by happened_at, history_id
    """
)

STEPS = text(
    """
    select item_id, happened_at, kind, from_status_id, to_status_id, user_id
      from transition
     where project_id = :project_id and item_type = :item_type
     order by item_id, happened_at, history_id
    """
)

ASSIGNMENTS = text(
    """
    select item_id, happened_at, assignee_ids
      from assignment
     where project_id = :project_id and item_type = :item_type
     order by item_id, happened_at, history_id
    """
)

MEMBER_ROLES = text("select user_id, role_id from taiga_membership where project_id = :project_id")

MEMBER_IDS = text(
    "select m.user_id from taiga_membership m join taiga_user u on u.id = m.user_id "
    "where m.project_id = :project_id and not coalesce(u.is_system, false) order by m.user_id"
)

COLUMN_ROLES = text(
    "select status_id, role_id from column_role "
    "where project_id = :project_id and item_type = :item_type order by status_id, role_id"
)

SYSTEM_USERS = text("select id from taiga_user where is_system and id = any(:ids)")

RETURN_RULES = text(
    "select earlier, out_of_done, misclick_minutes, credit from return_rules "
    "where project_id = :project_id and item_type = :item_type"
)

RETURN_PAIRS = text(
    "select from_status, to_status, is_return from return_pair "
    "where project_id = :project_id and item_type = :item_type"
)

COLUMN_MODES = text(
    "select status_id, mode from column_return "
    "where project_id = :project_id and item_type = :item_type"
)

WIP_LIMITS = text(
    "select id, wip_limit from taiga_status "
    "where project_id = :project_id and item_type = :item_type"
)

DIRECTIONS = text(
    """
    select r.id as role_id, r.name, cr.item_type, cr.status_id,
           array(select m.user_id from taiga_membership m
                  where m.project_id = r.project_id and m.role_id = r.id
                  order by m.user_id) as members
      from column_role cr
      join taiga_role r on r.id = cr.role_id and r.project_id = cr.project_id
     where cr.project_id = :project_id
     order by r.position, r.id, cr.item_type, cr.status_id
    """
)

TRANSITIONS = text(
    """
    select t.history_id, t.item_type, t.item_id, w.ref, coalesce(w.subject, '') as subject,
           coalesce(w.is_deleted, false) as is_deleted, t.kind, t.happened_at, t.user_name,
           t.user_id,
           t.from_status_name as from_status, t.to_status_name as to_status,
           t.from_status_id, t.to_status_id, fs.color as from_color, ts.color as to_color,
           coalesce(before.assignee_ids, '{}') as before_ids,
           coalesce(after.assignee_ids, '{}') as after_ids
      from transition t
      left join work_item w on w.item_type = t.item_type and w.id = t.item_id
      left join taiga_status fs on fs.item_type = t.item_type and fs.id = t.from_status_id
      left join taiga_status ts on ts.item_type = t.item_type and ts.id = t.to_status_id
      left join lateral (
          select a.assignee_ids from assignment a
           where a.item_type = t.item_type and a.item_id = t.item_id
             and (a.happened_at < t.happened_at
                  or (t.kind = 'create' and a.happened_at = t.happened_at))
           order by a.happened_at desc, a.history_id desc
           limit 1
      ) before on true
      left join lateral (
          select a.assignee_ids from assignment a
           where a.item_type = t.item_type and a.item_id = t.item_id
             and a.happened_at <= t.happened_at
           order by a.happened_at desc, a.history_id desc
           limit 1
      ) after on true
     where t.project_id = :project_id
       and (cast(:item_type as text) is null or t.item_type = :item_type)
       and (cast(:since as timestamptz) is null or t.happened_at >= :since)
       and (cast(:until as timestamptz) is null or t.happened_at < :until)
       and (not cast(:filtered as boolean) or (t.item_type, t.item_id) in (
           select * from unnest(cast(:key_types as text[]), cast(:key_ids as integer[]))
       ))
     order by t.happened_at desc, t.history_id desc
     limit :limit offset :offset
    """
)

LAST_ACTIVITY = text(
    """
    select item_id, max(happened_at) as last_activity from (
        select item_id, happened_at from transition
         where project_id = :project_id and item_type = :item_type
        union all
        select item_id, happened_at from assignment
         where project_id = :project_id and item_type = :item_type
    ) events group by item_id
    """
)

PROJECT_CALENDAR = text(
    "select timezone, working_days from project_calendar where project_id = :project_id"
)

MEMBER_CALENDARS = text(
    "select user_id, working_days from user_calendar where project_id = :project_id"
)

USER_NAMES = text(
    "select id, coalesce(nullif(full_name, ''), username) as name, username from taiga_user "
    "where id = any(:ids)"
)


def current_assignees(assignments: Sequence[tuple[datetime, frozenset[int]]]) -> frozenset[int]:
    """The assignees after the last change."""
    return assignments[-1][1] if assignments else frozenset()


def spread(values: Sequence[float]) -> SpreadStats | None:
    """The stats of some durations as the API returns them, if there are any."""
    found = stats_of(values)
    if found is None:
        return None
    return SpreadStats(
        **vars(found),
        slow=sum(1 for value in values if value >= found.p75),
        fast=sum(1 for value in values if value <= found.p25),
    )


def group_cells(scan: PeriodScan, types: Mapping[int, ColumnType | None]) -> list[GroupCell]:
    """Per period and row group, each card's time in the group's statuses added up."""
    per_card: dict[tuple[str, str, int], float] = defaultdict(float)
    stays: dict[tuple[str, str], int] = defaultdict(int)
    for card, stay, key in scan.placed:
        group = group_of(types.get(stay.status_id))
        per_card[(key, group, card.item_id)] += stay.days
        stays[(key, group)] += 1
    values: dict[tuple[str, str], list[float]] = defaultdict(list)
    for (key, group, _), total in per_card.items():
        values[(key, group)].append(total)
    cells = []
    for (key, group), totals in values.items():
        found = spread(totals)
        if found is not None:
            cells.append(
                GroupCell(period=key, group=group, stays=stays[(key, group)], stats=found)
            )
    return cells


def total_cells(
    scan: PeriodScan, types: Mapping[int, ColumnType | None], period: Period
) -> list[TotalCell]:
    """Per period, lead and cycle time of the cards that finished in it.

    Only real periods count: cards finished outside every sprint are left out. Waiting
    and work add up the finished cards' stays in waiting and in work statuses.
    """
    lead: dict[str, list[float]] = defaultdict(list)
    cycle: dict[str, list[float]] = defaultdict(list)
    waiting: dict[str, float] = defaultdict(float)
    work: dict[str, float] = defaultdict(float)
    cards: dict[str, int] = defaultdict(int)
    for card in scan.cards:
        finished = finish_time(card, types, as_of=period.until)
        if (
            finished is None
            or (period.since is not None and finished < period.since)
            or (period.until is not None and finished >= period.until)
        ):
            continue
        span = span_of(finished, scan.spans)
        if span is None:
            continue
        intervals = intervals_of(card, scan.now)
        lead_sample, cycle_sample = finish_samples(
            card, intervals, finished, types, calendars=scan.calendars, options=scan.options
        )
        cards[span.key] += 1
        if lead_sample:
            lead[span.key].append(lead_sample.days)
        if cycle_sample:
            cycle[span.key].append(cycle_sample.days)
        for stay in stays_of(card, scan.calendars, scan.options):
            if stay.end is None or stay.end > finished:
                continue
            group = group_of(types.get(stay.status_id))
            if group == "waiting":
                waiting[span.key] += stay.days
            elif group == "work":
                work[span.key] += stay.days
    return [
        TotalCell(
            period=key,
            cards=count,
            lead=spread(lead[key]),
            cycle=spread(cycle[key]),
            waiting_days=waiting[key],
            work_days=work[key],
        )
        for key, count in cards.items()
    ]


def finished_rows(
    scan: PeriodScan, types: Mapping[int, ColumnType | None], period: Period, key: str
) -> list[FinishedRow]:
    """The cards that finished in the period ``key``, longest lead time first."""
    rows = []
    for card in scan.cards:
        finished = finish_time(card, types, as_of=period.until)
        if (
            finished is None
            or (period.since is not None and finished < period.since)
            or (period.until is not None and finished >= period.until)
        ):
            continue
        span = span_of(finished, scan.spans)
        if span is None or span.key != key:
            continue
        lead, cycle = finish_samples(
            card,
            intervals_of(card, scan.now),
            finished,
            types,
            calendars=scan.calendars,
            options=scan.options,
        )
        rows.append(
            FinishedRow(
                item_id=card.item_id,
                ref=card.ref,
                subject=card.subject,
                is_deleted=card.is_deleted,
                finished_at=finished,
                lead_days=lead.days if lead else None,
                cycle_days=cycle.days if cycle else None,
                assignees=sorted(card.assigned_before(finished)),
                finished_by=finished_by(card, finished),
            )
        )
    return sorted(rows, key=lambda row: -(row.lead_days or 0))


def oldest_in_work(
    scan: PeriodScan, types: Mapping[int, ColumnType | None]
) -> OldestInWork | None:
    """The card in a work status now that entered work the longest ago."""
    best: OldestInWork | None = None
    for card in scan.cards:
        if card.is_deleted or types.get(card.status_id or -1) not in IN_PROGRESS_TYPES:
            continue
        started = first_work(card, types)
        if started is None:
            continue
        days = (scan.now - started).total_seconds() / 86400
        if best is None or days > best.days:
            best = OldestInWork(
                item_id=card.item_id, ref=card.ref, subject=card.subject, days=days
            )
    return best


def transition_row(
    row: Mapping[str, Any],
    people: Mapping[int, Person],
    stays: Mapping[tuple[int, datetime], Stay],
    usual: Mapping[int, UsualStay],
) -> TransitionRow:
    """A ``TRANSITIONS`` row with its people, the stay it ended, and that status's usual."""
    before: list[int] = row["before_ids"]
    user: int | None = row["user_id"]
    stay = stays.get((row["item_id"], row["happened_at"])) if row["kind"] != "create" else None
    return TransitionRow.model_validate(
        {
            **{
                key: value
                for key, value in row.items()
                if key not in {"before_ids", "after_ids", "user_id"}
            },
            "assignees": [people.get(user, Person(id=user, name=f"#{user}")) for user in before],
            "user": None if user is None else people.get(user),
            "days_in_status": stay.days if stay else None,
            "level": stay.level if stay else None,
            "usual": usual.get(stay.status_id) if stay else None,
        }
    )


class StoredFlowData:
    """Flow metrics over the synced data."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the engine of the extension's database."""
        self.engine = engine

    async def period(
        self, project_id: int, date_from: date | None, date_to: date | None
    ) -> Period:
        """Midnight of ``date_from`` to the midnight after ``date_to``, in the project's zone."""
        if date_from is None and date_to is None:
            return Period()
        async with self.engine.connect() as connection:
            zone = (await self.calendars(connection, project_id)).project.zone
        return Period(
            since=datetime.combine(date_from, time(), zone) if date_from else None,
            until=datetime.combine(date_to + timedelta(days=1), time(), zone) if date_to else None,
        )

    async def flow(
        self,
        project_id: int,
        item_type: str,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        people: AssignmentFilter | None = None,
        column: int | None = None,
    ) -> FlowResponse:
        """Load everything about one card type and compute its flow metrics."""
        async with self.engine.connect() as connection:
            now = datetime.now(UTC)
            report, calendars = await self.report(
                connection,
                project_id,
                item_type,
                now=now,
                period=period,
                item_ids=item_ids,
                people=people,
                column=column,
            )
            mentioned = (
                {
                    user
                    for item in (*report.stuck, *report.current)
                    for user in (*item.assignees, item.created_by)
                    if user is not None
                }
                | {
                    move.person_id
                    for move in (*report.moves_by_assignee, *report.moves_by_mover)
                    if move.person_id is not None
                }
                | {
                    user
                    for move in report.moves
                    for event in move.events
                    for user in (event.user_id, *event.assignees)
                    if user is not None
                }
                | {
                    user
                    for item in report.finishes
                    for user in (item.user_id, *item.assignees)
                    if user is not None
                }
                | {
                    user
                    for item in report.column_cards
                    for user in (item.user_id, *item.assignees)
                    if user is not None
                }
            )
            found = await self.people(connection, mentioned)
            column_roles, roles = await self.column_roles(connection, project_id, item_type)
        return FlowResponse(
            report=report,
            people={user: person.name for user, person in found.items()},
            usernames={user: person.username for user, person in found.items() if person.username},
            column_roles=column_roles,
            roles=roles,
            period_start=period.since,
            period_end=period.until,
            generated_at=now,
            timezone=calendars.project.timezone,
            working_weekdays=sorted(calendars.project.working_days),
        )

    async def report(
        self,
        connection: AsyncConnection,
        project_id: int,
        item_type: str,
        *,
        now: datetime,
        period: Period,
        item_ids: Collection[int] | None = None,
        people: AssignmentFilter | None = None,
        column: int | None = None,
        loaded: tuple[list[Column], list[Card]] | None = None,
    ) -> tuple[FlowReport, Calendars]:
        """The flow report of one card type.

        ``loaded`` are the columns and cards when the caller already has them. What is
        stuck now is judged against every card's whole history, whatever the filters.
        """
        params = {"project_id": project_id, "item_type": item_type}
        columns, cards = loaded or await self.cards(connection, params, item_ids)
        calendars = await self.calendars(connection, project_id)
        roles_of = await self.member_roles(connection, project_id) if people else {}
        rules, misclick = await self.return_options(connection, project_id, item_type)
        everything = (
            cards
            if loaded is None and item_ids is None
            else (await self.cards(connection, params))[1]
        )
        usual = usual_stays(
            everything,
            calendars,
            FlowOptions(now=now, since=None, working_days=period.working, misclick=misclick),
        )
        report = compute_flow(
            cards,
            columns,
            calendars,
            FlowOptions(
                now=now,
                since=period.since,
                until=period.until,
                working_days=period.working,
                people=people,
                roles_of=roles_of,
                column=column,
                usual=usual,
                returns=rules,
                misclick=misclick,
            ),
        )
        return report, calendars

    @staticmethod
    async def cards(
        connection: AsyncConnection,
        params: Mapping[str, Any],
        item_ids: Collection[int] | None = None,
    ) -> tuple[list[Column], list[Card]]:
        """The columns of one card type and its cards with their whole history."""
        columns = [
            Column(row.id, row.name, row.color, row.position, row.type, row.is_deleted)
            for row in await connection.execute(COLUMNS, params)
        ]
        steps: dict[int, list[Step]] = defaultdict(list)
        for row in await connection.execute(STEPS, params):
            steps[row.item_id].append(
                Step(row.happened_at, row.kind, row.from_status_id, row.to_status_id, row.user_id)
            )
        assignments: dict[int, list[tuple[datetime, frozenset[int]]]] = defaultdict(list)
        for row in await connection.execute(ASSIGNMENTS, params):
            assignments[row.item_id].append((row.happened_at, frozenset(row.assignee_ids)))
        activity = {
            row.item_id: row.last_activity
            for row in await connection.execute(LAST_ACTIVITY, params)
        }
        allowed = None if item_ids is None else set(item_ids)
        cards = [
            Card(
                item_id=row.id,
                ref=row.ref,
                subject=row.subject,
                created_at=row.created_at,
                status_id=row.status_id,
                is_deleted=row.is_deleted,
                steps=tuple(steps.get(row.id, ())),
                assignees=current_assignees(assignments.get(row.id, ())),
                last_activity=activity.get(row.id),
                assignments=tuple(assignments.get(row.id, ())),
                owner_id=row.owner_id,
            )
            for row in await connection.execute(CARDS, params)
            if allowed is None or row.id in allowed
        ]
        return columns, cards

    async def transitions(
        self,
        project_id: int,
        item_type: str | None,
        *,
        period: Period,
        keys: Collection[CardKey] | None = None,
        people: AssignmentFilter | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> TransitionPage:
        """Transitions in the period, newest first.

        With people in the filters only moves made while they were assigned, right
        before or right after, are listed; the page is then cut after filtering.
        """
        params = {
            "project_id": project_id,
            "item_type": item_type,
            "since": period.since,
            "until": period.until,
            "filtered": keys is not None,
            "key_types": [key[0] for key in keys or []],
            "key_ids": [key[1] for key in keys or []],
            "limit": None if people else limit + 1,
            "offset": 0 if people else offset,
        }
        async with self.engine.connect() as connection:
            rows = [dict(row._mapping) for row in await connection.execute(TRANSITIONS, params)]
            if people:
                roles_of = await self.member_roles(connection, project_id)
                rows = [
                    row
                    for row in rows
                    if people.takes_event(
                        frozenset(row["before_ids"]), frozenset(row["after_ids"]), roles_of
                    )
                ][offset : offset + limit + 1]
            rows = rows[: limit + 1]
            stays, usual = (
                await self.ended_stays(
                    connection, project_id, item_type, period=period, keys=keys, people=people
                )
                if item_type is not None
                else ({}, {})
            )
            found = await self.people(
                connection,
                {user for row in rows for user in row["before_ids"]}
                | {row["user_id"] for row in rows if row["user_id"] is not None},
            )
        return TransitionPage(
            rows=[transition_row(row, found, stays, usual) for row in rows[:limit]],
            has_more=len(rows) > limit,
        )

    async def ended_stays(
        self,
        connection: AsyncConnection,
        project_id: int,
        item_type: str,
        *,
        period: Period,
        keys: Collection[CardKey] | None,
        people: AssignmentFilter | None,
    ) -> tuple[dict[tuple[int, datetime], Stay], dict[int, UsualStay]]:
        """Every finished stay of the card type by card and end, and each status's usual.

        The comparison uses the same period and filters as the rest of the report.
        """
        item_ids = None if keys is None else [key[1] for key in keys if key[0] == item_type]
        now = datetime.now(UTC)
        loaded = await self.cards(
            connection, {"project_id": project_id, "item_type": item_type}, item_ids
        )
        report, calendars = await self.report(
            connection, project_id, item_type, now=now, period=period, people=people, loaded=loaded
        )
        cards = loaded[1]
        rules, misclick = await self.return_options(connection, project_id, item_type)
        options = FlowOptions(
            now=now, since=None, working_days=period.working, misclick=misclick, returns=rules
        )
        stays = {
            (card.item_id, stay.end): stay
            for card in cards
            for stay in with_levels(stays_of(card, calendars, options), report.stay_times)
            if stay.end is not None
        }
        usual = {
            time.status_id: UsualStay(
                stays=time.stays,
                p5=time.p5,
                p15=time.p15,
                p50=time.p50,
                p85=time.p85,
                p95=time.p95,
            )
            for time in report.stay_times
        }
        return stays, usual

    async def card(
        self, project_id: int, item_type: str, item_id: int, *, working: bool = True
    ) -> CardFlow | None:
        """Load one card with its history and compute where its time went."""
        params = {"project_id": project_id, "item_type": item_type, "item_id": item_id}
        async with self.engine.connect() as connection:
            row = (await connection.execute(ONE_CARD, params)).first()
            if row is None:
                return None
            columns = [
                Column(
                    column.id,
                    column.name,
                    column.color,
                    column.position,
                    column.type,
                    column.is_deleted,
                )
                for column in await connection.execute(COLUMNS, params)
            ]
            steps = tuple(
                Step(
                    step.happened_at,
                    step.kind,
                    step.from_status_id,
                    step.to_status_id,
                    step.user_id,
                )
                for step in await connection.execute(CARD_STEPS, params)
            )
            assignments = tuple(
                (change.happened_at, frozenset(change.assignee_ids))
                for change in await connection.execute(CARD_ASSIGNMENTS, params)
            )
            calendars = await self.calendars(connection, project_id)
            card = Card(
                item_id=row.id,
                ref=row.ref,
                subject=row.subject,
                created_at=row.created_at,
                status_id=row.status_id,
                is_deleted=row.is_deleted,
                steps=steps,
                assignees=current_assignees(assignments),
                assignments=assignments,
            )
            now = datetime.now(UTC)
            rules, misclick = await self.return_options(connection, project_id, item_type)
            report = card_report(
                card,
                columns,
                calendars,
                FlowOptions(
                    now=now, since=None, working_days=working, misclick=misclick, returns=rules
                ),
            )
            usual, _ = await self.report(
                connection, project_id, item_type, now=now, period=Period(working=working)
            )
            report = replace(report, stays=with_levels(report.stays, usual.stay_times))
            found = await self.people(
                connection, {stay.exited_by for stay in report.stays if stay.exited_by is not None}
            )
        used = {stay.status_id for stay in report.stays} | {row.status_id}
        return CardFlow(
            item_type=item_type,
            item_id=row.id,
            ref=row.ref,
            subject=row.subject,
            status_id=row.status_id,
            created_at=row.created_at,
            is_deleted=row.is_deleted,
            report=report,
            columns=[
                ColumnRef(
                    status_id=column.status_id,
                    name=column.name,
                    color=column.color,
                    type=column.type,
                    is_deleted=column.is_deleted,
                )
                for column in sorted(columns, key=lambda c: (c.is_deleted, c.position))
                if not column.is_deleted or column.status_id in used
            ],
            people={user: person.name for user, person in found.items()},
            usernames={user: person.username for user, person in found.items() if person.username},
        )

    async def ended_stays_by_period(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        item_ids: Collection[int] | None,
    ) -> PeriodScan:
        """Each finished stay with the period it ended in, the open stays, and the spans.

        Stays shorter than ``pass_minutes`` only passed through and are left out, as are
        stays that ended outside ``period``.
        """
        params = {"project_id": project_id, "item_type": item_type}
        async with self.engine.connect() as connection:
            columns, cards = await self.cards(connection, params, item_ids)
            calendars = await self.calendars(connection, project_id)
        now = datetime.now(UTC)
        options = FlowOptions(now=now, since=None, working_days=period.working)
        least = timedelta(minutes=pass_minutes)
        stays = [(card, stay) for card in cards for stay in stays_of(card, calendars, options)]
        ended = [
            (card, stay)
            for card, stay in stays
            if stay.end is not None
            and stay.end - stay.start >= least
            and (period.since is None or stay.end >= period.since)
            and (period.until is None or stay.end < period.until)
        ]
        spans = spans_for(
            kind,
            sprints,
            calendars.project.zone,
            first=min((stay.end for _, stay in ended if stay.end), default=None),
            last=now,
            since=period.since,
            until=period.until,
        )
        placed = []
        for card, stay in ended:
            span = span_of(stay.end, spans) if stay.end else None
            placed.append((card, stay, span.key if span else OUTSIDE))
        return PeriodScan(
            columns=columns,
            spans=spans,
            placed=placed,
            open_stays=[(card, stay) for card, stay in stays if stay.end is None],
            now=now,
            cards=cards,
            calendars=calendars,
            options=options,
        )

    async def period_status_times(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStatusTimes:
        """Spread, mean and total of the stays in each status that ended in each period."""
        scan = await self.ended_stays_by_period(
            project_id,
            item_type,
            sprints,
            kind=kind,
            period=period,
            pass_minutes=pass_minutes,
            item_ids=item_ids,
        )
        days: dict[tuple[str, int], list[float]] = defaultdict(list)
        for _, stay, key in scan.placed:
            days[(key, stay.status_id)].append(stay.days)
        waiting: dict[int, list[float]] = defaultdict(list)
        for _, stay in scan.open_stays:
            waiting[stay.status_id].append(stay.days)
        used = {status_id for _, status_id in days} | set(waiting)
        cells = []
        for (key, status_id), values in days.items():
            found = stats_of(values)
            if found is not None:
                cells.append(CellStats(period=key, status_id=status_id, **vars(found)))
        types = {column.status_id: column.type for column in scan.columns}
        return PeriodStatusTimes(
            groups=group_cells(scan, types),
            totals=total_cells(scan, types, period),
            in_work_now=sum(
                1
                for card in scan.cards
                if not card.is_deleted and types.get(card.status_id or -1) in IN_PROGRESS_TYPES
            ),
            oldest_in_work=oldest_in_work(scan, types),
            kind=kind,
            periods=[
                PeriodRef(
                    key=span.key,
                    label=span.label,
                    start=span.start,
                    end=span.end,
                    current=days_left(span, scan.now) is not None,
                    days_left=days_left(span, scan.now),
                )
                for span in scan.spans
            ],
            outside=any(key == OUTSIDE for key, _ in days),
            columns=[
                ColumnRef(
                    status_id=column.status_id,
                    name=column.name,
                    color=column.color,
                    type=column.type,
                    is_deleted=column.is_deleted,
                )
                for column in sorted(scan.columns, key=lambda c: (c.is_deleted, c.position))
                if not column.is_deleted or column.status_id in used
            ],
            cells=cells,
            now=[
                StatusNow(status_id=status_id, cards=len(values), oldest_days=max(values))
                for status_id, values in waiting.items()
            ],
        )

    async def period_stays(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        key: str,
        status_id: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStays:
        """The stays of one cell, longest first, with their people and roles."""
        scan = await self.ended_stays_by_period(
            project_id,
            item_type,
            sprints,
            kind=kind,
            period=period,
            pass_minutes=pass_minutes,
            item_ids=item_ids,
        )
        rows = sorted(
            (
                StayRow(
                    item_id=card.item_id,
                    ref=card.ref,
                    subject=card.subject,
                    is_deleted=card.is_deleted,
                    start=stay.start,
                    end=stay.end,
                    days=stay.days,
                    assignees=sorted(card.assigned_before(stay.end)),
                    exited_by=stay.exited_by,
                )
                for card, stay, placed in scan.placed
                if placed == key and stay.status_id == status_id and stay.end is not None
            ),
            key=lambda row: -row.days,
        )
        ids = {user for row in rows for user in row.assignees} | {
            row.exited_by for row in rows if row.exited_by is not None
        }
        async with self.engine.connect() as connection:
            found = await self.people(connection, ids)
            role_of = await self.member_roles(connection, project_id)
            roles = {
                row.id: row.name
                for row in await connection.execute(ROLE_NAMES, {"project_id": project_id})
            }
        return PeriodStays(
            rows=rows,
            people={user: person.name for user, person in found.items()},
            usernames={user: person.username for user, person in found.items() if person.username},
            roles=roles,
            role_of={user: role_of.get(user) for user in ids},
        )

    async def period_finished(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        key: str,
        item_ids: Collection[int] | None = None,
    ) -> PeriodFinished:
        """The cards that finished in one period, slowest first by lead time."""
        scan = await self.ended_stays_by_period(
            project_id,
            item_type,
            sprints,
            kind=kind,
            period=period,
            pass_minutes=0,
            item_ids=item_ids,
        )
        types = {column.status_id: column.type for column in scan.columns}
        rows = finished_rows(scan, types, period, key)
        ids = {user for row in rows for user in row.assignees} | {
            row.finished_by for row in rows if row.finished_by is not None
        }
        async with self.engine.connect() as connection:
            found = await self.people(connection, ids)
        return PeriodFinished(
            rows=rows,
            people={user: person.name for user, person in found.items()},
            usernames={user: person.username for user, person in found.items() if person.username},
        )

    @staticmethod
    async def return_options(
        connection: AsyncConnection, project_id: int, item_type: str
    ) -> tuple[ReturnRules, timedelta]:
        """The card type's return rules and its misclick threshold, defaults filled in."""
        params = {"project_id": project_id, "item_type": item_type}
        row = (await connection.execute(RETURN_RULES, params)).first()
        modes = {row.status_id: row.mode for row in await connection.execute(COLUMN_MODES, params)}
        pairs = list(await connection.execute(RETURN_PAIRS, params))
        settings = (
            ReturnSettings.model_validate(row._mapping) if row is not None else ReturnSettings()
        )
        rules = ReturnRules(
            earlier=settings.earlier,
            out_of_done=settings.out_of_done,
            credit=settings.credit,
            pauses=frozenset(status for status, mode in modes.items() if mode == "pause"),
            triage=frozenset(status for status, mode in modes.items() if mode == "triage"),
            marked=frozenset((row.from_status, row.to_status) for row in pairs if row.is_return),
            unmarked=frozenset(
                (row.from_status, row.to_status) for row in pairs if not row.is_return
            ),
        )
        return rules, timedelta(minutes=settings.misclick_minutes)

    @staticmethod
    async def column_roles(
        connection: AsyncConnection, project_id: int, item_type: str
    ) -> tuple[dict[int, list[int]], dict[int, str]]:
        """The roles responsible for each column of the card type, and their names."""
        params = {"project_id": project_id, "item_type": item_type}
        by_column: dict[int, list[int]] = defaultdict(list)
        for row in await connection.execute(COLUMN_ROLES, params):
            by_column[row.status_id].append(row.role_id)
        used = {role for roles in by_column.values() for role in roles}
        names = {
            row.id: row.name
            for row in await connection.execute(ROLE_NAMES, params)
            if row.id in used
        }
        return dict(by_column), names

    async def directions(self, project_id: int) -> list[DirectionRef]:
        """Roles answering for at least one column, in Taiga's role order."""
        found: dict[int, DirectionRef] = {}
        async with self.engine.connect() as connection:
            for row in await connection.execute(DIRECTIONS, {"project_id": project_id}):
                ref = found.setdefault(
                    row.role_id,
                    DirectionRef(
                        role_id=row.role_id, name=row.name, columns={}, members=list(row.members)
                    ),
                )
                ref.columns.setdefault(row.item_type, []).append(row.status_id)
        return list(found.values())

    async def direction(
        self,
        project_id: int,
        item_type: str,
        *,
        statuses: Collection[int],
        members: Collection[int],
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> DirectionFlow:
        """The direction's columns of one card type over the period, every card measured.

        Integration bots, Taiga's system users, are left out of the people.
        """
        found = await self.directions_flow(
            project_id, item_type, [(statuses, members)], period=period, item_ids=item_ids
        )
        return found[0]

    async def directions_flow(
        self,
        project_id: int,
        item_type: str,
        groups: Sequence[tuple[Collection[int], Collection[int]]],
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> list[DirectionFlow]:
        """Several directions at once, given as their columns and members, one report shared.

        Integration bots, Taiga's system users, are left out of the people.
        """
        params = {"project_id": project_id, "item_type": item_type}
        now = datetime.now(UTC)
        async with self.engine.connect() as connection:
            loaded = await self.cards(connection, params, item_ids)
            report, calendars = await self.report(
                connection,
                project_id,
                item_type,
                now=now,
                period=period,
                item_ids=item_ids,
                loaded=loaded,
            )
            wip = {row.id: row.wip_limit for row in await connection.execute(WIP_LIMITS, params)}
            rules, misclick = await self.return_options(connection, project_id, item_type)
            options = FlowOptions(
                now=now,
                since=period.since,
                until=period.until,
                working_days=period.working,
                misclick=misclick,
                returns=rules,
            )
            flows = [
                direction_flow(
                    report,
                    loaded[1],
                    calendars,
                    options,
                    columns=loaded[0],
                    statuses=statuses,
                    members=members,
                    wip_limits=wip,
                )
                for statuses, members in groups
            ]
            mentioned = {person.user_id for flow in flows for person in flow.people} | {
                user for flow in flows for card in flow.stuck for user in card.assignees
            }
            bots = {
                row.id
                for row in await connection.execute(SYSTEM_USERS, {"ids": sorted(mentioned)})
            }
            found = await self.people(connection, mentioned - bots)
        names = {user: person.name for user, person in found.items()}
        usernames = {user: person.username for user, person in found.items() if person.username}
        return [
            flow.model_copy(
                update={
                    "people": [person for person in flow.people if person.user_id not in bots],
                    "names": names,
                    "usernames": usernames,
                }
            )
            for flow in flows
        ]

    async def member_ids(self, project_id: int) -> list[int]:
        """The project's members, integration bots left out."""
        async with self.engine.connect() as connection:
            return [
                row.user_id
                for row in await connection.execute(MEMBER_IDS, {"project_id": project_id})
            ]

    async def people_summary(
        self,
        project_id: int,
        item_type: str,
        users: Collection[int],
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
    ) -> list[PersonSummary]:
        """The key numbers of each person, the time they were assigned, alphabetically.

        Every person's report is computed over the same loaded cards.
        """
        params = {"project_id": project_id, "item_type": item_type}
        now = datetime.now(UTC)
        async with self.engine.connect() as connection:
            columns, cards = await self.cards(connection, params, item_ids)
            calendars = await self.calendars(connection, project_id)
            roles_of = await self.member_roles(connection, project_id)
            rules, misclick = await self.return_options(connection, project_id, item_type)
            usual = usual_stays(
                cards,
                calendars,
                FlowOptions(now=now, since=None, working_days=period.working, misclick=misclick),
            )
            found = await self.people(connection, set(users))
        summaries = []
        for user in users:
            options = FlowOptions(
                now=now,
                since=period.since,
                until=period.until,
                working_days=period.working,
                people=AssignmentFilter(people=frozenset({user})),
                roles_of=roles_of,
                usual=usual,
                returns=rules,
                misclick=misclick,
            )
            report = compute_flow(cards, columns, calendars, options)
            _, _, returns = person_quality(cards, columns, options, user)
            person = found.get(user)
            summaries.append(
                PersonSummary(
                    user_id=user,
                    name=person.name if person else f"#{user}",
                    username=person.username if person else None,
                    role_id=roles_of.get(user),
                    in_progress=report.in_progress,
                    stuck=sum(1 for card in report.stuck if card.level),
                    finished=report.finished,
                    lead_p50=report.lead_time.p50,
                    cycle_p50=report.cycle_time.p50,
                    passes=sum(column.passes for column in report.columns),
                    clean_passes=sum(column.clean_passes for column in report.columns),
                    returns=sum(returns.values()),
                )
            )
        return sorted(summaries, key=lambda summary: summary.name.lower())

    async def person_share(
        self,
        project_id: int,
        item_type: str,
        user_id: int,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        every: bool = False,
    ) -> PersonShare:
        """The person's part of the time in every column of the card type."""
        params = {"project_id": project_id, "item_type": item_type}
        async with self.engine.connect() as connection:
            columns, cards = await self.cards(connection, params, item_ids)
            calendars = await self.calendars(connection, project_id)
            column_roles, roles = await self.column_roles(connection, project_id, item_type)
            role_id = (await self.member_roles(connection, project_id)).get(user_id)
            rules, misclick = await self.return_options(connection, project_id, item_type)
        options = FlowOptions(
            now=datetime.now(UTC),
            since=period.since,
            until=period.until,
            working_days=period.working,
            misclick=misclick,
            returns=rules,
        )
        return PersonShare(
            role_id=role_id,
            columns=person_share(
                cards,
                columns,
                calendars,
                options,
                user_id=user_id,
                role_id=role_id,
                column_roles=column_roles,
                every=every,
            ),
            roles=roles,
        )

    @staticmethod
    async def member_roles(connection: AsyncConnection, project_id: int) -> dict[int, int | None]:
        """Each member's role in the project."""
        return {
            row.user_id: row.role_id
            for row in await connection.execute(MEMBER_ROLES, {"project_id": project_id})
        }

    @staticmethod
    async def people(connection: AsyncConnection, ids: set[int]) -> dict[int, Person]:
        """The given users with their display names and usernames."""
        if not ids:
            return {}
        result = await connection.execute(USER_NAMES, {"ids": sorted(ids)})
        return {row.id: Person(id=row.id, name=row.name, username=row.username) for row in result}

    @staticmethod
    async def calendars(connection: AsyncConnection, project_id: int) -> Calendars:
        """The project calendar and members' own days, defaults filled in."""
        params = {"project_id": project_id}
        row = (await connection.execute(PROJECT_CALENDAR, params)).first()
        project = WorkCalendar(
            row.timezone if row else DEFAULT_TIMEZONE,
            frozenset(row.working_days if row else DEFAULT_WORKING_DAYS),
        )
        members = {
            member.user_id: frozenset(member.working_days)
            for member in await connection.execute(MEMBER_CALENDARS, params)
        }
        return Calendars(project, members)
