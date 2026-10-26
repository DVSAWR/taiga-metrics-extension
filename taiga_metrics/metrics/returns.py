"""Returns: when a card goes back, and whose work it was that did not pass.

What counts is the project's own choice, per card type:

- a move to an earlier column in Taiga's order, and a move out of Done, can each count
  or not; a move into or out of a Cancelled column never does;
- a move undone within the misclick threshold is a mistake, not a return;
- pause columns are where a card waits for a decision: moving it there and back is not
  a return. A move across a pause counts only when that source/target pair is explicitly
  marked, because moving to an earlier status after a decision does not prove a defect;
- a triage column receives returns without knowing whose work failed: a return there is
  credited to the column the card is sent to next;
- a move between two given columns can be marked a return or no return, over all of the
  above, for a process the rules do not describe.

A return is credited to a column, the one it came back to (or the triage's next one),
and to people by the project's rule. The author/reviewer option infers them from the
actors who moved the card out of BACKEND/FRONTEND and their matching review statuses;
an unknown actor is not replaced with the current assignee.

The first pass of a column is a card leaving it for the first time by a move that is not
a return. It is clean when nothing is credited back to that column afterwards.
"""

from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import TYPE_CHECKING, Final, Literal, get_args

if TYPE_CHECKING:
    from collections.abc import Callable, Mapping, Sequence

    from taiga_metrics.metrics.engine import Column, Interval

Credit = Literal["assignees", "author", "everyone", "author_reviewer"]
CREDITS: Final[tuple[Credit, ...]] = get_args(Credit)
ColumnMode = Literal["normal", "pause", "triage"]
COLUMN_MODES: Final[tuple[ColumnMode, ...]] = get_args(ColumnMode)
DEFAULT_MISCLICK: Final = timedelta(minutes=5)
REWORK_DETECTORS: Final = frozenset({"EXPERTISE ACCEPTANCE", "PRODUCT ACCEPTANCE"})


@dataclass(frozen=True)
class ReturnRules:
    """What counts as a return in one card type, and to whom it is credited.

    ``marked`` moves, as pairs of columns, are returns and ``unmarked`` ones are not,
    whatever the rules say.
    """

    earlier: bool = True
    out_of_done: bool = True
    credit: Credit = "assignees"
    pauses: frozenset[int] = frozenset()
    triage: frozenset[int] = frozenset()
    marked: frozenset[tuple[int, int]] = frozenset()
    unmarked: frozenset[tuple[int, int]] = frozenset()


@dataclass(frozen=True)
class Return:
    """One return of one card: the move, the column it is credited to, and the people.

    ``left_at`` is when the card left the column it came from, before any pause.
    """

    happened_at: datetime
    left_at: datetime
    from_status: int
    to_status: int
    credited_status: int
    reopen: bool
    mover: int | None
    credited: frozenset[int] = field(default_factory=frozenset)


@dataclass(frozen=True)
class FirstPass:
    """A card's first pass of one column: when, by whom, and whether it was clean."""

    status_id: int
    passed_at: datetime
    author: int | None
    clean: bool


def is_return(
    source: Column | None,
    target: Column | None,
    rules: ReturnRules,
    *,
    through_pause: bool = False,
) -> tuple[bool, bool]:
    """Whether a move from ``source`` to ``target`` is a return, and whether it reopens.

    Only acceptance can send a US into triage, even if another source is to its right
    in Taiga's order. Explicit pair marks still take priority.
    """
    if source is None or target is None:
        return False, False
    pair = (source.status_id, target.status_id)
    if pair in rules.unmarked:
        return False, False
    if pair in rules.marked:
        return True, source.type == "done" and target.type != "done"
    if through_pause or "cancelled" in (source.type, target.type):
        return False, False
    reopen = rules.out_of_done and source.type == "done" and target.type != "done"
    earlier = rules.earlier and target.position < source.position
    if target.name.strip().upper() == "REWORK":
        return source.name.strip().upper() in REWORK_DETECTORS, False
    return reopen or earlier, reopen


def returns_of(
    intervals: Sequence[Interval],
    columns: Mapping[int, Column],
    rules: ReturnRules,
    misclick: timedelta,
    assigned_before: Callable[[datetime], frozenset[int]],
) -> list[Return]:
    """Every return in one card's stays, oldest first, pause columns seen through."""
    stays = [
        (index, interval)
        for index, interval in enumerate(intervals)
        if interval.status_id not in rules.pauses
    ]
    found: list[Return] = []
    for index in range(1, len(stays)):
        source_index, source = stays[index - 1]
        target_index, target = stays[index]
        if source.status_id == target.status_id or source.end is None:
            continue
        source_column = columns.get(source.status_id)
        if source.end - source.start < misclick and (
            source_column is None or source_column.name.strip().upper() != "REWORK"
        ):
            continue
        counts, reopen = is_return(
            columns.get(source.status_id),
            columns.get(target.status_id),
            rules,
            through_pause=target_index > source_index + 1,
        )
        if not counts:
            continue
        credited_status = target.status_id
        if target.status_id in rules.triage and index + 1 < len(stays):
            credited_status = stays[index + 1][1].status_id
        moment = target.start
        found.append(
            Return(
                happened_at=moment,
                left_at=source.end,
                from_status=source.status_id,
                to_status=target.status_id,
                credited_status=credited_status,
                reopen=reopen,
                mover=mover_into(intervals, target),
                credited=credited_people(
                    intervals,
                    credited_status,
                    source,
                    moment=moment,
                    rules=rules,
                    columns=columns,
                    assigned_before=assigned_before,
                ),
            )
        )
    return found


