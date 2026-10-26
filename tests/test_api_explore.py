"""Tests for the members, card search, and card history endpoints."""

from __future__ import annotations

from typing import TYPE_CHECKING

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_cards_are_searched_by_text_and_type(client: TestClient) -> None:
    """The query and the type narrow the result."""
    by_text = client.get("/api/projects/alpha/cards", params={"q": "docs"}).json()
    assert [card["ref"] for card in by_text] == [10]
    by_type = client.get("/api/projects/alpha/cards", params={"item_type": "userstory"}).json()
    assert [card["ref"] for card in by_type] == [5]
    assert [a["name"] for a in by_type[0]["assignees"]] == ["qwer", "asdf"]


def test_card_events_of_known_card(client: TestClient) -> None:
    """Column and assignee changes come back in order."""
    events = client.get("/api/projects/alpha/cards/userstory/3/events").json()
    assert [event["kind"] for event in events] == ["create", "assign"]


def test_card_events_of_unknown_card(client: TestClient) -> None:
    """A card missing from the project is a 404."""
    assert client.get("/api/projects/alpha/cards/task/99/events").status_code == 404


def test_filter_panel_counts_matching_cards(client: TestClient) -> None:
    """The panel reports total and matching cards for the selection."""
    panel = client.get("/api/projects/alpha/filters", params=[("include", "assigned:6")]).json()
    assert panel["total"] == 2
    assert panel["matching"] == 1
    assert panel["categories"][0]["title"] == "Assigned to"


def test_search_respects_filters(client: TestClient) -> None:
    """Excluded assignees drop their cards from the search."""
    cards = client.get("/api/projects/alpha/cards", params=[("exclude", "assigned:6")]).json()
    assert [card["ref"] for card in cards] == [10]


def test_transitions_respect_filters(client: TestClient) -> None:
    """Only transitions of cards passing the filters are listed."""
    page = client.get("/api/projects/alpha/transitions", params=[("include", "assigned:5")]).json()
    assert [row["history_id"] for row in page["rows"]] == ["h1"]


def test_transitions_of_one_card(client: TestClient) -> None:
    """``item_id`` with ``item_type`` lists the transitions of that card only."""
    page = client.get(
        "/api/projects/alpha/transitions", params={"item_type": "task", "item_id": 4}
    ).json()
    assert [row["history_id"] for row in page["rows"]] == ["h2"]
    other = client.get(
        "/api/projects/alpha/transitions", params={"item_type": "task", "item_id": 3}
    ).json()
    assert other["rows"] == []


def test_swimlanes_come_with_limits_and_cards(client: TestClient) -> None:
    """Swimlanes list their limits per status and where each card is."""
    assert client.get("/api/projects/alpha/swimlanes").json() == {
        "lanes": [{"id": 7, "name": "Team A", "wip": {"1": 5}}],
        "cards": {"3": 7},
    }
    assert client.get("/api/projects/alpha/swimlanes", params={"item_type": "issue"}).json() == {
        "lanes": [],
        "cards": {},
    }


def test_sprints_are_listed_with_their_dates(client: TestClient) -> None:
    """Sprints come with names and planned dates."""
    assert client.get("/api/projects/alpha/sprints").json() == [
        {
            "id": 1,
            "name": "Sprint 1",
            "start": "2026-09-21",
            "finish": "2026-10-02",
            "closed": False,
        }
    ]
