"""Tests for flow metrics computed from card histories."""

from __future__ import annotations

import dataclasses
from datetime import UTC, datetime, timedelta

import pytest

from taiga_metrics.filters import AssignmentFilter
from taiga_metrics.metrics.calendar import WorkCalendar
from taiga_metrics.metrics.engine import (
    Calendars,
    Card,
    Column,
    FlowOptions,
    PersonMoves,
    Step,
    compute_flow,
    finish_time,
    intervals_of,
    stay_level,
    stays_of,
    with_levels,
    without_columns,
)

MONDAY = datetime(2026, 9, 21, 9, tzinfo=UTC)
NEW, READY, DOING, REVIEW, DONE, ARCHIVED, REJECTED = 1, 2, 3, 4, 5, 6, 7
DELETE = -1

COLUMNS = [
    Column(NEW, "New", "#70728f", 1, "queue"),
    Column(READY, "Ready", "#e44057", 2, "queue"),
    Column(DOING, "In progress", "#e47c40", 3, "work"),
    Column(REVIEW, "Review", "#e4ce40", 4, "work"),
    Column(DONE, "Done", "#a8e440", 5, "done"),
    Column(ARCHIVED, "Archived", "#55cc33", 6, "done"),
    Column(REJECTED, "Rejected", "#999999", 7, "cancelled"),
]
TYPES = {column.status_id: column.type for column in COLUMNS}
CALENDARS = Calendars(WorkCalendar("UTC", frozenset({1, 2, 3, 4, 5})))


def at(days: float) -> datetime:
    """A moment ``days`` after Monday 09:00."""
    return MONDAY + timedelta(days=days)


def card(
    item_id: int,
    *moves: tuple[float, int, int | None],
    assignees: frozenset[int] = frozenset(),
    last_activity: datetime | None = None,
) -> Card:
    """A card created in New at day 0 by user 5, then moved on the given days."""
    steps = [Step(at(0), "create", None, NEW, 5)]
    current: int | None = NEW
    for day, target, by in moves:
        deleted = target == DELETE
        steps.append(
            Step(
                at(day), "delete" if deleted else "move", current, None if deleted else target, by
            )
        )
        current = None if deleted else target
    return Card(
        item_id=item_id,
        ref=item_id,
        subject=f"card {item_id}",
        created_at=at(0),
        status_id=current,
        is_deleted=current is None,
        steps=tuple(steps),
        assignees=assignees,
        last_activity=last_activity,
    )


def options(now_days: float = 30, *, working: bool = False) -> FlowOptions:
    """Options for a report at ``now_days`` covering all time."""
    return FlowOptions(now=at(now_days), since=None, working_days=working)


def test_intervals_follow_the_moves() -> None:
    """Each stay starts where the previous one ends; the current stay is open."""
    stays = intervals_of(card(1, (1, READY, 5), (3, DOING, 6)), at(10))
    assert [(s.status_id, s.start, s.end, s.exited_by) for s in stays] == [
        (NEW, at(0), at(1), 5),
        (READY, at(1), at(3), 6),
        (DOING, at(3), None, None),
    ]


def test_deleted_cards_have_no_open_stay() -> None:
    """Deletion ends the last stay."""
    stays = intervals_of(card(1, (2, DOING, 5), (4, DELETE, 5)), at(10))
    assert stays[-1].status_id == DOING
    assert stays[-1].end == at(4)


def test_cards_without_creation_entry_start_at_their_creation_time() -> None:
    """Old history may miss creation; the first move tells where the card was."""
    plain = card(1, (2, DOING, 5))
    without_create = Card(**{**plain.__dict__, "steps": plain.steps[1:]})
    stays = intervals_of(without_create, at(10))
    assert (stays[0].status_id, stays[0].start, stays[0].end) == (NEW, at(0), at(2))


def test_moving_between_done_columns_keeps_the_first_finish() -> None:
    """Done to Archived is still one finish, at the entry into Done."""
    assert finish_time(card(1, (2, DOING, 5), (4, DONE, 5), (9, ARCHIVED, 5)), TYPES) == at(4)


def test_reopened_cards_finish_at_their_last_entry_into_done() -> None:
    """Coming back to Done after a reopen moves the finish."""
    flapping = card(1, (2, DOING, 5), (4, DONE, 5), (5, REVIEW, 6), (7, DONE, 6))
    assert finish_time(flapping, TYPES) == at(7)


