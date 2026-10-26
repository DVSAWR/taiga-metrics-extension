"""Tests for person pages: who may open them and what they are built from."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.auth.access import superuser_names
from taiga_metrics.people import kind_of, parse_key
from tests.conftest import HEADERS
from tests.fakes import FakePeople, FakeProjects

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services


def test_own_page_requires_its_tab(member: TestClient, client: TestClient) -> None:
    """The My page checkbox controls access to the member's own page."""
    assert member.get("/api/projects/alpha/people/6").status_code == 404
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["my_page"], "scope": "all"},
        headers=HEADERS,
    )
    page = member.get("/api/projects/alpha/people/6").json()
    assert page["profile"]["username"] == "beta"
    assert page["values"]["closed_tasks"] == 4
    assert page["highest"]["closed_bugs"] == 2
    assert member.get("/api/projects/alpha/people/6/flow").status_code == 200
    activity = member.get("/api/projects/alpha/people/6/activity").json()
    assert [event["kind"] for event in activity["events"]] == ["move"]


def test_other_pages_need_the_permission(member: TestClient, client: TestClient) -> None:
    """Someone else's page is unknown until the role may open other people's pages."""
    assert member.get("/api/projects/alpha/people/5").status_code == 404
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["people"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/people/5").status_code == 200


def test_own_scope_limits_activity_on_other_pages(
    member: TestClient, client: TestClient, services: Services
) -> None:
    """A member limited to own cards sees others' activity only on those cards."""
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["people"], "scope": "own"},
        headers=HEADERS,
    )
    member.get("/api/projects/alpha/people/6/activity")
    member.get("/api/projects/alpha/people/5/activity")
    people = services.people
    assert isinstance(people, FakePeople)
    assert people.card_limits[0] is None
    assert people.card_limits[1] is not None


def test_unknown_people_are_not_found(client: TestClient) -> None:
    """Someone who never took part in the project has no page."""
    assert client.get("/api/projects/alpha/people/99").status_code == 404


def test_entries_get_one_kind() -> None:
    """Create and delete first, then moves, assignees, comments, and edits."""
    assert kind_of(2, [], commented=False, deleted=False) == "create"
    assert kind_of(3, [], commented=False, deleted=False) == "delete"
    assert kind_of(1, ["status", "kanban_order"], commented=False, deleted=False) == "move"
    assert kind_of(1, ["assigned_users"], commented=False, deleted=False) == "assign"
    assert kind_of(1, [], commented=True, deleted=False) == "comment"
    assert kind_of(1, [], commented=True, deleted=True) is None
    assert kind_of(1, ["subject"], commented=False, deleted=False) == "edit"
    assert kind_of(1, ["kanban_order"], commented=False, deleted=False) is None


def test_history_keys_name_cards_or_other_things() -> None:
    """Cards get their type and id; wiki pages and sprints a label."""
    assert parse_key("tasks.task:7") == ("task", 7, None)
    assert parse_key("wiki.wikipage:3") == (None, None, "Wiki page")


def test_extension_superusers_are_read_from_a_list() -> None:
    """Names are trimmed and compared ignoring case."""
    assert superuser_names(" Dagruzdev, ,alpha") == frozenset({"dagruzdev", "alpha"})


def test_team_activity_is_part_of_flow_metrics(client: TestClient, member: TestClient) -> None:
    """Everyone's activity per day comes with the Flow metrics page."""
    activity = client.get("/api/projects/alpha/activity").json()
    assert activity["total"] == 3
    assert activity["days"][0]["people"] == {"5": 2, "6": 1}
    assert member.get("/api/projects/alpha/activity").status_code == 403


def test_team_events_name_who_did_what(client: TestClient, member: TestClient) -> None:
    """The actions behind the counts come with their author, filtered by kind."""
    events = client.get("/api/projects/alpha/activity/events").json()
    assert events["events"][0]["user_name"] == "Alpha"
    assert events["events"][0]["kind"] == "move"
    assert client.get("/api/projects/alpha/activity/events?kind=comment").json()["total"] == 0
    assert member.get("/api/projects/alpha/activity/events").status_code == 403


def test_sprints_need_taigas_scrum_module(client: TestClient, services: Services) -> None:
    """With Scrum off in Taiga the project's sprints are not offered."""
    assert client.get("/api/projects/alpha/sprints").json() != []
    projects = services.projects
    assert isinstance(projects, FakeProjects)
    projects.scrum_off.add(2)
    assert client.get("/api/projects/alpha/sprints").json() == []


def test_share_needs_the_person_page(member: TestClient, client: TestClient) -> None:
    """The share follows the explicit My page or People permission."""
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["my_page"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/people/6/share").json()["role_id"] == 40
    assert member.get("/api/projects/alpha/people/5/share").status_code == 404


def test_owners_set_responsible_roles(client: TestClient, member: TestClient) -> None:
    """Roles of other projects are dropped; members cannot change them."""
    response = client.put(
        "/api/projects/alpha/columns/userstory/1/roles",
        json={"role_ids": [40, 99]},
        headers=HEADERS,
    )
    assert response.status_code == 204
    columns = client.get("/api/projects/alpha/columns").json()[0]["columns"]
    assert columns[0]["roles"] == [40]
    assert (
        member.put(
            "/api/projects/alpha/columns/userstory/1/roles",
            json={"role_ids": []},
            headers=HEADERS,
        ).status_code
        == 403
    )
    assert client.get("/api/projects/alpha/roles").json()[0]["name"] == "Back"
