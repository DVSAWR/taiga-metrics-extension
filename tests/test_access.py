"""Tests for who may see what, both the rules and the API that enforces them."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.auth.access import (
    FULL_ACCESS,
    NO_ACCESS,
    ProjectAccess,
    RolePermission,
    Viewer,
    project_access,
)
from tests.conftest import HEADERS

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

MEMBER = Viewer(user_id=6, username="m", full_name="", email="", is_superuser=False, roles={2: 40})


def test_superusers_and_owners_see_everything() -> None:
    """Superusers see every project, owners their own."""
    superuser = Viewer(user_id=1, username="a", full_name="", email="", is_superuser=True)
    owner = Viewer(
        user_id=5,
        username="o",
        full_name="",
        email="",
        is_superuser=False,
        owned_projects=frozenset({2}),
    )
    assert project_access(superuser, 9, {}) == FULL_ACCESS
    assert project_access(owner, 2, {}) == FULL_ACCESS
    assert project_access(owner, 3, {}) == NO_ACCESS


def test_project_admins_manage_their_project() -> None:
    """A Taiga admin of a project sees and configures it like the owner."""
    admin = Viewer(
        user_id=7,
        username="ad",
        full_name="",
        email="",
        is_superuser=False,
        roles={2: 40, 3: 40},
        admin_projects=frozenset({2}),
    )
    assert project_access(admin, 2, {}) == FULL_ACCESS
    assert project_access(admin, 3, {}) == ProjectAccess(frozenset(), "all", can_manage=False)


def test_members_see_only_their_own_page_until_allowed() -> None:
    """A role without stored permissions sees the project, but no page of it."""
    access = project_access(MEMBER, 2, {})
    assert access.visible
    assert access.pages == frozenset()
    assert not access.can_manage


def test_members_see_what_their_role_allows() -> None:
    """The stored pages and scope of the member's role apply."""
    access = project_access(MEMBER, 2, {40: RolePermission(frozenset({"overview"}), "own")})
    assert access.visible
    assert access.allows("overview")
    assert not access.allows("cards", "directions")
    assert access.scope == "own"


def test_non_members_do_not_see_the_project() -> None:
    """Permissions of a role do not leak to people outside the project."""
    assert (
        project_access(MEMBER, 3, {40: RolePermission(frozenset({"overview"}), "all")})
        == NO_ACCESS
    )


def test_member_sees_only_own_page_until_owner_allows(
    member: TestClient, client: TestClient
) -> None:
    """The owner enables User stories for Back; the member then sees only own cards."""
    assert [project["access"]["pages"] for project in member.get("/api/projects").json()] == [[]]
    assert member.get("/api/projects/alpha/transitions").status_code == 403

    response = client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["overview"], "scope": "own"},
        headers=HEADERS,
    )
    assert response.status_code == 200

    projects = member.get("/api/projects").json()
    assert [project["access"]["pages"] for project in projects] == [["overview"]]
    rows = member.get("/api/projects/alpha/transitions").json()["rows"]
    assert [row["history_id"] for row in rows] == ["h1"]
    assert member.get("/api/projects/alpha/cards").status_code == 403
    assert (
        member.get("/api/projects/alpha/analysis", params={"scope": "role:40"}).status_code == 403
    )


def test_access_settings_are_for_owners_only(client: TestClient, member: TestClient) -> None:
    """Owners read and change settings; members cannot, even once they see the project."""
    settings = client.get("/api/projects/alpha/access").json()
    assert [role["name"] for role in settings["roles"]] == ["Back", "Front"]
    assert [page["key"] for page in settings["pages"]] == [
        "overview",
        "directions",
        "people",
        "my_page",
        "trends",
        "activity",
        "cards",
    ]
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["directions"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/access").status_code == 403
    assert (
        member.put(
            "/api/projects/alpha/access/40",
            json={"pages": ["overview", "cards", "directions"], "scope": "all"},
            headers=HEADERS,
        ).status_code
        == 403
    )


def test_unknown_role_is_rejected(client: TestClient) -> None:
    """Only roles of the project can be configured."""
    response = client.put(
        "/api/projects/alpha/access/99", json={"pages": [], "scope": "all"}, headers=HEADERS
    )
    assert response.status_code == 404


def test_trends_and_activity_are_separate_tabs(client: TestClient, member: TestClient) -> None:
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["trends"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/flow").status_code == 200
    assert member.get("/api/projects/alpha/activity").status_code == 403
    assert member.get("/api/projects/alpha/analysis").status_code == 403
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["activity"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/activity").status_code == 200
    assert member.get("/api/projects/alpha/flow").status_code == 403