def test_cards_out_of_done_are_not_finished() -> None:
    """A card pulled back out of Done and still out is not finished."""
    assert finish_time(card(1, (4, DONE, 5), (5, DOING, 6)), TYPES) is None
    assert finish_time(card(1, (4, DONE, 5), (6, DELETE, 5)), TYPES) is None


def test_lead_and_cycle_time() -> None:
    """Lead time from creation, cycle time from the first Work column."""
    report = compute_flow(
        [card(1, (1, READY, 5), (2, DOING, 5), (6, DONE, 5))], COLUMNS, CALENDARS, options()
    )
    assert report.configured
    assert report.lead_time.p50 == 6.0
    assert report.cycle_time.p50 == 4.0
    assert report.finished == 1


def test_working_days_skip_the_weekend() -> None:
    """Monday to next Monday is five working days."""
    report = compute_flow(
        [card(1, (0, DOING, 5), (7, DONE, 5))], COLUMNS, CALENDARS, options(working=True)
    )
    assert report.lead_time.p50 == pytest.approx(5.0)


def test_a_stay_follows_the_calendar_of_whoever_ended_it() -> None:
    """User 6 works on weekends too, so their stay over a weekend counts every day."""
    calendars = Calendars(CALENDARS.project, {6: frozenset(range(1, 8))})
    report = compute_flow(
        [card(1, (0, DOING, 5), (7, DONE, 6))], COLUMNS, calendars, options(working=True)
    )
    doing = next(column for column in report.columns if column.status_id == DOING)
    assert doing.p50 == pytest.approx(7.0)


def test_time_in_column_sums_repeated_stays() -> None:
    """Two stays in In progress count as one card with their total."""
    report = compute_flow(
        [card(1, (1, DOING, 5), (3, REVIEW, 5), (4, DOING, 6), (6, DONE, 5))],
        COLUMNS,
        CALENDARS,
        options(),
    )
    doing = next(column for column in report.columns if column.status_id == DOING)
    assert (doing.cards, doing.p50) == (1, 4.0)


def test_back_moves_and_reopens_are_counted() -> None:
    """Review to In progress is a back move, Done to Review a reopen."""
    report = compute_flow(
        [card(1, (1, DOING, 5), (2, REVIEW, 5), (3, DOING, 6), (4, DONE, 5), (5, REVIEW, 6))],
        COLUMNS,
        CALENDARS,
        options(),
    )
    moves = {(m.from_status, m.to_status): (m.count, m.reopen) for m in report.back_moves.moves}
    assert moves == {(REVIEW, DOING): (1, False), (DONE, REVIEW): (1, True)}
    assert report.back_moves.cards_with_back_moves == 1


def test_moves_list_the_cards_newest_first() -> None:
    """Each move between two statuses names the cards, when, and by whom."""
    report = compute_flow(
        [
            card(1, (1, DOING, 5), (2, REVIEW, 5), (3, DOING, 6)),
            card(2, (1, DOING, 5), (2, REVIEW, 5), (4, DOING, 7)),
        ],
        COLUMNS,
        CALENDARS,
        options(),
    )
    back = next(m for m in report.moves if (m.from_status, m.to_status) == (REVIEW, DOING))
    events = back.events
    assert [(event.item_id, event.happened_at, event.user_id) for event in events] == [
        (2, at(4), 7),
        (1, at(3), 6),
    ]


def test_stays_compare_with_the_column_history() -> None:
    """Finished stays far below or above the usual time get a level; open ones do not."""
    history = [card(i, (0, DOING, 5), (i, DONE, 5)) for i in range(1, 21)]
    report = compute_flow(history, COLUMNS, CALENDARS, options())
    doing = next(time for time in report.stay_times if time.status_id == DOING)
    assert stay_level(0.5, doing) == "very_fast"
    assert stay_level(2.5, doing) == "fast"
    assert stay_level(10, doing) is None
    assert stay_level(18.5, doing) == "long"
    assert stay_level(30, doing) == "very_long"
    assert doing.p15 is not None
    assert stay_level(doing.p15 - 0.001, doing) is None
    stays = with_levels(stays_of(card(30, (0, DOING, 5)), CALENDARS, options()), report.stay_times)
    assert [stay.level for stay in stays] == ["passed_through", None]


