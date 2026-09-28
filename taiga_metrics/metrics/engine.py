"""Flow metrics of one card type in one project.

Everything is derived from each card's transitions. A card's life is split into
intervals, one per stay in a column. Durations of an interval follow the calendar of
the person who moved the card out of that column; an interval still open follows the
card's current assignees, and anything without a person follows the project calendar.

A card is finished when it enters a Done column from a column that is not Done, and it
counts as finished only while it is still in a Done column; moving between Done
columns keeps it finished. Filing a cancelled card into Done (archiving a rejected
one) is not finishing it. Lead time runs from creation, cycle time from the first
entry into a Work column, both to the last such finish.

A stay shorter than a misclick (5 minutes) is a card passing through a column, not
work done there: it is left out of the column's usual times and is never unusual.

When the filters name people or roles, only the part of a card's life while such
people were assigned counts: time in a column is cut to those stretches, and a move
or a finish counts only if they were assigned right before or right after it.
"""

from __future__ import annotations

from bisect import bisect_right
from collections import Counter, defaultdict
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING, Final, Literal

from taiga_metrics.filters import AssignmentFilter
from taiga_metrics.metrics.calendar import WorkCalendar, percentile
from taiga_metrics.project_settings import ColumnType

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable, Sequence


OPEN_TYPES: Final = frozenset({"queue", "work", "rework", None})
IN_PROGRESS_TYPES: Final = frozenset({"work", "rework"})
MIN_SAMPLES_FOR_AGING: Final = 3
MISCLICK: Final = timedelta(minutes=5)
LEVEL_MARGIN_DAYS: Final = 1 / 24
BEGINNING: Final = datetime.min.replace(tzinfo=UTC)
FAR_FUTURE: Final = datetime.max.replace(tzinfo=UTC)

StayLevel = Literal["very_fast", "fast", "long", "very_long", "passed_through"]


@dataclass(frozen=True)
class Column:
    """A column of the card type, with its Taiga order and the owner's type."""

    status_id: int
    name: str
    color: str
    position: int
    type: ColumnType | None
    is_deleted: bool = False


@dataclass(frozen=True)
class Step:
    """One transition of a card."""

    happened_at: datetime
    kind: str
    from_status: int | None
    to_status: int | None
    user_id: int | None


@dataclass(frozen=True)
class Card:
    """A card with its full transition history.

    ``assignments`` are the assignee sets with the moment each one took effect,
    oldest first; before the first one nobody was assigned.
    """

    item_id: int
    ref: int | None
    subject: str
    created_at: datetime | None
    status_id: int | None
    is_deleted: bool
    steps: tuple[Step, ...]
    assignees: frozenset[int] = frozenset()
    last_activity: datetime | None = None
    assignments: tuple[tuple[datetime, frozenset[int]], ...] = ()
    owner_id: int | None = None

    def assigned_at(self, moment: datetime) -> frozenset[int]:
        """Who was assigned at ``moment``, changes made at that very moment included."""
        index = bisect_right([when for when, _ in self.assignments], moment)
        return self.assignments[index - 1][1] if index else frozenset()

    def assigned_before(self, moment: datetime) -> frozenset[int]:
        """Who was assigned just before ``moment``."""
        return self.assigned_at(moment - timedelta(microseconds=1))


@dataclass(frozen=True)
class Interval:
    """One stay of a card in a column."""

    status_id: int
    start: datetime
    end: datetime | None
    exited_by: int | None


@dataclass(frozen=True)
class Calendars:
    """The project calendar and members' own working days."""

    project: WorkCalendar
    members: Mapping[int, frozenset[int]] = field(default_factory=dict)

    def of_user(self, user_id: int | None) -> WorkCalendar:
        """The calendar of one person, or the project's."""
        if user_id is not None and user_id in self.members:
            return self.project.with_days(self.members[user_id])
        return self.project

    def of_group(self, user_ids: Iterable[int]) -> WorkCalendar:
        """A day works if it works for any of the people; the project's without people."""
        days: set[int] = set()
        people = list(user_ids)
        for user_id in people:
            days |= self.of_user(user_id).working_days
        return self.project.with_days(frozenset(days)) if people else self.project


