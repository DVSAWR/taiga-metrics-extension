"""Tests for column types and calendars configured by project owners."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.project_settings import normalize_days, valid_timezone
from tests.conftest import HEADERS

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_weekdays_are_normalized() -> None:
    """Out-of-range days and duplicates are dropped, the rest sorted."""
    assert normalize_days([5, 1, 1, 9, 0, 7]) == [1, 5, 7]


def test_time_zones_are_validated() -> None:
    """Only real IANA zones are accepted."""
    assert valid_timezone("Europe/Moscow")
    assert not valid_timezone("Mars/Olympus")


def test_owner_sets_and_clears_a_column_type(client: TestClient) -> None:
    """A type set on a column shows up, and clearing it removes it."""
    url = "/api/projects/alpha/columns/userstory/2"
    assert client.put(url, json={"type": "done"}, headers=HEADERS).status_code == 204
    columns = client.get("/api/projects/alpha/columns").json()[0]["columns"]
    assert [(c["name"], c["type"]) for c in columns] == [("New", None), ("Done", "done")]
    assert client.put(url, json={"type": None}, headers=HEADERS).status_code == 204
    assert client.get("/api/projects/alpha/columns").json()[0]["columns"][1]["type"] is None


def test_unknown_column_and_type_are_rejected(client: TestClient) -> None:
    """Columns must exist and types must be one of the four."""
    assert (
        client.put(
            "/api/projects/alpha/columns/userstory/99", json={"type": "done"}, headers=HEADERS
        ).status_code
        == 404
    )
    assert (
        client.put(
            "/api/projects/alpha/columns/userstory/1", json={"type": "later"}, headers=HEADERS
        ).status_code
        == 422
    )


def test_owner_changes_the_calendar(client: TestClient) -> None:
    """Time zone and weekdays are stored."""
    response = client.put(
        "/api/projects/alpha/calendar",
        json={"timezone": "Europe/Moscow", "working_days": [7, 1, 2, 3, 4]},
        headers=HEADERS,
    )
    assert response.status_code == 204
    calendar = client.get("/api/projects/alpha/calendar").json()
    assert calendar["timezone"] == "Europe/Moscow"
    assert calendar["working_days"] == [1, 2, 3, 4, 7]


def test_calendar_needs_a_real_zone_and_a_working_day(client: TestClient) -> None:
    """Nonsense is rejected before anything is stored."""
    url = "/api/projects/alpha/calendar"
    assert (
        client.put(
            url, json={"timezone": "Nowhere", "working_days": [1]}, headers=HEADERS
        ).status_code
        == 422
    )
    assert (
        client.put(url, json={"timezone": "UTC", "working_days": []}, headers=HEADERS).status_code
        == 422
    )


def test_member_gets_own_days_and_goes_back(client: TestClient) -> None:
    """A member can follow their own weekdays and return to the project's."""
    url = "/api/projects/alpha/calendar/members/6"
    assert client.put(url, json={"working_days": [2, 3]}, headers=HEADERS).status_code == 204
    members = client.get("/api/projects/alpha/calendar").json()["members"]
    assert members[0]["working_days"] == [2, 3]
    assert client.put(url, json={"working_days": None}, headers=HEADERS).status_code == 204
    assert client.get("/api/projects/alpha/calendar").json()["members"][0]["working_days"] is None
    assert (
        client.put(
            "/api/projects/alpha/calendar/members/7", json={"working_days": [1]}, headers=HEADERS
        ).status_code
        == 404
    )


def test_members_cannot_configure(client: TestClient, member: TestClient) -> None:
    """Even a member who sees the project cannot open its settings."""
    client.put(
        "/api/projects/alpha/access/40", json={"pages": ["flow"], "scope": "all"}, headers=HEADERS
    )
    assert member.get("/api/projects/alpha/columns").status_code == 403
    assert member.get("/api/projects/alpha/calendar").status_code == 403
    assert (
        member.put(
            "/api/projects/alpha/columns/userstory/1", json={"type": "work"}, headers=HEADERS
        ).status_code
        == 403
    )


def test_removed_columns_are_hidden_until_shown(client: TestClient) -> None:
    """The choice is kept per card type."""
    assert client.get("/api/projects/alpha/columns").json()[0]["show_removed"] is False
    url = "/api/projects/alpha/removed-columns/userstory"
    assert client.put(url, json={"show_removed": True}, headers=HEADERS).status_code == 204
    assert client.get("/api/projects/alpha/columns").json()[0]["show_removed"] is True