def test_passing_through_is_not_a_stay() -> None:
    """Leaving a column within minutes neither counts in its usual time nor gets a level."""
    quick = timedelta(minutes=1) / timedelta(days=1)
    history = [card(i, (0, DOING, 5), (i, REVIEW, 5), (i + quick, DONE, 5)) for i in range(1, 6)]
    report = compute_flow(history, COLUMNS, CALENDARS, options())
    review = next(column for column in report.columns if column.status_id == REVIEW)
    assert review.cards == 0
    assert all(time.status_id != REVIEW for time in report.stay_times)
    stays = with_levels(stays_of(history[0], CALENDARS, options()), report.stay_times)
    assert [stay.level for stay in stays if stay.status_id == REVIEW] == ["passed_through"]


def test_single_stays_are_the_yardstick_for_one_stay() -> None:
    """Visits are compared one by one, while time in a column adds them up per card."""
    looping = card(1, (1, DOING, 5), (3, REVIEW, 5), (4, DOING, 6), (6, DONE, 5))
    report = compute_flow([looping], COLUMNS, CALENDARS, options())
    doing = next(column for column in report.columns if column.status_id == DOING)
    single = next(time for time in report.stay_times if time.status_id == DOING)
    assert (doing.cards, doing.p50) == (1, 4.0)
    assert (single.stays, single.p50) == (2, 2.0)


def test_few_past_stays_give_no_level() -> None:
    """A column needs a few past stays before a stay can be unusual."""
    report = compute_flow([card(1, (0, DOING, 5), (1, DONE, 5))], COLUMNS, CALENDARS, options())
    doing = next(time for time in report.stay_times if time.status_id == DOING)
    assert stay_level(100, doing) is None


def test_stuck_cards_name_who_created_them() -> None:
    """The card's owner in Taiga is who created it."""
    stuck = dataclasses.replace(card(1, (0, DOING, 5)), owner_id=8)
    report = compute_flow([stuck], COLUMNS, CALENDARS, options())
    assert report.stuck[0].created_by == 8


def test_quick_corrections_and_cancelled_columns_are_not_back_moves() -> None:
    """Undoing a misclick within minutes, or leaving Rejected, is not work going back."""
    misclick = card(1, (1, DOING, 5), (1.001, REVIEW, 5), (1.002, DOING, 5))
    revived = card(2, (1, REJECTED, 5), (2, NEW, 5))
    report = compute_flow([misclick, revived], COLUMNS, CALENDARS, options())
    assert report.back_moves.moves == ()
    assert report.back_moves.cards_moved == 2


def test_stuck_cards_compare_with_the_column_history() -> None:
    """A card far beyond the usual time in its column is flagged red."""
    history = [card(i, (0, DOING, 5), (1, DONE, 5)) for i in range(1, 5)]
    stuck = card(9, (0, DOING, 5), assignees=frozenset({5}), last_activity=at(2))
    report = compute_flow([*history, stuck], COLUMNS, CALENDARS, options(now_days=10))
    flagged = [item for item in report.stuck if item.item_id == 9]
    assert flagged[0].level == "red"
    assert flagged[0].days_in_column == pytest.approx(10.0)
    assert flagged[0].days_idle == pytest.approx(8.0)
    assert report.in_progress == 1


def test_finished_and_cancelled_cards_are_not_stuck() -> None:
    """Only cards still in queue or work columns can be stuck."""
    report = compute_flow(
        [card(1, (1, DONE, 5)), card(2, (1, REJECTED, 5))], COLUMNS, CALENDARS, options()
    )
    assert report.stuck == ()


def test_a_column_lists_every_card_standing_in_it() -> None:
    """Asked for one column, the report lists its cards now, even in a done column."""
    cards = [card(1, (1, DONE, 5)), card(2, (2, DONE, 5)), card(3, (1, DOING, 5))]
    report = compute_flow(
        cards, COLUMNS, CALENDARS, dataclasses.replace(options(now_days=10), column=DONE)
    )
    assert [item.item_id for item in report.current] == [1, 2]
    assert [item.days_in_column for item in report.current] == pytest.approx([9.0, 8.0])
    assert compute_flow(cards, COLUMNS, CALENDARS, options()).current == ()