@dataclass(frozen=True)
class FlowOptions:
    """How to compute: which period, which kind of days, what counts as a misclick.

    The period runs from ``since`` up to ``until``, either end open when ``None``.
    ``people`` narrows everything to the stretches when the right people were
    assigned; ``roles_of`` gives each member's role for it. ``column`` asks for the
    cards standing in that column right now.
    """

    now: datetime
    since: datetime | None
    working_days: bool
    misclick: timedelta = MISCLICK
    until: datetime | None = None
    people: AssignmentFilter | None = None
    roles_of: Mapping[int, int | None] = field(default_factory=dict)
    column: int | None = None

    @property
    def end(self) -> datetime:
        """The last moment of the period, never later than now."""
        return min(self.until, self.now) if self.until else self.now


@dataclass(frozen=True)
class ColumnTime:
    """Time spent in one column across cards: each card's visits added up."""

    status_id: int
    name: str
    color: str
    type: ColumnType | None
    is_deleted: bool
    cards: int
    p50: float | None
    p85: float | None
    p95: float | None
    in_column_now: int


@dataclass(frozen=True)
class StayTime:
    """Single stays in one column: every visit on its own, the yardstick for one stay."""

    status_id: int
    stays: int
    p5: float | None
    p15: float | None
    p50: float | None
    p85: float | None
    p95: float | None


@dataclass(frozen=True)
class Sample:
    """One finished card's lead or cycle time."""

    item_id: int
    ref: int | None
    subject: str
    days: float
    finished_at: datetime
    created_at: datetime | None = None
    is_deleted: bool = False
    assignees: frozenset[int] = frozenset()
    user_id: int | None = None


@dataclass(frozen=True)
class FinishedCard:
    """A card that finished in the period: who was assigned then and who finished it."""

    item_id: int
    ref: int | None
    subject: str
    finished_at: datetime
    created_at: datetime | None
    is_deleted: bool
    assignees: frozenset[int]
    user_id: int | None


def finished_card(card: Card, finished: datetime) -> FinishedCard:
    """The card as it was when it finished."""
    return FinishedCard(
        card.item_id,
        card.ref,
        card.subject,
        finished,
        card.created_at,
        card.is_deleted,
        card.assigned_before(finished),
        finished_by(card, finished),
    )


def finished_by(card: Card, finished: datetime) -> int | None:
    """Who moved the card into Done at ``finished``."""
    for step in card.steps:
        if step.happened_at == finished:
            return step.user_id
    return None


@dataclass(frozen=True)
class Distribution:
    """Lead or cycle time of the finished cards."""

    p50: float | None
    p85: float | None
    p95: float | None
    samples: tuple[Sample, ...]


@dataclass(frozen=True)
class Week:
    """Cards finished in one week."""

    start: datetime
    finished: int


@dataclass(frozen=True)
class BackMove:
    """How often cards moved from one column back to an earlier one, or into rework."""

    from_status: int
    to_status: int
    count: int
    reopen: bool
    rework: bool = False


@dataclass(frozen=True)
class BackMoves:
    """Backward moves and reopenings in the period."""

    moves: tuple[BackMove, ...]
    cards_moved: int
    cards_with_back_moves: int


@dataclass(frozen=True)
class MoveCount:
    """How often cards went from one column to another in the period.

    A missing ``from_status`` is a card created in ``to_status``; a missing
    ``to_status`` is a card deleted from ``from_status``.
    """

    from_status: int | None
    to_status: int | None
    count: int
    cards: int
    events: tuple[MoveEvent, ...] = ()


@dataclass(frozen=True)
class MoveEvent:
    """One move: which card, when, who made it, and who was assigned right before."""

    item_id: int
    ref: int | None
    subject: str
    happened_at: datetime
    user_id: int | None
    assignees: frozenset[int]
    is_deleted: bool = False


@dataclass(frozen=True)
class PersonMoves:
    """Moves between two columns made while one person was assigned, or by them.

    ``person_id`` is ``None`` for moves with nobody assigned, or by nobody known.
    """

    person_id: int | None
    from_status: int | None
    to_status: int | None
    count: int


