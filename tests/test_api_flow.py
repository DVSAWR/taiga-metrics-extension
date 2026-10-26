"""Tests for the flow metrics endpoint."""

from __future__ import annotations

from datetime import UTC, datetime
from typing import TYPE_CHECKING

from taiga_metrics.comments import CardComment, CardComments, history_key
from taiga_metrics.filters import AssignmentFilter
from tests.conftest import HEADERS
from tests.fakes import FakeComments, FakeFlowData

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services


def last_request(services: Services) -> dict[str, object]:
    """What the flow endpoint asked the data layer for last."""
    flow = services.flow_data
    assert isinstance(flow, FakeFlowData)
    return flow.requests[-1]


def test_owner_gets_the_report_with_defaults(client: TestClient, services: Services) -> None:
    """User stories, all time, every card, nobody singled out."""
    response = client.get("/api/projects/alpha/flow")
    assert response.status_code == 200
    assert response.json()["report"]["configured"] is False
    assert last_request(services) == {
        "column": None,
        "project_id": 2,
        "item_type": "userstory",
        "since": None,
        "until": None,
        "item_ids": None,
        "people": None,
        "working": True,
    }


def test_period_runs_over_whole_days(client: TestClient, services: Services) -> None:
    """``from`` and ``to`` are both included."""
    client.get("/api/projects/alpha/flow", params={"from": "2026-09-01", "to": "2026-09-30"})
    request = last_request(services)
    assert request["since"] == datetime(2026, 9, 1, tzinfo=UTC)
    assert request["until"] == datetime(2026, 10, 1, tzinfo=UTC)


def test_a_column_can_be_asked_for(client: TestClient, services: Services) -> None:
    """``column`` is passed on to list the cards standing in it."""
    client.get("/api/projects/alpha/flow", params={"column": 5})
    assert last_request(services)["column"] == 5


def test_included_people_narrow_the_time(client: TestClient, services: Services) -> None:
    """Included assignees are passed on, so only their time is measured."""
    client.get("/api/projects/alpha/flow", params=[("include", "assigned:6")])
    assert last_request(services)["people"] == AssignmentFilter(people=frozenset({6}))


def test_filters_narrow_the_cards(client: TestClient, services: Services) -> None:
    """Only cards passing the filters are measured."""
    client.get("/api/projects/alpha/flow", params=[("include", "assigned:6")])
    assert last_request(services)["item_ids"] == [3]


def test_own_scope_measures_only_own_cards(
    client: TestClient, member: TestClient, services: Services
) -> None:
    """A member limited to own cards gets metrics of those cards only."""
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["overview"], "scope": "own"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/flow").status_code == 200
    assert last_request(services)["item_ids"] == [3]


def test_flow_needs_the_flow_page(client: TestClient, member: TestClient) -> None:
    """A role allowed only Search does not get flow metrics."""
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["cards"], "scope": "all"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/flow").status_code == 403


def test_card_flow_shows_where_the_time_went(client: TestClient) -> None:
    """One card: its stays and the time per column."""
    card = client.get("/api/projects/alpha/cards/userstory/3/flow")
    assert card.status_code == 200
    body = card.json()
    assert body["subject"] == "Login"
    assert [(total["status_id"], total["days"]) for total in body["report"]["columns"]] == [
        (1, 1.0)
    ]
    assert client.get("/api/projects/alpha/cards/userstory/99/flow").status_code == 404


def test_scrum_gives_time_in_statuses_per_period(client: TestClient, services: Services) -> None:
    """Each dated sprint comes back as a period with the stats of its stays."""
    response = client.get(
        "/api/projects/alpha/scrum/status-times",
        params={"item_type": "task", "by": "sprint", "pass_minutes": 10},
    )
    assert response.status_code == 200
    body = response.json()
    assert [period["label"] for period in body["periods"]] == ["Sprint 1"]
    assert body["cells"][0]["n"] == 2
    assert body["now"] == [{"status_id": 1, "cards": 1, "oldest_days": 3.0}]
    assert last_request(services) == {
        "item_type": "task",
        "sprints": [1],
        "kind": "sprint",
        "pass_minutes": 10,
        "item_ids": None,
    }