def test_hidden_columns_leave_the_current_cards() -> None:
    """Cards standing in a hidden column are not listed."""
    options_now = dataclasses.replace(options(now_days=10), column=DONE)
    report = compute_flow([card(1, (1, DONE, 5))], COLUMNS, CALENDARS, options_now)
    assert without_columns(report, {DONE}).current == ()


def test_archiving_a_cancelled_card_is_not_finishing_it() -> None:
    """Rejected, then filed into Done: neither finished nor in throughput."""
    report = compute_flow(
        [card(1, (1, REJECTED, 5), (3, ARCHIVED, 5)), card(2, (1, DOING, 5), (2, DONE, 5))],
        COLUMNS,
        CALENDARS,
        options(),
    )
    assert report.finished == 1
    assert [sample.item_id for sample in report.lead_time.samples] == [2]


def test_column_cards_list_who_left_and_who_is_there() -> None:
    """Cards that left a column carry their total and who moved them out."""
    report = compute_flow(
        [card(1, (1, DOING, 5), (3, DONE, 6)), card(2, (2, DOING, 7))],
        COLUMNS,
        CALENDARS,
        options(now_days=10),
    )
    doing = [item for item in report.column_cards if item.status_id == DOING]
    assert sorted((item.item_id, item.now, item.user_id) for item in doing) == [
        (1, False, 6),
        (2, True, 7),
    ]
    assert len(report.finishes) == 1


def test_finished_cards_carry_who_finished_them_and_who_was_assigned() -> None:
    """A finished card knows its assignees at the finish and who moved it into Done."""
    finished = card(1, (1, DOING, 5), (3, DONE, 9))
    report = compute_flow([finished], COLUMNS, CALENDARS, options())
    [finish] = report.finishes
    assert finish.item_id == 1
    assert finish.user_id == 9
    [sample] = report.lead_time.samples
    assert sample.user_id == 9
    assert sample.assignees == finish.assignees


def test_throughput_counts_finishes_per_week() -> None:
    """Every week of the period is listed, empty ones with zero."""
    cards = [card(1, (1, DONE, 5)), card(2, (2, DONE, 5)), card(3, (15, DONE, 5))]
    report = compute_flow(cards, COLUMNS, CALENDARS, options(now_days=16))
    assert [week.finished for week in report.throughput] == [2, 0, 1]


def test_projects_without_work_or_done_are_not_configured() -> None:
    """Metrics need both a Work and a Done column."""
    unset = [Column(c.status_id, c.name, c.color, c.position, None) for c in COLUMNS]
    report = compute_flow([card(1, (1, DONE, 5))], unset, CALENDARS, options())
    assert not report.configured
    assert report.missing == ("Work", "Done")


def handed_over() -> Card:
    """Assigned to 5 at creation, handed to 6 on day 2, moved on days 1, 3 and 4."""
    base = card(1, (1, DOING, 5), (3, REVIEW, 6), (4, DONE, 6))
    return dataclasses.replace(
        base,
        assignees=frozenset({6}),
        assignments=((at(0), frozenset({5})), (at(2), frozenset({6}))),
    )


def for_people(*people: int, now_days: float = 30) -> FlowOptions:
    """Options narrowed to the given assignees."""
    return dataclasses.replace(
        options(now_days), people=AssignmentFilter(people=frozenset(people))
    )


def test_people_filter_counts_only_their_assigned_time() -> None:
    """The stay in progress is split at the handover between the two assignees."""
    first = compute_flow([handed_over()], COLUMNS, CALENDARS, for_people(5))
    second = compute_flow([handed_over()], COLUMNS, CALENDARS, for_people(6))
    doing = {time.status_id: time for time in first.columns}[DOING]
    assert doing.p50 == pytest.approx(1)
    assert {time.status_id: time for time in second.columns}[DOING].p50 == pytest.approx(1)
    assert {time.status_id: time for time in second.columns}[NEW].cards == 0


def test_finishes_belong_to_whoever_was_assigned_then() -> None:
    """Only the person assigned when the card reached Done gets the finish."""
    assert compute_flow([handed_over()], COLUMNS, CALENDARS, for_people(5)).finished == 0
    report = compute_flow([handed_over()], COLUMNS, CALENDARS, for_people(6))
    assert report.finished == 1
    assert report.lead_time.p50 == pytest.approx(4)