@dataclass(frozen=True)
class StuckCard:
    """An unfinished card and how long it has been where it is."""

    item_id: int
    ref: int | None
    subject: str
    status_id: int
    days_in_column: float
    days_idle: float | None
    level: str | None
    p85: float | None
    p95: float | None
    assignees: frozenset[int]
    created_by: int | None = None


@dataclass(frozen=True)
class ColumnCard:
    """A card behind a column's numbers: one that left it in the period, or is in it now.

    ``days`` is its time there (all visits added up for one that left, the current stay
    for one that is there); ``user_id`` moved it out, or moved it in.
    """

    status_id: int
    now: bool
    item_id: int
    ref: int | None
    subject: str
    created_at: datetime | None
    is_deleted: bool
    days: float
    assignees: frozenset[int]
    user_id: int | None


def entered_by(card: Card, interval: Interval) -> int | None:
    """Who moved the card into the column where ``interval`` is its stay."""
    for step in card.steps:
        if step.happened_at == interval.start and step.to_status == interval.status_id:
            return step.user_id
    return None


@dataclass(frozen=True)
class FlowReport:
    """Every flow metric of one card type."""

    configured: bool
    missing: tuple[str, ...]
    cards: int
    finished: int
    in_progress: int
    columns: tuple[ColumnTime, ...]
    lead_time: Distribution
    cycle_time: Distribution
    throughput: tuple[Week, ...]
    back_moves: BackMoves
    stuck: tuple[StuckCard, ...]
    moves: tuple[MoveCount, ...] = ()
    moves_by_assignee: tuple[PersonMoves, ...] = ()
    moves_by_mover: tuple[PersonMoves, ...] = ()
    current: tuple[StuckCard, ...] = ()
    stay_times: tuple[StayTime, ...] = ()
    column_cards: tuple[ColumnCard, ...] = ()
    finishes: tuple[FinishedCard, ...] = ()


def intervals_of(card: Card, now: datetime) -> list[Interval]:
    """The card's stays in columns, oldest first; the last is open unless deleted.

    Creation starts the first stay. Without a creation entry, the card starts at its
    creation time in the column its first move leaves, or in its current column.
    """
    steps = list(card.steps)
    intervals: list[Interval] = []
    current: int | None = None
    since: datetime | None = None
    if steps and steps[0].kind == "create":
        first = steps.pop(0)
        current, since = first.to_status, first.happened_at
    elif card.created_at is not None:
        current = next((step.from_status for step in steps if step.kind == "move"), card.status_id)
        since = card.created_at
    for step in steps:
        if current is not None and since is not None and step.happened_at >= since:
            intervals.append(Interval(current, since, step.happened_at, step.user_id))
        if step.kind == "delete":
            return intervals
        current, since = step.to_status, step.happened_at
    if current is not None and since is not None and not card.is_deleted:
        intervals.append(Interval(current, since, None, None))
    return intervals


def assignment_windows(card: Card, options: FlowOptions) -> list[tuple[datetime, datetime]] | None:
    """Stretches of the card's life when the filtered people were assigned.

    ``None`` when the filters name nobody, meaning the whole life counts.
    """
    if options.people is None:
        return None
    bounds = [(BEGINNING, frozenset[int]()), *card.assignments]
    windows: list[tuple[datetime, datetime]] = []
    for index, (start, assignees) in enumerate(bounds):
        end = bounds[index + 1][0] if index + 1 < len(bounds) else FAR_FUTURE
        if end <= start or not options.people.matches(assignees, options.roles_of):
            continue
        if windows and windows[-1][1] == start:
            windows[-1] = (windows[-1][0], end)
        else:
            windows.append((start, end))
    return windows


def clip(
    start: datetime, end: datetime, windows: Sequence[tuple[datetime, datetime]] | None
) -> list[tuple[datetime, datetime]]:
    """The parts of ``start``-``end`` inside the windows; all of it without windows."""
    if windows is None:
        return [(start, end)] if end > start else []
    parts = []
    for window_start, window_end in windows:
        part_start, part_end = max(start, window_start), min(end, window_end)
        if part_end > part_start:
            parts.append((part_start, part_end))
    return parts


