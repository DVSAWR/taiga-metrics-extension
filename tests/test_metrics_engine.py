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
    aging_thresholds,
    card_report,
    compute_flow,
    finish_time,
    intervals_of,
    stay_level,
    stays_of,
    with_levels,
)
from taiga_metrics.metrics.returns import ReturnRules

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


def test_an_unrecorded_last_move_leaves_the_card_where_the_board_shows_it() -> None:
    """A current column the history never reached takes the open stay."""
    item = dataclasses.replace(card(1, (1, READY, 5)), status_id=DOING)
    stays = intervals_of(item, at(10))
    assert [(s.status_id, s.start, s.end) for s in stays] == [
        (NEW, at(0), at(1)),
        (DOING, at(1), None),
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
    assert len(report.back_moves.cases) == 2
    assert all(case.kind == "direct" for case in report.back_moves.cases)
    assert len(report.back_moves.events) == sum(move.count for move in report.back_moves.moves)
    assert [(event.from_status, event.to_status) for event in report.back_moves.events] == [
        (DONE, REVIEW),
        (REVIEW, DOING),
    ]
    assert len(report.first_passes) == sum(column.passes for column in report.columns)
    assert sum(event.clean for event in report.first_passes) == sum(
        column.clean_passes for column in report.columns
    )


def test_rework_keeps_two_events_in_one_case_across_periods() -> None:
    """Detection and routing are independently dated, but remain one linked case."""
    rework = 8
    columns = [*COLUMNS, Column(rework, "REWORK", "#d35460", 4, "work")]
    item = card(1, (1, DOING, 5), (2, REVIEW, 6), (3, rework, 7), (5, DOING, 7))
    chosen = dataclasses.replace(
        options(),
        returns=ReturnRules(marked=frozenset({(REVIEW, rework), (rework, DOING)})),
    )
    complete = compute_flow([item], columns, CALENDARS, chosen).back_moves
    assert {(move.from_status, move.to_status) for move in complete.moves} == {
        (REVIEW, rework),
        (rework, DOING),
    }
    assert (complete.rework_entries, complete.rework_routes, len(complete.cases)) == (1, 1, 1)
    assert [(event.from_status, event.to_status) for event in complete.events] == [
        (rework, DOING),
        (REVIEW, rework),
    ]
    assert complete.cases[0].kind == "rework"
    assert (complete.cases[0].detected_at, complete.cases[0].routed_at) == (at(3), at(5))
    assert complete.cases[0].routed_to == DOING

    detection = compute_flow(
        [item], columns, CALENDARS, dataclasses.replace(chosen, until=at(4))
    ).back_moves
    assert (detection.rework_entries, detection.rework_routes, len(detection.cases)) == (1, 0, 1)
    assert detection.cases[0].routed_at is None

    routing = compute_flow(
        [item], columns, CALENDARS, dataclasses.replace(chosen, since=at(4))
    ).back_moves
    assert (routing.rework_entries, routing.rework_routes, len(routing.cases)) == (0, 1, 0)


def test_rework_does_not_merge_two_separate_rejections_of_one_card() -> None:
    """Each new detection starts a case even when it is on the same user story."""
    rework = 8
    columns = [*COLUMNS, Column(rework, "REWORK", "#d35460", 4, "work")]
    item = card(
        1,
        (1, DOING, 5),
        (2, REVIEW, 6),
        (3, rework, 7),
        (4, DOING, 7),
        (5, REVIEW, 5),
        (6, rework, 6),
        (7, DOING, 6),
    )
    chosen = dataclasses.replace(
        options(),
        returns=ReturnRules(marked=frozenset({(REVIEW, rework), (rework, DOING)})),
    )
    returned = compute_flow([item], columns, CALENDARS, chosen).back_moves
    assert (returned.rework_entries, returned.rework_routes, len(returned.cases)) == (2, 2, 2)
    assert [(case.detected_at, case.routed_at) for case in returned.cases] == [
        (at(6), at(7)),
        (at(3), at(4)),
    ]


def test_card_report_uses_the_same_return_rules_as_project_flow() -> None:
    """A disabled return rule cannot still produce a return on the card page."""
    item = card(1, (1, DOING, 5), (2, REVIEW, 6), (3, DOING, 7))
    chosen = dataclasses.replace(options(), returns=ReturnRules(earlier=False, out_of_done=False))
    assert compute_flow([item], COLUMNS, CALENDARS, chosen).back_moves.moves == ()
    assert card_report(item, COLUMNS, CALENDARS, chosen).back_moves == 0


def test_finished_in_an_old_period_survives_a_later_reopening() -> None:
    """A later return changes the current state, not an earlier period's accepted result."""
    item = card(1, (1, DOING, 5), (2, DONE, 5), (5, DOING, 6))
    assert finish_time(item, TYPES) is None
    assert finish_time(item, TYPES, as_of=at(4)) == at(2)
    early = compute_flow(
        [item], COLUMNS, CALENDARS, dataclasses.replace(options(), since=at(1), until=at(4))
    )
    late = compute_flow(
        [item], COLUMNS, CALENDARS, dataclasses.replace(options(), since=at(4), until=at(7))
    )
    assert early.finished == 1
    assert late.finished == 0
    deleted_later = card(2, (1, DOING, 5), (2, DONE, 5), (5, DELETE, 6))
    assert finish_time(deleted_later, TYPES) is None
    assert finish_time(deleted_later, TYPES, as_of=at(4)) == at(2)


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


def test_stuck_is_judged_against_the_whole_history() -> None:
    """Past stays outside the report still set what is usual; the report alone has none."""
    history = [card(item, (0, DOING, 5), (1, REVIEW, 5)) for item in range(1, 5)]
    doing = card(9, (0, DOING, 5), assignees=frozenset({5}))
    alone = compute_flow([doing], COLUMNS, CALENDARS, options(now_days=10))
    assert alone.stuck[0].level is None
    aging = aging_thresholds([*history, doing], TYPES, CALENDARS, options(now_days=10))
    judged = compute_flow(
        [doing], COLUMNS, CALENDARS, dataclasses.replace(options(now_days=10), aging=aging)
    )
    assert judged.stuck[0].level == "red"


def test_stuck_adds_previous_visits_without_resetting_on_reentry() -> None:
    """A short latest stay cannot hide earlier time spent in the same status."""
    history = [card(item, (0, DOING, 5), (5, REVIEW, 5)) for item in range(1, 4)]
    returned = card(9, (0, DOING, 5), (8, NEW, 5), (9, DOING, 5))
    report = compute_flow([*history, returned], COLUMNS, CALENDARS, options(now_days=10))
    current = next(item for item in report.stuck if item.item_id == 9)
    assert current.days_in_column == 1
    assert current.days_in_status == 9
    assert current.age_days == 10
    assert current.p85 == 5
    assert current.status_level == current.level == "red"


def test_status_baseline_adds_visits_once_per_completed_card() -> None:
    """Compare a total with per-card totals, excluding cards still in that status."""
    history = [
        card(item, (0, DOING, 5), (3, REVIEW, 5), (4, DOING, 5), (7, REVIEW, 5))
        for item in range(1, 4)
    ]
    returned = card(9, (0, DOING, 5), (5, NEW, 5), (9, DOING, 5))
    report = compute_flow([*history, returned], COLUMNS, CALENDARS, options(now_days=10))
    current = next(item for item in report.stuck if item.item_id == 9)
    assert current.days_in_status == current.p85 == 6
    assert current.status_level is None


def test_repeated_visits_do_not_replace_three_distinct_baseline_cards() -> None:
    """Many exits by one card are one completed cumulative observation."""
    history = card(
        1,
        (0, DOING, 5),
        (1, REVIEW, 5),
        (2, DOING, 5),
        (3, REVIEW, 5),
        (4, DOING, 5),
        (5, REVIEW, 5),
    )
    report = compute_flow(
        [history, card(9, (0, DOING, 5))], COLUMNS, CALENDARS, options(now_days=30)
    )
    current = next(item for item in report.stuck if item.item_id == 9)
    assert current.p85 is None
    assert current.level is None


def test_age_detects_old_work_after_a_recent_status_change() -> None:
    """Creation age is compared with completed creation-to-finish ages."""
    history = [card(item, (1, DOING, 5), (5, DONE, 5)) for item in range(1, 4)]
    old = card(9, (9, DOING, 5))
    report = compute_flow([*history, old], COLUMNS, CALENDARS, options(now_days=10))
    current = next(item for item in report.stuck if item.item_id == 9)
    assert current.days_in_status == 1
    assert current.age_days == 10
    assert current.age_p85 == 5
    assert current.status_level is None
    assert current.age_level == current.level == "red"


def test_working_age_and_cumulative_status_time_skip_days_off() -> None:
    """Age and status totals use their matching working-day baselines."""
    history = [card(item, (0, DOING, 5), (1, DONE, 5)) for item in range(1, 4)]
    returned = card(9, (0, DOING, 5), (4, NEW, 5), (6, DOING, 5))
    current = next(
        item
        for item in compute_flow(
            [*history, returned], COLUMNS, CALENDARS, options(now_days=7, working=True)
        ).stuck
        if item.item_id == 9
    )
    assert current.age_days == 5
    assert current.calendar_age_days == 7
    assert current.days_in_status == pytest.approx(4 + 9 / 24)
    assert current.days_in_column == pytest.approx(9 / 24)
    assert current.p85 == current.age_p85 == 1


def test_assignment_does_not_reset_card_aging() -> None:
    """Every current assignee sees the same card age, cumulative time and level."""
    history = [card(item, (0, DOING, 5), (1, DONE, 5)) for item in range(1, 4)]
    doing = dataclasses.replace(
        card(9, (0, DOING, 5), assignees=frozenset({6})), assignments=((at(9), frozenset({6})),)
    )
    aging = aging_thresholds([*history, doing], TYPES, CALENDARS, options(now_days=10))
    project = compute_flow(
        [doing], COLUMNS, CALENDARS, dataclasses.replace(options(now_days=10), aging=aging)
    ).stuck[0]
    personal = compute_flow(
        [doing], COLUMNS, CALENDARS, dataclasses.replace(for_people(6, now_days=10), aging=aging)
    ).stuck[0]
    assert (
        (personal.age_days, personal.days_in_status, personal.level)
        == (project.age_days, project.days_in_status, project.level)
        == (10, 10, "red")
    )


def test_idle_counts_visible_activity_and_ignores_future_activity() -> None:
    """Past reports select the last activity known then, rather than today's maximum."""
    doing = dataclasses.replace(
        card(1, (1, DOING, 5), last_activity=at(9)), activity=(at(3), at(9))
    )
    report = compute_flow(
        [doing], COLUMNS, CALENDARS, dataclasses.replace(options(now_days=10), until=at(7))
    )
    assert report.stuck[0].days_idle == 1
    assert report.stuck_at_end[0].days_idle == 4
    assert report.stuck_at_end[0].age_days == 7


def test_future_completed_work_cannot_change_past_stuck_classification() -> None:
    """A completion after the reporting cutoff cannot set a historical threshold."""
    history = [card(item, (0, DOING, 5), (1, REVIEW, 5)) for item in range(1, 4)]
    future = card(8, (0, DOING, 5), (25, DONE, 5))
    old = card(9, (0, DOING, 5))
    report = compute_flow(
        [*history, future, old],
        COLUMNS,
        CALENDARS,
        dataclasses.replace(options(now_days=30), until=at(10)),
    )
    assert next(item for item in report.stuck if item.item_id == 9).p85 == 25
    past = next(item for item in report.stuck_at_end if item.item_id == 9)
    assert past.p85 == 1
    assert past.level == "red"


def test_only_cards_in_work_columns_can_be_stuck() -> None:
    """A card waiting in a queue far longer than usual is listed but never stuck."""
    history = [card(item, (1, READY, 5)) for item in range(1, 5)]
    waiting = card(9, assignees=frozenset({5}))
    report = compute_flow([*history, waiting], COLUMNS, CALENDARS, options(now_days=30))
    flagged = [item for item in report.stuck if item.item_id == 9]
    assert flagged
    assert flagged[0].level is None


def test_a_column_lists_every_card_standing_in_it() -> None:
    """Asked for one column, the report lists its cards now, even in a done column."""
    cards = [card(1, (1, DONE, 5)), card(2, (2, DONE, 5)), card(3, (1, DOING, 5))]
    report = compute_flow(
        cards, COLUMNS, CALENDARS, dataclasses.replace(options(now_days=10), column=DONE)
    )
    assert [item.item_id for item in report.current] == [1, 2]
    assert [item.days_in_column for item in report.current] == pytest.approx([9.0, 8.0])
    assert compute_flow(cards, COLUMNS, CALENDARS, options()).current == ()


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
        card(1, (1, DOING, 5), last_activity=at(1)),
        assignees=frozenset({6}),
        assignments=((at(0), frozenset({5})), (at(2), frozenset({6}))),
    )
    previous = compute_flow([doing], COLUMNS, CALENDARS, for_people(5))
    assert previous.in_progress == 0
    assert previous.stuck == ()
    assert (
        next(column for column in previous.columns if column.status_id == DOING).in_column_now == 0
    )
    assert not any(card.now for card in previous.column_cards)
    report = compute_flow([doing], COLUMNS, CALENDARS, for_people(6, now_days=10))
    assert report.in_progress == 1
    assert report.stuck[0].days_in_column == pytest.approx(9)
    assert report.stuck[0].days_idle == pytest.approx(8)