def test_period_end_leaves_later_events_out() -> None:
    """Nothing after ``until`` counts, and weeks stop there."""
    early = dataclasses.replace(options(30), since=at(0), until=at(3.5))
    report = compute_flow([handed_over()], COLUMNS, CALENDARS, early)
    assert report.finished == 0
    assert [week.start for week in report.throughput] == [at(0) - timedelta(hours=9)]
    assert {move.to_status for move in report.moves} == {NEW, DOING, REVIEW}


def test_moves_are_counted_per_column_pair_and_person() -> None:
    """Totals, the assignee right before each move, and who made it."""
    report = compute_flow([handed_over()], COLUMNS, CALENDARS, options())
    totals = {(m.from_status, m.to_status): (m.count, m.cards) for m in report.moves}
    assert totals[(NEW, DOING)] == (1, 1)
    assert totals[(None, NEW)] == (1, 1)
    assert PersonMoves(5, NEW, DOING, 1) in report.moves_by_assignee
    assert PersonMoves(6, DOING, REVIEW, 1) in report.moves_by_assignee
    assert PersonMoves(5, None, NEW, 1) in report.moves_by_assignee
    assert PersonMoves(6, DOING, REVIEW, 1) in report.moves_by_mover


def test_unassigned_moves_have_no_person() -> None:
    """Moves with nobody assigned are counted under ``None``."""
    report = compute_flow([card(1, (1, DOING, 5))], COLUMNS, CALENDARS, options())
    assert PersonMoves(None, NEW, DOING, 1) in report.moves_by_assignee


def test_stuck_and_in_progress_follow_current_assignees() -> None:
    """A card handed over is no longer stuck or in progress for the previous person."""
    doing = dataclasses.replace(
        card(1, (1, DOING, 5)),
        assignees=frozenset({6}),
        assignments=((at(0), frozenset({5})), (at(2), frozenset({6}))),
    )
    assert compute_flow([doing], COLUMNS, CALENDARS, for_people(5)).in_progress == 0
    assert compute_flow([doing], COLUMNS, CALENDARS, for_people(5)).stuck == ()
    report = compute_flow([doing], COLUMNS, CALENDARS, for_people(6, now_days=10))
    assert report.in_progress == 1
    assert report.stuck[0].days_in_column == pytest.approx(8)


def test_roles_filter_uses_members_roles() -> None:
    """A role stands for everyone holding it."""
    by_role = dataclasses.replace(
        options(), people=AssignmentFilter(roles=frozenset({40})), roles_of={6: 40, 5: 41}
    )
    assert compute_flow([handed_over()], COLUMNS, CALENDARS, by_role).finished == 1


def test_entering_rework_is_going_back_and_leaving_it_is_not() -> None:
    """A Rework column after Review still counts as work going back."""
    columns = [*COLUMNS[:4], Column(8, "Rework", "#e44057", 5, "rework"), *COLUMNS[4:]]
    report = compute_flow(
        [card(1, (1, DOING, 5), (2, REVIEW, 5), (3, 8, 5), (4, REVIEW, 5), (5, DONE, 5))],
        columns,
        CALENDARS,
        options(),
    )
    assert [
        (move.from_status, move.to_status, move.rework) for move in report.back_moves.moves
    ] == [(REVIEW, 8, True)]
    assert report.cycle_time.p50 == pytest.approx(4)


def test_cards_in_rework_are_in_progress() -> None:
    """Being reworked is being worked on."""
    columns = [*COLUMNS, Column(8, "Rework", "#e44057", 8, "rework")]
    report = compute_flow([card(1, (1, DOING, 5), (2, 8, 5))], columns, CALENDARS, options())
    assert report.in_progress == 1


def test_hidden_columns_leave_the_tables_but_not_the_times() -> None:
    """A removed column disappears from rows and moves; lead time keeps its time."""
    report = compute_flow(
        [card(1, (1, DOING, 5), (2, REVIEW, 5), (3, DONE, 5))], COLUMNS, CALENDARS, options()
    )
    hidden = without_columns(report, {REVIEW})
    assert REVIEW not in {column.status_id for column in hidden.columns}
    assert all(REVIEW not in (move.from_status, move.to_status) for move in hidden.moves)
    assert hidden.lead_time == report.lead_time
