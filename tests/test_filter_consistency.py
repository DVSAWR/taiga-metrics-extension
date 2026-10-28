"""The same card selection reaches every summary, activity count and drilldown."""

from __future__ import annotations

from typing import TYPE_CHECKING
from unittest.mock import AsyncMock
from urllib.parse import parse_qsl

import pytest

from taiga_metrics.filters import CardFacts, apply
from tests.conftest import HEADERS
from tests.fakes import FakePeople

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services
    from taiga_metrics.filters import Selection


FACTS = [
    CardFacts(
        "userstory",
        3,
        frozenset({6}),
        frozenset({40}),
        5,
        frozenset({9}),
        frozenset({"ux", "frontend"}),
        status_id=1,
        owner_role=30,
        swimlane_id=7,
    ),
    CardFacts(
        "task",
        4,
        frozenset({6}),
        frozenset({40}),
        5,
        frozenset(),
        frozenset({"ux"}),
        status_id=1,
        owner_role=30,
    ),
    CardFacts(
        "userstory",
        8,
        frozenset({6}),
        frozenset({40}),
        5,
        frozenset({9}),
        frozenset({"ux", "frontend", "blocked"}),
        status_id=1,
        owner_role=30,
        swimlane_id=7,
    ),
    CardFacts(
        "userstory",
        9,
        frozenset({5}),
        frozenset({30}),
        7,
        frozenset(),
        frozenset({"backend"}),
        status_id=2,
        owner_role=40,
    ),
]

SELECTIONS = [
    (["tag:ux", "tag:frontend"], ["tag:blocked"], [3]),
    (["tag:ux", "tag:frontend"], ["tag:frontend"], []),
    (["tag:missing"], [], []),
    ([], ["tag:ux"], [9]),
    (
        [
            "status:userstory.1",
            "swimlane:7",
            "assigned:6",
            "role:40",
            "created_by:5",
            "created_by_role:30",
            "epic:9",
            "tag:ux",
            "tag:frontend",
        ],
        ["tag:blocked"],
        [3],
    ),
]


@pytest.fixture
def matching(monkeypatch: pytest.MonkeyPatch, services: Services) -> None:
    """Use real filter matching against a small mixed-type card collection."""

    async def matching_keys(
        slug: str, item_type: str | None, selection: Selection, *, assignee: int | None = None
    ) -> list[tuple[str, int]]:
        cards = [
            card
            for card in FACTS
            if (item_type is None or card.item_type == item_type)
            and (assignee is None or assignee in card.assignees)
        ]
        return [(card.item_type, card.item_id) for card in apply(cards, selection)]

    monkeypatch.setattr(services.project_data, "matching_keys", matching_keys)


def params(include: list[str], exclude: list[str]) -> tuple[tuple[str, str], ...]:
    """Repeated query parameters, just as the filter panel sends them."""
    return (
        ("item_type", "userstory"),
        *[("include", value) for value in include],
        *[("exclude", value) for value in exclude],
    )


@pytest.mark.parametrize(("include", "exclude", "expected"), SELECTIONS)
@pytest.mark.parametrize(
    ("path", "method"),
    [
        ("people", "people_summary"),
        ("directions/summary", "directions_flow"),
        ("directions/40", "direction"),
        ("people/6/share", "person_share"),
        ("people/6/flow", "flow"),
        ("analysis", "flow"),
        ("scrum/status-times", "period_status_times"),
        ("scrum/stays?key=sprint-1&status_id=1", "period_stays"),
        ("scrum/finished?key=sprint-1", "period_finished"),
    ],
)
def test_every_summary_and_drilldown_receives_the_same_cards(
    *,
    matching: None,
    client: TestClient,
    services: Services,
    monkeypatch: pytest.MonkeyPatch,
    path: str,
    method: str,
    include: list[str],
    exclude: list[str],
    expected: list[int],
) -> None:
    """No endpoint can drop tags, exclusions, combined categories or an empty result."""
    original = getattr(services.flow_data, method)
    recorded = AsyncMock(wraps=original)
    monkeypatch.setattr(services.flow_data, method, recorded)
    route, _, query = path.partition("?")
    response = client.get(
        f"/api/projects/alpha/{route}", params=[*params(include, exclude), *parse_qsl(query)]
    )
    assert response.status_code == 200, response.text
    if route == "people/6/flow":
        expected = [
            item_id
            for item_id in expected
            if any(card.item_id == item_id and 6 in card.assignees for card in FACTS)
        ]
    assert recorded.call_args.kwargs["item_ids"] == expected


@pytest.mark.parametrize(("include", "exclude", "expected"), SELECTIONS)
@pytest.mark.parametrize("path", ["activity", "activity/events", "people/6/activity"])
def test_activity_heatmaps_counts_and_events_share_the_card_selection(
    *,
    matching: None,
    client: TestClient,
    services: Services,
    path: str,
    include: list[str],
    exclude: list[str],
    expected: list[int],
) -> None:
    """Activity's date and actor filters are combined with the common card filters."""
    response = client.get(f"/api/projects/alpha/{path}", params=params(include, exclude))
    assert response.status_code == 200, response.text
    people = services.people
    assert isinstance(people, FakePeople)
    assert people.card_limits[-1] == [("userstory", item_id) for item_id in expected]


@pytest.mark.parametrize(("include", "exclude", "expected"), SELECTIONS)
def test_personal_achievements_use_the_same_filtered_cards(
    *,
    matching: None,
    client: TestClient,
    services: Services,
    monkeypatch: pytest.MonkeyPatch,
    include: list[str],
    exclude: list[str],
    expected: list[int],
) -> None:
    """The achievements below a person's results cannot include unrelated cards."""
    recorded = AsyncMock(wraps=services.team.stats)
    monkeypatch.setattr(services.team, "stats", recorded)
    response = client.get("/api/projects/alpha/people/6", params=params(include, exclude))
    assert response.status_code == 200, response.text
    assert recorded.call_args.kwargs["cards"] == [("userstory", item_id) for item_id in expected]


def test_role_and_person_activity_filters_intersect(
    client: TestClient, services: Services
) -> None:
    """Opening one person's number within a role retains both constraints."""
    response = client.get("/api/projects/alpha/activity/events", params={"role": 40, "person": 5})
    assert response.status_code == 200
    people = services.people
    assert isinstance(people, FakePeople)
    assert people.user_limits[-1] == []


def test_card_filters_cannot_broaden_a_members_own_scope(
    matching: None,
    client: TestClient,
    member: TestClient,
    services: Services,
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An exclusion selecting somebody else's card still cannot expose it to the member."""
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["people"], "scope": "own"},
        headers=HEADERS,
    )
    recorded = AsyncMock(wraps=services.flow_data.people_summary)
    monkeypatch.setattr(services.flow_data, "people_summary", recorded)
    response = member.get("/api/projects/alpha/people", params=params([], ["tag:ux"]))
    assert response.status_code == 200
    assert recorded.call_args.kwargs["item_ids"] == []