def test_new_coassignee_gets_only_idle_time_since_assignment() -> None:
    """Adding a second executor does not charge them the card's earlier idle days."""
    doing = dataclasses.replace(
        card(1, (1, DOING, 5), assignees=frozenset({5, 6}), last_activity=at(2)),
        assignments=((at(0), frozenset({5})), (at(8), frozenset({5, 6}))),
    )
    project = compute_flow([doing], COLUMNS, CALENDARS, options(now_days=10))
    first = compute_flow([doing], COLUMNS, CALENDARS, for_people(5, now_days=10))
    added = compute_flow([doing], COLUMNS, CALENDARS, for_people(6, now_days=10))
    assert (project.stuck[0].days_in_column, project.stuck[0].days_idle) == (9, 2)
    assert (first.stuck[0].days_in_column, first.stuck[0].days_idle) == (9, 2)
    assert (added.stuck[0].days_in_column, added.stuck[0].days_idle) == (9, 2)
    assert next(row for row in added.column_cards if row.now).days == 2
    at_period_end = dataclasses.replace(for_people(6, now_days=10), until=at(9))
    historical = compute_flow([doing], COLUMNS, CALENDARS, at_period_end)
    assert (historical.stuck_at_end[0].days_in_column, historical.stuck_at_end[0].days_idle) == (
        8,
        1,
    )


