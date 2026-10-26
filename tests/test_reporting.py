"""Tests for reporting periods: Taiga's sprints, or a cadence cut by the extension."""

from __future__ import annotations

from datetime import date
from typing import TYPE_CHECKING

from taiga_metrics.reporting import Cadence, cadence_sprints
from tests.conftest import HEADERS
from tests.fakes import FakeProjects

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services


def test_a_cadence_cuts_equal_sprints_up_to_today() -> None:
    """Two-week sprints from 1 September: the third one is running on 30 September."""
    sprints = cadence_sprints(Cadence(weeks=2, start=date(2026, 9, 1)), date(2026, 9, 30))
    assert [(sprint.name, sprint.start, sprint.finish, sprint.closed) for sprint in sprints] == [
        ("Sprint 3", date(2026, 9, 29), date(2026, 10, 12), False),
        ("Sprint 2", date(2026, 9, 15), date(2026, 9, 28), True),
        ("Sprint 1", date(2026, 9, 1), date(2026, 9, 14), True),
    ]
    assert all(sprint.id < 0 for sprint in sprints)


def test_no_cadence_means_no_sprints() -> None:
    """Switched off, or starting in the future, there is nothing to offer."""
    assert cadence_sprints(Cadence(), date(2026, 9, 30)) == []
    assert cadence_sprints(Cadence(weeks=1, start=date(2026, 10, 5)), date(2026, 9, 30)) == []


def test_without_scrum_the_cadence_gives_the_sprints(
    client: TestClient, services: Services
) -> None:
    """Scrum off in Taiga: the owner's cadence replaces Taiga's sprints everywhere."""
    projects = services.projects
    assert isinstance(projects, FakeProjects)
    projects.scrum_off.add(2)
    assert client.get("/api/projects/alpha/sprints").json() == []
    assert not client.get("/api/projects").json()[0]["has_periods"]
    response = client.put(
        "/api/projects/alpha/reporting",
        json={"weeks": 2, "start": "2026-01-05"},
        headers=HEADERS,
    )
    assert response.status_code == 204
    names = [sprint["name"] for sprint in client.get("/api/projects/alpha/sprints").json()]
    assert names[-1] == "Sprint 1"
    assert client.get("/api/projects").json()[0]["has_periods"]
    settings = client.get("/api/projects/alpha/reporting").json()
    assert (settings["scrum"], settings["cadence"]["weeks"]) == (False, 2)


def test_with_scrum_taigas_sprints_win(client: TestClient) -> None:
    """Scrum on in Taiga: its sprints are used, whatever cadence is stored."""
    client.put(
        "/api/projects/alpha/reporting", json={"weeks": 1, "start": "2026-01-05"}, headers=HEADERS
    )
    sprints = client.get("/api/projects/alpha/sprints").json()
    assert sprints
    assert all(sprint["id"] > 0 for sprint in sprints)


def test_members_cannot_set_the_cadence(member: TestClient) -> None:
    """Only owners, admins, and superusers change reporting periods."""
    response = member.put(
        "/api/projects/alpha/reporting", json={"weeks": 2, "start": "2026-01-05"}, headers=HEADERS
    )
    assert response.status_code == 403
