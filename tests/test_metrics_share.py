"""Tests for a person's part of the time in each column."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest

from taiga_metrics.metrics.calendar import WorkCalendar
from taiga_metrics.metrics.engine import Calendars, Card, Column, FlowOptions, Step
from taiga_metrics.metrics.share import person_share

START = datetime(2026, 9, 7, 9, tzinfo=UTC)
CALENDARS = Calendars(WorkCalendar("UTC", frozenset(range(1, 8))))
COLUMNS = [
    Column(1, "New", "#999", 1, "queue"),
    Column(2, "Backend", "#999", 2, "work"),
    Column(3, "Review", "#999", 3, "work"),
    Column(4, "Done", "#999", 4, "done"),
]
OPTIONS = FlowOptions(now=START + timedelta(days=30), since=None, working_days=False)


def at(days: float) -> datetime:
    """``days`` after the start."""
    return START + timedelta(days=days)


def card(
    item_id: int, *moves: tuple[float, int, int], assignees: frozenset[int] = frozenset()
) -> Card:
    """A card created in New, then moved as ``(day, column, by)``."""
    steps = [Step(at(0), "create", None, 1, 5)]
    previous = 1
    for day, column, user in moves:
        steps.append(Step(at(day), "move", previous, column, user))
        previous = column
    return Card(
        item_id=item_id,
        ref=item_id,
        subject=f"Card {item_id}",
        created_at=at(0),
        status_id=previous,
        is_deleted=False,
        steps=tuple(steps),
        assignees=assignees,
    )


def test_time_belongs_to_whoever_moved_the_card_on() -> None:
    """Two stays in Backend, one finished by person 6: a third of the time is theirs."""
    cards = [
        card(1, (1, 2, 5), (3, 3, 6), (4, 4, 7)),
        card(2, (1, 2, 5), (5, 3, 7), (6, 4, 7)),
    ]
    shares = person_share(
        cards, COLUMNS, CALENDARS, OPTIONS, user_id=6, role_id=40, column_roles={2: [40]}
    )
    backend = next(column for column in shares if column.status_id == 2)
    assert (backend.stays, backend.person_stays) == (2, 1)
    assert backend.share == pytest.approx(2 / 6)
    assert backend.person_p50 == pytest.approx(2)


def test_cards_standing_in_a_column_count_for_their_assignees() -> None:
    """An open stay is not time yet, but it is the person's card now."""
    shares = person_share(
        [card(1, (1, 2, 5), assignees=frozenset({6}))],
        COLUMNS,
        CALENDARS,
        OPTIONS,
        user_id=6,
        role_id=40,
        column_roles={2: [40]},
    )
    backend = next(column for column in shares if column.status_id == 2)
    assert (backend.now, backend.person_now, backend.stays) == (1, 1, 0)


def test_only_the_columns_of_the_persons_role_are_listed() -> None:
    """Review never held a card but is the role's; Backend is someone else's."""
    cards = [card(1, (1, 2, 5))]
    listed = person_share(
        cards, COLUMNS, CALENDARS, OPTIONS, user_id=6, role_id=40, column_roles={3: [40], 2: [41]}
    )
    assert [column.status_id for column in listed] == [3]
    assert (
        person_share(
            cards, COLUMNS, CALENDARS, OPTIONS, user_id=6, role_id=None, column_roles={3: [40]}
        )
        == []
    )