def counts_at(card: Card, moment: datetime, options: FlowOptions) -> bool:
    """Whether an event at ``moment`` belongs to the filtered people.

    It does when they were assigned right before the event or right after it.
    """
    if options.people is None:
        return True
    return any(
        options.people.matches(assignees, options.roles_of)
        for assignees in (card.assigned_before(moment), card.assigned_at(moment))
    )


def interval_calendar(interval: Interval, card: Card, calendars: Calendars) -> WorkCalendar:
    """The calendar of whoever ended the stay, or of the current assignees if it is open."""
    if interval.end is None:
        return calendars.of_group(card.assignees)
    return calendars.of_user(interval.exited_by)


def interval_days(
    interval: Interval,
    card: Card,
    calendars: Calendars,
    options: FlowOptions,
    windows: Sequence[tuple[datetime, datetime]] | None = None,
) -> float:
    """Length of a stay, or of its parts inside the windows, by the calendar that applies."""
    calendar = interval_calendar(interval, card, calendars)
    return sum(
        calendar.days_between(start, end, working=options.working_days)
        for start, end in clip(interval.start, interval.end or options.now, windows)
    )


def finish_time(card: Card, types: Mapping[int, ColumnType | None]) -> datetime | None:
    """When the card last entered Done from outside Done, if it is in Done now."""
    if card.is_deleted:
        return None
    finished: datetime | None = None
    in_done = False
    for step in card.steps:
        if step.kind == "delete":
            return None
        entering_done = types.get(step.to_status or -1) == "done"
        if entering_done and not in_done:
            from_cancelled = types.get(step.from_status or -1) == "cancelled"
            finished = None if from_cancelled else step.happened_at
        in_done = entering_done
    return finished if in_done else None


def first_work(card: Card, types: Mapping[int, ColumnType | None]) -> datetime | None:
    """When the card first entered a Work column, including being created in one."""
    for step in card.steps:
        if types.get(step.to_status or -1) == "work":
            return step.happened_at
    return None


def span_days(
    intervals: Sequence[Interval],
    card: Card,
    start: datetime,
    end: datetime,
    *,
    calendars: Calendars,
    options: FlowOptions,
) -> float:
    """Days between ``start`` and ``end``, stay by stay, each by its own calendar."""
    total = 0.0
    for interval in intervals:
        clipped_start = max(interval.start, start)
        clipped_end = min(interval.end or options.now, end)
        if clipped_end <= clipped_start:
            continue
        calendar = interval_calendar(interval, card, calendars)
        total += calendar.days_between(clipped_start, clipped_end, working=options.working_days)
    return total


def distribution(samples: list[Sample]) -> Distribution:
    """Percentiles of the samples, newest finish first."""
    days = [sample.days for sample in samples]
    return Distribution(
        p50=percentile(days, 0.5),
        p85=percentile(days, 0.85),
        p95=percentile(days, 0.95),
        samples=tuple(sorted(samples, key=lambda sample: sample.finished_at, reverse=True)),
    )


def in_period(moment: datetime, options: FlowOptions) -> bool:
    """Whether a moment falls in the reporting period."""
    after_start = options.since is None or moment >= options.since
    return after_start and (options.until is None or moment < options.until)


def weeks(
    finishes: Sequence[datetime], calendars: Calendars, options: FlowOptions
) -> tuple[Week, ...]:
    """Finished cards per week, every week of the period present, oldest first."""
    counts = Counter(calendars.project.week_start(moment) for moment in finishes)
    first = (
        calendars.project.week_start(options.since) if options.since else min(counts, default=None)
    )
    if first is None:
        return ()
    last = calendars.project.week_start(options.end)
    result = []
    week = first
    while week <= last:
        result.append(Week(week, counts.get(week, 0)))
        week = calendars.project.week_start(week + timedelta(days=7, hours=12))
    return tuple(result)