def test_people_and_the_rest_add_up_to_the_whole() -> None:
    """The time of person 5 and of everyone else together is the card's whole time."""
    whole = compute_flow([handed_over()], COLUMNS, CALENDARS, options())
    mine = compute_flow([handed_over()], COLUMNS, CALENDARS, for_people(5))
    rest = compute_flow(
        [handed_over()],
        COLUMNS,
        CALENDARS,
        dataclasses.replace(options(), people=AssignmentFilter(people=frozenset({5})).rest()),
    )
    for status in (NEW, DOING, REVIEW):
        times = [
            {time.status_id: time for time in report.columns}[status].p50 or 0
            for report in (whole, mine, rest)
        ]
        assert times[0] == pytest.approx(times[1] + times[2])
    assert mine.finished + rest.finished == whole.finished


def test_roles_filter_uses_members_roles() -> None:
    """A role stands for everyone holding it."""
    by_role = dataclasses.replace(
        options(), people=AssignmentFilter(roles=frozenset({40})), roles_of={6: 40, 5: 41}
    )
    assert compute_flow([handed_over()], COLUMNS, CALENDARS, by_role).finished == 1


def test_going_back_is_read_from_the_column_order_only() -> None:
    """A move to an earlier column goes back; moving on from it is the work resuming."""
    report = compute_flow(
        [card(1, (1, DOING, 5), (2, REVIEW, 5), (3, DOING, 5), (4, REVIEW, 5), (5, DONE, 5))],
        COLUMNS,
        CALENDARS,
        options(),
    )
    assert [
        (move.from_status, move.to_status, move.reopen) for move in report.back_moves.moves
    ] == [(REVIEW, DOING, False)]
    assert report.back_moves.cards_with_back_moves == 1


