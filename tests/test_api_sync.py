"""Tests for the sync and transitions endpoints."""

from __future__ import annotations

from fastapi.testclient import TestClient

from taiga_metrics.api.app import create_app
from taiga_metrics.settings import Settings
from tests.conftest import HEADERS
from tests.fakes import fake_services


def test_transitions_of_known_project(client: TestClient) -> None:
    """Transitions come back newest first as stored."""
    response = client.get("/api/projects/alpha/transitions")
    assert response.status_code == 200
    assert [row["history_id"] for row in response.json()["rows"]] == ["h2", "h1"]
    assert response.json()["has_more"] is False


def test_transitions_are_paged(client: TestClient) -> None:
    """``offset`` and ``limit`` walk the log and tell whether more is left."""
    first = client.get("/api/projects/alpha/transitions", params={"limit": 1}).json()
    second = client.get("/api/projects/alpha/transitions", params={"limit": 1, "offset": 1}).json()
    assert [row["history_id"] for row in first["rows"]] == ["h2"]
    assert first["has_more"] is True
    assert [row["history_id"] for row in second["rows"]] == ["h1"]
    assert second["has_more"] is False


def test_transitions_outside_the_period_are_left_out(client: TestClient) -> None:
    """Only days from ``from`` to ``to`` are listed."""
    before = client.get("/api/projects/alpha/transitions", params={"to": "2026-09-24"}).json()
    during = client.get(
        "/api/projects/alpha/transitions", params={"from": "2026-09-25", "to": "2026-09-25"}
    ).json()
    assert before["rows"] == []
    assert len(during["rows"]) == 2


def test_transitions_filtered_by_item_type(client: TestClient) -> None:
    """``item_type`` narrows the list."""
    response = client.get("/api/projects/alpha/transitions", params={"item_type": "userstory"})
    assert [row["item_type"] for row in response.json()["rows"]] == ["userstory"]


def test_unknown_item_type_is_rejected(client: TestClient) -> None:
    """Only user stories, tasks, issues, and epics exist."""
    response = client.get("/api/projects/alpha/transitions", params={"item_type": "wiki"})
    assert response.status_code == 422


def test_unknown_project_is_not_found(client: TestClient) -> None:
    """A project missing from the synced data is a 404."""
    assert client.get("/api/projects/nope/transitions").status_code == 404


def test_manual_sync_is_accepted_once(client: TestClient) -> None:
    """A second request while the first is running is not accepted."""
    first = client.post("/api/projects/alpha/sync", headers=HEADERS)
    second = client.post("/api/projects/alpha/sync", headers=HEADERS)
    assert first.status_code == 202
    assert first.json() == {"accepted": True}
    assert second.json() == {"accepted": False}


def test_sync_shows_only_the_project(client: TestClient, admin: TestClient) -> None:
    """Owners and superusers alike see the volumes of this project only."""
    for viewer in (client, admin):
        assert viewer.get("/api/projects/alpha/sync/runs").json() == []
        summary = viewer.get("/api/projects/alpha/sync/summary").json()
        assert [project["slug"] for project in summary["projects"]] == ["alpha"]


def test_members_cannot_sync(member: TestClient) -> None:
    """Only owners, admins, and superusers start syncs or see them."""
    assert member.post("/api/projects/alpha/sync", headers=HEADERS).status_code == 403
    assert member.get("/api/projects/alpha/sync/summary").status_code == 403


def test_config_is_public_and_trims_the_taiga_url() -> None:
    """Links to Taiga are built from this address, even before sign-in."""
    settings = Settings(taiga_url="https://taiga.example.com/sub/")
    with TestClient(create_app(settings, fake_services())) as anonymous:
        assert anonymous.get("/api/config").json() == {
            "taiga_url": "https://taiga.example.com/sub",
            "community_url": "https://community.taiga.io/",
            "repository_url": "https://github.com/DVSAWR/taiga-metrics-extension",
        }