def back_moves(
    cards: Sequence[Card], columns: Mapping[int, Column], options: FlowOptions
) -> BackMoves:
    """Moves to an earlier column, into a Rework column, and out of Done.

    A move back out of a column entered less than ``misclick`` earlier is treated as
    undoing a mistaken move, not as work going back. Cancelled columns never count, and
    leaving a Rework column is the work resuming, not going back.
    """
    counts: Counter[tuple[int, int, bool, bool]] = Counter()
    moved: set[int] = set()
    returned: set[int] = set()
    for card in cards:
        entered: datetime | None = None
        for step in card.steps:
            if (
                step.kind == "move"
                and in_period(step.happened_at, options)
                and counts_at(card, step.happened_at, options)
            ):
                moved.add(card.item_id)
                source = columns.get(step.from_status or -1)
                target = columns.get(step.to_status or -1)
                quick = entered is not None and step.happened_at - entered < options.misclick
                if (
                    source
                    and target
                    and not quick
                    and "cancelled" not in (source.type, target.type)
                ):
                    reopen = source.type == "done" and target.type != "done"
                    rework = target.type == "rework" and source.type != "rework"
                    earlier = target.position < source.position and source.type != "rework"
                    if reopen or rework or earlier:
                        counts[(source.status_id, target.status_id, reopen, rework)] += 1
                        returned.add(card.item_id)
            entered = step.happened_at
    return BackMoves(
        moves=tuple(
            BackMove(source, target, count, reopen, rework)
            for (source, target, reopen, rework), count in counts.most_common()
        ),
        cards_moved=len(moved),
        cards_with_back_moves=len(returned),
    )


def person_moves(
    counter: Counter[tuple[int | None, int | None, int | None]],
) -> tuple[PersonMoves, ...]:
    """Counted moves of people as rows."""
    return tuple(
        PersonMoves(person, source, target, count)
        for (person, source, target), count in counter.items()
    )


def assigned_now(card: Card, options: FlowOptions) -> bool:
    """Whether the card's current assignees are the ones the filters ask for."""
    return options.people is None or options.people.matches(card.assignees, options.roles_of)


def finish_samples(
    card: Card,
    intervals: Sequence[Interval],
    finished: datetime,
    types: Mapping[int, ColumnType | None],
    *,
    calendars: Calendars,
    options: FlowOptions,
) -> tuple[Sample | None, Sample | None]:
    """Lead and cycle time of a finished card, each missing when it cannot be told."""

    def sample(start: datetime) -> Sample:
        days = span_days(intervals, card, start, finished, calendars=calendars, options=options)
        return Sample(
            card.item_id,
            card.ref,
            card.subject,
            days,
            finished,
            card.created_at,
            card.is_deleted,
            card.assigned_before(finished),
            finished_by(card, finished),
        )

    created = intervals[0].start if intervals else card.created_at
    started = first_work(card, types)
    return (
        sample(created) if created is not None else None,
        sample(started) if started is not None and started < finished else None,
    )


def stuck_cards(
    open_stays: Sequence[tuple[Card, Interval, float]],
    types: Mapping[int, ColumnType | None],
    thresholds: Mapping[int, StayTime],
    calendars: Calendars,
    options: FlowOptions,
    *,
    column: int | None = None,
) -> tuple[StuckCard, ...]:
    """Unfinished cards against the p85 and p95 of single stays there, most stuck first.

    With ``column``, every card standing in that column, whatever its type.
    """
    stuck = []
    for card, interval, days in open_stays:
        wanted = (
            interval.status_id == column
            if column is not None
            else types.get(interval.status_id) in OPEN_TYPES
        )
        if not wanted or not assigned_now(card, options):
            continue
        limits = thresholds.get(interval.status_id)
        enough = limits is not None and limits.stays >= MIN_SAMPLES_FOR_AGING
        p85 = limits.p85 if limits and enough else None
        p95 = limits.p95 if limits and enough else None
        level = None
        if p95 is not None and days > p95:
            level = "red"
        elif p85 is not None and days > p85:
            level = "yellow"
        idle = (
            calendars.of_group(card.assignees).days_between(
                card.last_activity, options.now, working=options.working_days
            )
            if card.last_activity
            else None
        )
        stuck.append(
            StuckCard(
                card.item_id,
                card.ref,
                card.subject,
                interval.status_id,
                days,
                idle,
                level,
                p85,
                p95,
                card.assignees,
                card.owner_id,
            )
        )
    stuck.sort(
        key=lambda item: (item.level != "red", item.level != "yellow", -item.days_in_column)
    )
    return tuple(stuck)