def test_a_period_lists_the_columns_it_used() -> None:
    """A removed column shows in the period it held cards; an unused one does not."""
    columns = [*COLUMNS, Column(9, "Old review", "#999999", 4, "work", is_deleted=True)]
    cards = [card(1, (1, 9, 5), (3, DONE, 5))]
    early = dataclasses.replace(options(now_days=30), until=at(5))
    late = dataclasses.replace(options(now_days=30), since=at(10))
    used_early = {
        column.status_id
        for column in compute_flow(cards, columns, CALENDARS, early).columns
        if column.used
    }
    used_late = {
        column.status_id
        for column in compute_flow(cards, columns, CALENDARS, late).columns
        if column.used
    }
    assert 9 in used_early
    assert 9 not in used_late
    assert REVIEW not in used_early


def test_stuck_at_the_end_of_a_past_period_is_kept() -> None:
    """A card stuck in Doing on day 10 and finished on day 20 was stuck then, not now."""
    history = [card(item, (0, DOING, 5), (1, REVIEW, 5)) for item in range(1, 5)]
    late = dataclasses.replace(
        card(9, (0, DOING, 5), (20, DONE, 5)),
        assignees=frozenset({5}),
        assignments=((at(0), frozenset({5})),),
    )
    period = dataclasses.replace(options(now_days=30), until=at(10))
    report = compute_flow([*history, late], COLUMNS, CALENDARS, period)
    assert all(item.item_id != 9 for item in report.stuck)
    assert [item.item_id for item in report.stuck_at_end if item.level] == [9]
