"""Tests for the analysis of a subject and the People list."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from taiga_metrics.analysis import Subject
from taiga_metrics.directions import DirectionRef
from taiga_metrics.filters import AssignmentFilter
from taiga_metrics.metrics.engine import ReturnEvent
from taiga_metrics.metrics.quality import return_stats
from taiga_metrics.metrics.share import PersonShare
from tests.conftest import HEADERS
from tests.fakes import FakeFlowData

if TYPE_CHECKING:
    from collections.abc import Collection

    import pytest
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services
    from taiga_metrics.metrics.loader import Period


def test_subjects_are_parsed() -> None:
    """The project, a role, or a person; anything else is refused."""
    assert Subject.parse("project") == Subject(kind="project")
    assert Subject.parse("role:40") == Subject(kind="role", id=40)
    assert Subject.parse("person:6") == Subject(kind="person", id=6)
    assert Subject.parse("team:1") is None
    assert Subject.parse("role:x") is None


def test_the_project_splits_by_directions(client: TestClient) -> None:
    """The owner's project analysis lists the roles that answer for statuses."""
    analysis = client.get("/api/projects/alpha/analysis").json()
    assert analysis["subject"] == {"kind": "project", "id": None}
    assert [row["name"] for row in analysis["breakdown"]] == ["Back"]
    assert analysis["statuses"] is None


def test_a_direction_shows_only_its_statuses(client: TestClient) -> None:
    """A role's analysis is limited to its statuses and split by people."""
    analysis = client.get("/api/projects/alpha/analysis", params={"scope": "role:40"}).json()
    assert analysis["name"] == "Back"
    assert analysis["statuses"] == [1]
    assert (
        client.get("/api/projects/alpha/analysis", params={"scope": "role:9"}).status_code == 404
    )


def test_a_person_follows_the_person_page_rules(member: TestClient, client: TestClient) -> None:
    """Own analysis needs My page; someone else's needs the People section."""
    assert (
        member.get("/api/projects/alpha/analysis", params={"scope": "person:6"}).status_code == 404
    )
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["my_page"], "scope": "all"},
        headers=HEADERS,
    )
    own = member.get("/api/projects/alpha/analysis", params={"scope": "person:6"})
    assert own.status_code == 200
    assert own.json()["name"] == "Beta"
    assert own.json()["compared"] == [1]
    other = member.get("/api/projects/alpha/analysis", params={"scope": "person:5"})
    assert other.status_code == 404


def test_person_responsible_columns_include_every_role(
    client: TestClient, services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    """A person with several roles sees the union of their configured columns."""
    flow = services.flow_data
    assert isinstance(flow, FakeFlowData)

    async def directions(_project_id: int) -> list[DirectionRef]:
        return [
            DirectionRef(role_id=40, name="Back", columns={"userstory": [1]}, members=[6]),
            DirectionRef(role_id=41, name="Review", columns={"userstory": [2, 1]}, members=[6]),
        ]

    monkeypatch.setattr(flow, "directions", directions)
    response = client.get("/api/projects/alpha/analysis", params={"scope": "person:6"})
    assert response.status_code == 200
    assert response.json()["compared"] == [1, 2]


def test_person_analysis_cannot_inherit_another_assignee_filter(
    client: TestClient, services: Services
) -> None:
    """A selected colleague cannot add their time to the named person's analysis."""
    response = client.get(
        "/api/projects/alpha/analysis",
        params=[("scope", "person:6"), ("include", "assigned:5")],
    )
    assert response.status_code == 200
    flow = services.flow_data
    assert isinstance(flow, FakeFlowData)
    personal_flow = next(request for request in flow.requests if "people" in request)
    people = personal_flow["people"]
    assert isinstance(people, AssignmentFilter)
    assert people.people == frozenset({6})


def test_unknown_subjects_are_refused(client: TestClient) -> None:
    """A scope that is neither the project, a role, nor a person."""
    assert client.get("/api/projects/alpha/analysis", params={"scope": "x"}).status_code == 422


def test_personal_return_totals_and_drilldowns_share_the_attribution_rule(
    client: TestClient, services: Services, monkeypatch: pytest.MonkeyPatch
) -> None:
    """Returns credited after handover remain in both the totals and the personal list."""
    start = datetime(2026, 10, 1, tzinfo=UTC)
    events = [
        ReturnEvent(3, 5, "Login", start + timedelta(days=day), 4, status, status, frozenset({6}))
        for day, status in ((1, 2), (2, 3))
    ]

    async def person_share(
        project_id: int,
        item_type: str,
        user_id: int,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        every: bool = False,
    ) -> PersonShare:
        return PersonShare(
            **return_stats(event.item_id for event in events).model_dump(),
            role_id=40,
            columns=[],
            roles={},
            events=events,
        )

    monkeypatch.setattr(services.flow_data, "person_share", person_share)
    response = client.get("/api/projects/alpha/analysis", params={"scope": "person:6"})
    assert response.status_code == 200
    analysis = response.json()
    assert analysis["tiles"]["returns"] == 2
    assert analysis["tiles"]["returned_cards"] == 1
    assert analysis["tiles"]["repeat_returns"] == 1
    assert analysis["tiles"]["repeat_rate"] == 1
    assert len(analysis["flow"]["report"]["credited_returns"]) == 2
    assert analysis["flow"]["report"]["back_moves"]["events"] == []


def test_the_people_list_shows_others_only_with_the_people_section(
    client: TestClient, member: TestClient
) -> None:
    """A member sees only themselves until their role may see other people."""
    assert [row["user_id"] for row in member.get("/api/projects/alpha/people").json()] == [6]
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["people"], "scope": "all"},
        headers=HEADERS,
    )
    assert [row["user_id"] for row in member.get("/api/projects/alpha/people").json()] == [5, 6]
    assert len(client.get("/api/projects/alpha/people").json()) == 2