def column_moves(
    cards: Sequence[Card], options: FlowOptions
) -> tuple[tuple[MoveCount, ...], tuple[PersonMoves, ...], tuple[PersonMoves, ...]]:
    """Every column change in the period: in total, by assignee, and by who made it.

    A move counts once for each person assigned right before it, so a card shared by
    two people shows up under both. Each total lists its moves, newest first.
    """
    totals: Counter[tuple[int | None, int | None]] = Counter()
    cards_of: dict[tuple[int | None, int | None], set[int]] = defaultdict(set)
    events: dict[tuple[int | None, int | None], list[MoveEvent]] = defaultdict(list)
    by_assignee: Counter[tuple[int | None, int | None, int | None]] = Counter()
    by_mover: Counter[tuple[int | None, int | None, int | None]] = Counter()
    for card in cards:
        for step in card.steps:
            if not in_period(step.happened_at, options) or not counts_at(
                card, step.happened_at, options
            ):
                continue
            pair = (step.from_status, step.to_status)
            totals[pair] += 1
            cards_of[pair].add(card.item_id)
            assignees = (
                card.assigned_at(step.happened_at)
                if step.kind == "create"
                else card.assigned_before(step.happened_at)
            )
            events[pair].append(
                MoveEvent(
                    card.item_id,
                    card.ref,
                    card.subject,
                    step.happened_at,
                    step.user_id,
                    assignees,
                    card.is_deleted,
                )
            )
            people: list[int | None] = [*sorted(assignees)] or [None]
            for person in people:
                by_assignee[(person, *pair)] += 1
            by_mover[(step.user_id, *pair)] += 1

    return (
        tuple(
            MoveCount(
                source,
                target,
                count,
                len(cards_of[(source, target)]),
                tuple(
                    sorted(
                        events[(source, target)],
                        key=lambda event: event.happened_at,
                        reverse=True,
                    )
                ),
            )
            for (source, target), count in totals.most_common()
        ),
        person_moves(by_assignee),
        person_moves(by_mover),
    )


@dataclass(frozen=True)
class Stay:
    """One stay of a card in a column, with its length."""

    status_id: int
    start: datetime
    end: datetime | None
    days: float
    exited_by: int | None
    level: StayLevel | None = None


def stay_level(days: float, column: StayTime | None) -> StayLevel | None:
    """How a finished stay compares with the column's past stays.

    Longer than 95% of them is very long, longer than 85% long; shorter than 95% of
    them is very fast, shorter than 85% fast. A column needs a few past stays first, and
    a stay must clear the limit by more than an hour, the precision durations are shown
    with, so stays that look the same never get different levels.
    """
    if column is None or column.stays < MIN_SAMPLES_FOR_AGING:
        return None

    def beyond(limit: float | None, sign: int) -> bool:
        if limit is None:
            return False
        return (days - limit) * sign > LEVEL_MARGIN_DAYS

    if beyond(column.p95, 1):
        return "very_long"
    if beyond(column.p85, 1):
        return "long"
    if beyond(column.p5, -1):
        return "very_fast"
    if beyond(column.p15, -1):
        return "fast"
    return None


def stays_of(card: Card, calendars: Calendars, options: FlowOptions) -> tuple[Stay, ...]:
    """Every stay of one card with its whole length, oldest first."""
    return tuple(
        Stay(
            interval.status_id,
            interval.start,
            interval.end,
            interval_days(interval, card, calendars, options),
            interval.exited_by,
        )
        for interval in intervals_of(card, options.now)
    )


def with_levels(stays: Iterable[Stay], columns: Iterable[StayTime]) -> tuple[Stay, ...]:
    """The stays with the finished ones compared with their column's past stays.

    Leaving a column faster than a misclick is passing through it, not a stay to compare.
    """
    by_id = {column.status_id: column for column in columns}

    def level(stay: Stay) -> StayLevel | None:
        if stay.end is None:
            return None
        if stay.end - stay.start < MISCLICK:
            return "passed_through"
        return stay_level(stay.days, by_id.get(stay.status_id))

    return tuple(replace(stay, level=level(stay)) for stay in stays)