def mover_into(intervals: Sequence[Interval], stay: Interval) -> int | None:
    """Who moved the card into ``stay``: whoever closed the stay just before it."""
    before = [interval for interval in intervals if interval.end == stay.start]
    return before[-1].exited_by if before else None


def author_reviewer_credit(
    intervals: Sequence[Interval],
    credited_status: int,
    source: Interval,
    columns: Mapping[int, Column],
) -> frozenset[int]:
    """Infer author and, after a completed code review, reviewer from their moves."""
    credited_column = columns.get(credited_status)
    if credited_column is None or credited_column.name.strip().upper() == "REWORK":
        return frozenset()
    earlier_work = [
        interval
        for interval in intervals
        if interval.status_id == credited_status
        and interval.end is not None
        and interval.end <= source.start
    ]
    if not earlier_work:
        return frozenset()
    work = earlier_work[-1]
    people = {work.exited_by} if work.exited_by is not None else set()
    name = credited_column.name.strip().upper()
    source_column = columns.get(source.status_id)
    source_name = source_column.name.strip().upper() if source_column else ""
    if name in {"BACKEND", "FRONTEND"} and source_name in {
        "REWORK",
        "UX REVIEW",
        "STAGING",
        "EXPERTISE ACCEPTANCE",
        "PRODUCT ACCEPTANCE",
    }:
        review = next(
            (
                column.status_id
                for column in columns.values()
                if column.name.strip().upper() == f"{name} REVIEW" and not column.is_deleted
            ),
            None,
        )
        if review is not None:
            reviewers = [
                interval.exited_by
                for interval in intervals
                if interval.status_id == review
                and interval.end is not None
                and work.end is not None
                and work.end <= interval.end <= source.start
                and interval.exited_by is not None
            ]
            if reviewers:
                people.add(reviewers[-1])
    return frozenset(people)


def credited_people(
    intervals: Sequence[Interval],
    credited_status: int,
    source: Interval,
    *,
    moment: datetime,
    rules: ReturnRules,
    columns: Mapping[int, Column],
    assigned_before: Callable[[datetime], frozenset[int]],
) -> frozenset[int]:
    """The people a return is credited to, by the project's rule."""
    assignees = assigned_before(moment)
    if rules.credit == "assignees":
        return assignees
    if rules.credit == "author_reviewer":
        return author_reviewer_credit(intervals, credited_status, source, columns)
    earlier = [
        index
        for index, interval in enumerate(intervals)
        if interval.status_id == credited_status
        and interval.end is not None
        and interval.end <= source.start
    ]
    if not earlier:
        return assignees
    work = intervals[earlier[-1]]
    if rules.credit == "author":
        return frozenset({work.exited_by}) if work.exited_by is not None else assignees
    people = {
        interval.exited_by
        for interval in intervals[earlier[-1] :]
        if interval.end is not None
        and interval.end <= source.start
        and interval.status_id not in rules.pauses
        and interval.exited_by is not None
    }
    return frozenset(people) or assignees


def first_passes(
    intervals: Sequence[Interval],
    returns: Sequence[Return],
    misclick: timedelta,
    pauses: frozenset[int] = frozenset(),
) -> list[FirstPass]:
    """The first pass of every column the card left, oldest first.

    A stay shorter than the misclick threshold only passed through: it is no pass.
    """
    returned_at = {(item.from_status, item.left_at) for item in returns}
    meaningful = [
        (index, interval)
        for index, interval in enumerate(intervals)
        if interval.status_id not in pauses
    ]
    passes: list[FirstPass] = []
    seen: set[int] = set()
    for index in range(len(meaningful) - 1):
        original_index, interval = meaningful[index]
        next_index, target = meaningful[index + 1]
        if (
            interval.status_id in seen
            or interval.end is None
            or target.status_id == interval.status_id
        ):
            continue
        if interval.end - interval.start < misclick:
            continue
        if (interval.status_id, interval.end) in returned_at:
            continue
        seen.add(interval.status_id)
        through_pause = next_index > original_index + 1
        passed_at = target.start if through_pause else interval.end
        clean = not any(
            item.credited_status == interval.status_id and item.happened_at > passed_at
            for item in returns
        )
        passes.append(
            FirstPass(
                interval.status_id,
                passed_at,
                None if through_pause else interval.exited_by,
                clean,
            )
        )
    return passes


def credited_counts(returns: Sequence[Return]) -> Counter[int]:
    """How many returns each person is credited with."""
    counts: Counter[int] = Counter()
    for item in returns:
        counts.update(item.credited)
    return counts
