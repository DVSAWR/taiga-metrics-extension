"""Tests for directions: roles and the columns they answer for."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

import pytest

from taiga_metrics.directions import closed_stays, direction_flow
from taiga_metrics.metrics.calendar import WorkCalendar
from taiga_metrics.metrics.engine import Calendars, Card, Column, FlowOptions, Step, compute_flow
from taiga_metrics.metrics.returns import ReturnRules
from tests.conftest import HEADERS
from tests.fakes import FakeFlowData, FakePeople

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services

START = datetime(2026, 9, 7, 9, tzinfo=UTC)
CALENDARS = Calendars(WorkCalendar("UTC", frozenset(range(1, 8))))
COLUMNS = [
    Column(1, "New", "#999", 1, "queue"),
    Column(2, "Backend", "#999", 2, "work"),
    Column(3, "Review", "#999", 3, "work"),
    Column(4, "Done", "#999", 4, "done"),
]
OPTIONS = FlowOptions(now=START + timedelta(days=30), since=None, working_days=False)


def card(item_id: int, *moves: tuple[float, int, int]) -> Card:
    """A card created in New, then moved as ``(day, column, by)``."""
    steps = [Step(START, "create", None, 1, 5)]
    previous = 1
    for day, column, user in moves:
        steps.append(Step(START + timedelta(days=day), "move", previous, column, user))
        previous = column
    return Card(
        item_id=item_id,
        ref=item_id,
        subject=f"Card {item_id}",
        created_at=START,
        status_id=previous,
        is_deleted=False,
        steps=tuple(steps),
    )


CARDS = [
    card(1, (1, 2, 5), (3, 3, 6), (4, 2, 7), (6, 3, 6), (7, 4, 7)),
    card(2, (1, 2, 5), (5, 3, 7), (6, 4, 7)),
]


def test_stays_belong_to_whoever_moved_the_card_on() -> None:
    """Backend stays end by 6, 6 and 7: two of them are 6's."""
    closed = closed_stays(CARDS, CALENDARS, OPTIONS, {2})
    assert {user: len(values) for user, values in closed.items()} == {6: 2, 7: 1}


def test_a_direction_shows_its_columns_people_and_returns() -> None:
    """Members appear without stays; a review rejection counts inside its direction."""
    report = compute_flow(CARDS, COLUMNS, CALENDARS, OPTIONS)
    flow = direction_flow(
        report,
        CARDS,
        CALENDARS,
        OPTIONS,
        columns=COLUMNS,
        statuses={2, 3},
        members={6, 8},
        wip_limits={2: 1},
    )
    assert [column.time.status_id for column in flow.columns] == [2, 3]
    assert flow.columns[0].wip_limit == 1
    assert flow.passed == 2
    assert [(move.from_status, move.to_status) for move in flow.returned] == [(3, 2)]
    assert flow.sent_back == []
    backend = direction_flow(
        report,
        CARDS,
        CALENDARS,
        OPTIONS,
        columns=COLUMNS,
        statuses={2},
        members=set(),
        wip_limits={},
    )
    assert [(move.from_status, move.to_status) for move in backend.returned] == [(3, 2)]
    review = direction_flow(
        report,
        CARDS,
        CALENDARS,
        OPTIONS,
        columns=COLUMNS,
        statuses={3},
        members=set(),
        wip_limits={},
    )
    assert [(move.from_status, move.to_status) for move in review.sent_back] == [(3, 2)]
    people = {person.user_id: person for person in flow.people}
    assert people[8].stays == 0
    assert people[8].member
    assert not people[7].member
    assert sum(person.share or 0 for person in flow.people) == pytest.approx(1)


def test_rework_entry_is_not_a_quality_charge_to_the_triage_role() -> None:
    """Triage is load for dev lead; backend receives the routed return."""
    columns = [
        Column(1, "STAGING", "#999", 1, "work"),
        Column(2, "REWORK", "#999", 2, "work"),
        Column(3, "BACKEND", "#999", 3, "work"),
        Column(4, "DONE", "#999", 4, "done"),
    ]
    item = Card(
        item_id=1,
        ref=1,
        subject="Failed acceptance",
        created_at=START,
        status_id=3,
        is_deleted=False,
        steps=(
            Step(START, "create", None, 1, 5),
            Step(START + timedelta(days=1), "move", 1, 2, 5),
            Step(START + timedelta(days=2), "move", 2, 3, 5),
        ),
        assignees=frozenset({6}),
        assignments=((START, frozenset({6})),),
    )
    chosen = FlowOptions(
        now=START + timedelta(days=5),
        since=None,
        working_days=False,
        returns=ReturnRules(marked=frozenset({(1, 2), (2, 3)})),
    )
    report = compute_flow([item], columns, CALENDARS, chosen)
    triage = direction_flow(
        report,
        [item],
        CALENDARS,
        chosen,
        columns=columns,
        statuses={1, 2},
        members={5},
        wip_limits={},
    )
    backend = direction_flow(
        report,
        [item],
        CALENDARS,
        chosen,
        columns=columns,
        statuses={3},
        members={6},
        wip_limits={},
    )
    assert report.back_moves.rework_entries == 1
    assert report.back_moves.rework_routes == 1
    assert triage.returned == []
    assert all(person.returns == 0 for person in triage.people)
    assert [(move.from_status, move.to_status) for move in backend.returned] == [(2, 3)]


def test_roles_page_needs_its_permission(
    client: TestClient, member: TestClient, services: Services
) -> None:
    """Owners see directions; members only once the Roles page is allowed."""
    assert client.get("/api/projects/alpha/directions").json()[0]["name"] == "Back"
    assert member.get("/api/projects/alpha/directions").status_code == 403
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["directions"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/directions/40").status_code == 200
    flow_data = services.flow_data
    assert isinstance(flow_data, FakeFlowData)
    assert flow_data.requests[-1] == {"direction": [1], "members": [6]}
    assert member.get("/api/projects/alpha/directions/99").status_code == 404


def test_directions_summary_does_not_require_project_overview(
    client: TestClient, member: TestClient
) -> None:
    """A role allowed Directions can load its list without seeing Overview."""
    assert member.get("/api/projects/alpha/directions/summary").status_code == 403
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["directions"], "scope": "all"},
        headers=HEADERS,
    )
    response = member.get("/api/projects/alpha/directions/summary")
    assert response.status_code == 200
    assert [row["name"] for row in response.json()] == ["Back"]
    assert member.get("/api/projects/alpha/analysis").status_code == 403


def test_activity_can_be_narrowed_to_a_role(client: TestClient, services: Services) -> None:
    """The members of the role are the only people counted."""
    client.get("/api/projects/alpha/activity", params={"role": 40})
    people = services.people
    assert isinstance(people, FakePeople)
    assert people.user_limits[-1] == [6]