@dataclass(frozen=True)
class ColumnTotal:
    """All the time one card spent in one column."""

    status_id: int
    days: float
    visits: int


@dataclass(frozen=True)
class CardReport:
    """The flow of one card: where its time went, and how long it took overall."""

    stays: tuple[Stay, ...]
    columns: tuple[ColumnTotal, ...]
    finished_at: datetime | None
    lead_days: float | None
    cycle_days: float | None
    back_moves: int


def card_report(
    card: Card, columns: Sequence[Column], calendars: Calendars, options: FlowOptions
) -> CardReport:
    """Every stay of one card, the totals per column in column order, and its times."""
    types = {column.status_id: column.type for column in columns}
    order = {column.status_id: (column.is_deleted, column.position) for column in columns}
    intervals = intervals_of(card, options.now)
    stays = stays_of(card, calendars, options)
    totals: dict[int, list[float]] = defaultdict(list)
    for stay in stays:
        totals[stay.status_id].append(stay.days)
    finished = finish_time(card, types)
    lead = cycle = None
    if finished is not None:
        lead_sample, cycle_sample = finish_samples(
            card, intervals, finished, types, calendars=calendars, options=options
        )
        lead = lead_sample.days if lead_sample else None
        cycle = cycle_sample.days if cycle_sample else None
    everything = FlowOptions(
        now=options.now, since=None, working_days=options.working_days, misclick=options.misclick
    )
    returned = back_moves([card], {column.status_id: column for column in columns}, everything)
    return CardReport(
        stays=stays,
        columns=tuple(
            ColumnTotal(status_id, sum(days), len(days))
            for status_id, days in sorted(
                totals.items(), key=lambda item: order.get(item[0], (True, 1 << 30))
            )
        ),
        finished_at=finished,
        lead_days=lead,
        cycle_days=cycle,
        back_moves=sum(move.count for move in returned.moves),
    )


