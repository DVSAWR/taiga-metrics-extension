"""Tests for the health endpoint."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.fakes import REPORT

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_status_is_served_to_project_managers(client: TestClient, admin: TestClient) -> None:
    """The owner and superusers get the report, without counts of the whole instance."""
    expected = REPORT.model_copy(
        update={"taiga": REPORT.taiga.model_copy(update={"counts": None})}
    ).model_dump(mode="json")
    for viewer in (client, admin):
        response = viewer.get("/api/projects/alpha/status")
        assert response.status_code == 200
        assert response.json() == expected


def test_status_is_hidden_from_members(member: TestClient) -> None:
    """Members without management rights do not even see that it exists."""
    assert member.get("/api/projects/alpha/status").status_code == 404


def test_report_is_healthy_only_when_everything_is() -> None:
    """A single failing part makes the report unhealthy."""
    assert REPORT.healthy
    writable = REPORT.model_copy(
        update={"taiga": REPORT.taiga.model_copy(update={"read_only": False})}
    )
    assert not writable.healthy
    outdated = REPORT.model_copy(
        update={"metrics_db": REPORT.metrics_db.model_copy(update={"up_to_date": False})}
    )
    assert not outdated.healthy