def test_scrum_lists_the_stays_of_one_cell(client: TestClient, services: Services) -> None:
    """A cell's stays come with the people, their roles and the role names."""
    response = client.get(
        "/api/projects/alpha/scrum/stays",
        params={"key": "sprint-1", "status_id": 1, "by": "week"},
    )
    assert response.status_code == 200
    body = response.json()
    assert [row["item_id"] for row in body["rows"]] == [3]
    assert body["roles"] == {"40": "Back"}
    assert last_request(services) == {"key": "sprint-1", "status_id": 1, "kind": "week"}


def test_scrum_lists_the_cards_finished_in_a_period(
    client: TestClient, services: Services
) -> None:
    """The Total chart can list the cards finished in one period."""
    response = client.get(
        "/api/projects/alpha/scrum/finished", params={"key": "sprint-1", "by": "sprint"}
    )
    assert response.status_code == 200
    body = response.json()
    assert [row["item_id"] for row in body["rows"]] == [3]
    assert body["rows"][0]["lead_days"] == 2.0
    assert last_request(services) == {"key": "sprint-1", "kind": "sprint", "finished": True}


def add_comment(services: Services, item_type: str, item_id: int, body: str) -> None:
    """Give a card of ``alpha`` one comment by ``asdf``."""
    comments = services.comments
    assert isinstance(comments, FakeComments)
    comments.by_card[(2, item_type, item_id)] = CardComments(
        comments=[
            CardComment(
                id="h1",
                created_at=datetime(2026, 9, 2, 10, tzinfo=UTC),
                edited_at=None,
                author_id=6,
                author_name="asdf",
                text=body,
            )
        ],
        usernames={6: "asdf"},
    )


def test_card_comments_come_with_their_authors(client: TestClient, services: Services) -> None:
    """The card page gets the card's comments and who wrote them."""
    add_comment(services, "userstory", 3, "Looks good")
    body = client.get("/api/projects/alpha/cards/userstory/3/comments").json()
    assert [(item["author_id"], item["text"]) for item in body["comments"]] == [(6, "Looks good")]
    assert body["usernames"] == {"6": "asdf"}
    assert client.get("/api/projects/alpha/cards/task/4/comments").json()["comments"] == []


def test_card_comments_follow_the_data_scope(
    client: TestClient, member: TestClient, services: Services
) -> None:
    """A member limited to own cards reads comments only on those cards."""
    add_comment(services, "task", 4, "Not yours")
    client.put(
        "/api/projects/alpha/access/40",
        json={"pages": ["overview"], "scope": "own"},
        headers=HEADERS,
    )
    assert member.get("/api/projects/alpha/cards/userstory/3/comments").status_code == 200
    assert member.get("/api/projects/alpha/cards/task/4/comments").status_code == 404


def test_comments_are_found_by_taiga_history_key() -> None:
    """Each card type maps to the key Taiga's history uses for it."""
    assert history_key("userstory", 3) == "userstories.userstory:3"
    assert history_key("task", 4) == "tasks.task:4"
    assert history_key("issue", 5) == "issues.issue:5"
    assert history_key("epic", 6) == "epics.epic:6"


def test_durations_can_count_every_day(client: TestClient, services: Services) -> None:
    """``days=calendar`` counts weekends too, for the flow and for one card."""
    assert client.get("/api/projects/alpha/flow", params={"days": "calendar"}).status_code == 200
    assert last_request(services)["working"] is False
    client.get("/api/projects/alpha/cards/userstory/3/flow", params={"days": "calendar"})
    assert last_request(services) == {"card": 3, "working": False}
    assert client.get("/api/projects/alpha/flow", params={"days": "hours"}).status_code == 422


def test_the_rest_of_people_is_everyone_else_on_the_same_cards(
    client: TestClient, services: Services
) -> None:
    """With a person in the filters, the rest is the time others were assigned."""
    client.get("/api/projects/alpha/flow", params=[("include", "assigned:6"), ("side", "rest")])
    request = last_request(services)
    assert request["people"] == AssignmentFilter(people=frozenset({6}), negated=True)
    assert request["item_ids"] == [3]


def test_the_rest_of_card_filters_is_every_other_card(
    client: TestClient, services: Services
) -> None:
    """Without people in the filters, the rest is the cards the filters drop."""
    client.get("/api/projects/alpha/flow", params=[("exclude", "assigned:6"), ("side", "rest")])
    request = last_request(services)
    assert request["people"] is None
    assert request["item_ids"] == [3]
    client.get("/api/projects/alpha/flow", params=[("side", "rest")])
    assert last_request(services)["item_ids"] == []