def compute_flow(
    cards: Sequence[Card],
    columns: Sequence[Column],
    calendars: Calendars,
    options: FlowOptions,
) -> FlowReport:
    """All flow metrics of the given cards."""
    by_id = {column.status_id: column for column in columns}
    types = {column.status_id: column.type for column in columns}
    missing = tuple(
        name for name, kind in (("Work", "work"), ("Done", "done")) if kind not in types.values()
    )

    per_column: dict[int, list[float]] = defaultdict(list)
    per_stay: dict[int, list[float]] = defaultdict(list)
    now_in_column: Counter[int] = Counter()
    open_stays: list[tuple[Card, Interval, float]] = []
    column_cards: list[ColumnCard] = []
    lead: list[Sample] = []
    cycle: list[Sample] = []
    finishes: list[FinishedCard] = []
    live = [card for card in cards if not card.is_deleted]

    for card in cards:
        intervals = intervals_of(card, options.now)
        windows = assignment_windows(card, options)
        stays: dict[int, float] = defaultdict(float)
        last_exit: dict[int, Interval] = {}
        for interval in intervals:
            if windows is not None and not clip(
                interval.start, interval.end or options.now, windows
            ):
                continue
            days = interval_days(interval, card, calendars, options, windows)
            if interval.end is None:
                now_in_column[interval.status_id] += 1
                open_stays.append((card, interval, days))
                column_cards.append(
                    ColumnCard(
                        interval.status_id,
                        True,
                        card.item_id,
                        card.ref,
                        card.subject,
                        card.created_at,
                        card.is_deleted,
                        days,
                        card.assignees,
                        entered_by(card, interval),
                    )
                )
            elif (
                in_period(interval.end, options)
                and interval.end - interval.start >= options.misclick
            ):
                stays[interval.status_id] += days
                per_stay[interval.status_id].append(days)
                last_exit[interval.status_id] = interval
        for status_id, days in stays.items():
            per_column[status_id].append(days)
            exit_interval = last_exit[status_id]
            column_cards.append(
                ColumnCard(
                    status_id,
                    False,
                    card.item_id,
                    card.ref,
                    card.subject,
                    card.created_at,
                    card.is_deleted,
                    days,
                    card.assigned_before(exit_interval.end or options.now),
                    exit_interval.exited_by,
                )
            )

        finished = finish_time(card, types)
        if (
            finished is None
            or not in_period(finished, options)
            or not counts_at(card, finished, options)
        ):
            continue
        lead_sample, cycle_sample = finish_samples(
            card, intervals, finished, types, calendars=calendars, options=options
        )
        finishes.append(finished_card(card, finished))
        if lead_sample:
            lead.append(lead_sample)
        if cycle_sample:
            cycle.append(cycle_sample)

    column_times = tuple(
        ColumnTime(
            status_id=column.status_id,
            name=column.name,
            color=column.color,
            type=column.type,
            is_deleted=column.is_deleted,
            cards=len(per_column[column.status_id]),
            p50=percentile(per_column[column.status_id], 0.5),
            p85=percentile(per_column[column.status_id], 0.85),
            p95=percentile(per_column[column.status_id], 0.95),
            in_column_now=now_in_column[column.status_id],
        )
        for column in sorted(columns, key=lambda column: (column.is_deleted, column.position))
        if not column.is_deleted or per_column[column.status_id] or now_in_column[column.status_id]
    )
    stay_times = tuple(
        StayTime(
            status_id=status_id,
            stays=len(values),
            p5=percentile(values, 0.05),
            p15=percentile(values, 0.15),
            p50=percentile(values, 0.5),
            p85=percentile(values, 0.85),
            p95=percentile(values, 0.95),
        )
        for status_id, values in per_stay.items()
    )
    thresholds = {time.status_id: time for time in stay_times}
    moves, moves_by_assignee, moves_by_mover = column_moves(cards, options)

    return FlowReport(
        configured=not missing,
        missing=missing,
        cards=len(live),
        finished=len(finishes),
        in_progress=sum(
            1
            for card in live
            if types.get(card.status_id or -1) in IN_PROGRESS_TYPES and assigned_now(card, options)
        ),
        columns=column_times,
        lead_time=distribution(lead),
        cycle_time=distribution(cycle),
        throughput=weeks([finish.finished_at for finish in finishes], calendars, options),
        back_moves=back_moves(cards, by_id, options),
        stuck=stuck_cards(open_stays, types, thresholds, calendars, options),
        moves=moves,
        moves_by_assignee=moves_by_assignee,
        moves_by_mover=moves_by_mover,
        current=()
        if options.column is None
        else stuck_cards(open_stays, types, thresholds, calendars, options, column=options.column),
        stay_times=stay_times,
        column_cards=tuple(column_cards),
        finishes=tuple(sorted(finishes, key=lambda finish: finish.finished_at)),
    )


def without_columns(report: FlowReport, hidden: Collection[int]) -> FlowReport:
    """The report with the given columns left out of every table that lists columns.

    Time spent in them still counts in lead and cycle time; only rows and moves that
    name them disappear.
    """
    if not hidden:
        return report

    def shown(*status_ids: int | None) -> bool:
        return not any(status_id in hidden for status_id in status_ids)

    return replace(
        report,
        columns=tuple(column for column in report.columns if shown(column.status_id)),
        stay_times=tuple(time for time in report.stay_times if shown(time.status_id)),
        column_cards=tuple(card for card in report.column_cards if shown(card.status_id)),
        current=tuple(card for card in report.current if shown(card.status_id)),
        moves=tuple(move for move in report.moves if shown(move.from_status, move.to_status)),
        moves_by_assignee=tuple(
            move for move in report.moves_by_assignee if shown(move.from_status, move.to_status)
        ),
        moves_by_mover=tuple(
            move for move in report.moves_by_mover if shown(move.from_status, move.to_status)
        ),
        back_moves=replace(
            report.back_moves,
            moves=tuple(
                move for move in report.back_moves.moves if shown(move.from_status, move.to_status)
            ),
        ),
    )


def card_without_columns(report: CardReport, hidden: Collection[int]) -> CardReport:
    """One card's report with the given columns left out of its column tables."""
    if not hidden:
        return report
    return replace(
        report,
        stays=tuple(stay for stay in report.stays if stay.status_id not in hidden),
        columns=tuple(total for total in report.columns if total.status_id not in hidden),
    )
