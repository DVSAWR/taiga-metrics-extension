"""Distinct returned cards, repeated events, and scoped quality summaries."""

from __future__ import annotations

from dataclasses import replace
from datetime import timedelta

from taiga_metrics.analysis import direction_row, direction_tiles, flow_tiles, status_rows
from taiga_metrics.directions import DirectionRef, direction_flow
from taiga_metrics.metrics.engine import compute_flow
from taiga_metrics.metrics.quality import ReturnStats, return_stats
from taiga_metrics.metrics.share import person_quality, person_share
from tests.test_directions import CALENDARS, COLUMNS, OPTIONS, START, card


def test_repeated_returns_are_events_after_each_cards_first() -> None:
    """Three returns of one card and one of another give two repeats and a 50% rate."""
    assert return_stats([1, 1, 1, 2]) == ReturnStats(
        returns=4, returned_cards=2, repeat_returns=2, repeated_cards=1, repeat_rate=0.5
    )
    assert return_stats([]) == ReturnStats()
    assert return_stats([1, 2]).repeat_rate == 0


def test_person_status_breakdown_counts_the_same_stuck_cards_as_the_tiles() -> None:
    """The status rows must not replace actual stuck counts with zero."""
    history = [card(item, (0, 2, 6), (1, 4, 6)) for item in range(1, 4)]
    mine = replace(
        card(9, (0, 2, 6)), assignees=frozenset({6}), assignments=((START, frozenset({6})),)
    )
    report = compute_flow([*history, mine], COLUMNS, CALENDARS, OPTIONS)
    shares = person_share(
        [mine],
        COLUMNS,
        CALENDARS,
        OPTIONS,
        user_id=6,
        role_id=40,
        column_roles={2: [40]},
        every=True,
    )
    rows = {row.id: row for row in status_rows(shares, report)}
    assert rows[2].stuck == flow_tiles(report).stuck == 1


def test_role_and_person_count_repeats_within_their_own_scope() -> None:
    """Two returns to Backend plus one to Review stay distinct in per-status rows."""
    item = replace(
        card(1, (1, 2, 6), (2, 3, 6), (3, 2, 7), (4, 3, 6), (5, 2, 7), (6, 4, 6), (7, 3, 7)),
        assignees=frozenset({6}),
        assignments=((START, frozenset({6})),),
    )
    report = compute_flow([item], COLUMNS, CALENDARS, OPTIONS)
    project = flow_tiles(report)
    assert (project.returns, project.returned_cards, project.repeat_returns) == (3, 1, 2)
    direction = direction_flow(
        report,
        [item],
        CALENDARS,
        OPTIONS,
        columns=COLUMNS,
        statuses={2, 3},
        members={6},
        wip_limits={},
    )
    assert (direction.returns, direction.repeat_returns, direction.repeat_rate) == (3, 2, 1)
    person = next(person for person in direction.people if person.user_id == 6)
    assert (person.returns, person.repeat_returns, person.repeated_cards) == (3, 2, 1)
    ref = DirectionRef(role_id=40, name="Development", columns={"userstory": [2, 3]}, members=[6])
    assert direction_row(ref, direction).repeat_returns == 2
    assert direction_tiles(direction).returned_cards == 1
    quality = person_quality([item], COLUMNS, OPTIONS, 6)
    summary = return_stats(event.item_id for event in quality.events)
    assert flow_tiles(report, summary).repeat_returns == 2
    shares = person_share(
        [item],
        COLUMNS,
        CALENDARS,
        OPTIONS,
        user_id=6,
        role_id=40,
        column_roles={2: [40], 3: [40]},
        quality=quality,
    )
    rows = {row.id: row for row in status_rows(shares)}
    assert (rows[2].returns, rows[2].repeat_returns, rows[2].repeat_rate) == (2, 1, 1)
    assert (rows[3].returns, rows[3].repeat_returns, rows[3].repeat_rate) == (1, 0, 0)
    assert person_quality([item], COLUMNS, OPTIONS, 8).events == []


def test_only_returns_inside_the_period_contribute_to_repeats() -> None:
    """An earlier historical return does not inflate the repeats of the selected period."""
    item = replace(
        card(1, (1, 2, 6), (2, 3, 6), (3, 2, 7), (4, 3, 6), (5, 2, 7)),
        assignees=frozenset({6}),
        assignments=((START, frozenset({6})),),
    )
    period = replace(OPTIONS, since=START + timedelta(days=4), until=START + timedelta(days=6))
    quality = person_quality([item], COLUMNS, period, 6)
    stats = return_stats(event.item_id for event in quality.events)
    assert (stats.returns, stats.repeat_returns, stats.repeat_rate) == (1, 0, 0)
    period = replace(period, until=START + timedelta(days=5))
    assert person_quality([item], COLUMNS, period, 6).events == []
