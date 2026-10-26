"""Tests for returns: what counts, through pauses and triage, and whose work it was."""

from __future__ import annotations

from datetime import UTC, datetime, timedelta
from typing import TYPE_CHECKING

from taiga_metrics.metrics.engine import Card, Column, Step, intervals_of
from taiga_metrics.metrics.returns import ReturnRules, first_passes, returns_of
from tests.conftest import HEADERS

if TYPE_CHECKING:
    from fastapi.testclient import TestClient

START = datetime(2026, 9, 7, 9, tzinfo=UTC)
NOW = START + timedelta(days=60)
MISCLICK = timedelta(minutes=5)
BUILD, REVIEW, TEST, PAUSE, TRIAGE, DONE = 1, 2, 3, 4, 5, 6
COLUMNS = {
    column.status_id: column
    for column in (
        Column(BUILD, "Build", "#999", 1, "work"),
        Column(REVIEW, "Review", "#999", 2, "work"),
        Column(TEST, "Test", "#999", 3, "work"),
        Column(PAUSE, "Waiting", "#999", 4, "queue"),
        Column(TRIAGE, "Triage", "#999", 0, "work"),
        Column(DONE, "Done", "#999", 9, "done"),
    )
}


def card(*moves: tuple[float, int, int]) -> Card:
    """A card created in Build by 5 and assigned to 9, then moved as ``(day, column, by)``."""
    steps = [Step(START, "create", None, BUILD, 5)]
    previous = BUILD
    for day, column, user in moves:
        steps.append(Step(START + timedelta(days=day), "move", previous, column, user))
        previous = column
    return Card(
        item_id=1,
        ref=1,
        subject="Card",
        created_at=START,
        status_id=previous,
        is_deleted=False,
        steps=tuple(steps),
        assignees=frozenset({9}),
        assignments=((START, frozenset({9})),),
    )


def found(item: Card, rules: ReturnRules) -> list[tuple[int, int, int, frozenset[int]]]:
    """The returns of a card as ``(from, to, credited column, credited people)``."""
    return [
        (each.from_status, each.to_status, each.credited_status, each.credited)
        for each in returns_of(
            intervals_of(item, NOW), COLUMNS, rules, MISCLICK, item.assigned_before
        )
    ]


BOUNCED = card((1, REVIEW, 6), (2, TEST, 7), (3, BUILD, 8))


def test_a_move_to_an_earlier_column_is_a_return_unless_switched_off() -> None:
    """Test back to Build counts by default, and not when earlier moves do not count."""
    assert found(BOUNCED, ReturnRules()) == [(TEST, BUILD, BUILD, frozenset({9}))]
    assert found(BOUNCED, ReturnRules(earlier=False)) == []


def test_credit_goes_to_the_assignees_the_author_or_everyone_since() -> None:
    """Build was closed by 6, Review by 7: the author is 6, everyone since is 6 and 7."""
    assert found(BOUNCED, ReturnRules(credit="author"))[0][3] == frozenset({6})
    assert found(BOUNCED, ReturnRules(credit="everyone"))[0][3] == frozenset({6, 7})


def test_reglament_credit_uses_the_author_and_the_completed_review() -> None:
    """The reviewer's recorded move is evidence of review, not an assignment guess."""
    columns = {
        **COLUMNS,
        BUILD: Column(BUILD, "BACKEND", "#999", 1, "work"),
        REVIEW: Column(REVIEW, "BACKEND REVIEW", "#999", 2, "work"),
        TEST: Column(TEST, "PRODUCT ACCEPTANCE", "#999", 3, "work"),
        TRIAGE: Column(TRIAGE, "REWORK", "#999", 4, "work"),
    }
    item = card((1, REVIEW, 6), (2, TEST, 7), (3, TRIAGE, 8), (4, BUILD, 5))
    rules = ReturnRules(credit="author_reviewer")
    returns = returns_of(intervals_of(item, NOW), columns, rules, MISCLICK, item.assigned_before)
    assert [(found.from_status, found.to_status, found.credited) for found in returns] == [
        (TEST, TRIAGE, frozenset()),
        (TRIAGE, BUILD, frozenset({6, 7})),
    ]


def test_a_quick_rework_decision_still_records_the_direction_return() -> None:
    columns = {
        **COLUMNS,
        TEST: Column(TEST, "PRODUCT ACCEPTANCE", "#999", 3, "work"),
        TRIAGE: Column(TRIAGE, "REWORK", "#999", 4, "work"),
    }
    item = card((1, REVIEW, 6), (2, TEST, 7), (3, TRIAGE, 8), (3.001, BUILD, 5))
    rules = ReturnRules()
    returns = returns_of(intervals_of(item, NOW), columns, rules, MISCLICK, item.assigned_before)
    assert [(found.from_status, found.to_status) for found in returns] == [
        (TEST, TRIAGE),
        (TRIAGE, BUILD),
    ]


def test_only_acceptance_enters_rework_as_a_return() -> None:
    columns = {
        **COLUMNS,
        TEST: Column(TEST, "PRODUCT ACCEPTANCE", "#999", 3, "work"),
        TRIAGE: Column(TRIAGE, "REWORK", "#999", 4, "work"),
    }
    for name in ("EXPERTISE ACCEPTANCE", "PRODUCT ACCEPTANCE"):
        columns[TEST] = Column(TEST, name, "#999", 3, "work")
        item = card((1, TEST, 6), (2, TRIAGE, 7))
        intervals = intervals_of(item, NOW)
        found = returns_of(
            intervals,
            columns,
            ReturnRules(earlier=False),
            MISCLICK,
            item.assigned_before,
        )
        assert [(event.from_status, event.to_status) for event in found] == [(TEST, TRIAGE)]
        suppressed = returns_of(
            intervals,
            columns,
            ReturnRules(unmarked=frozenset({(TEST, TRIAGE)})),
            MISCLICK,
            item.assigned_before,
        )
        assert suppressed == []

    for name in ("UX REVIEW", "STAGING"):
        columns[TEST] = Column(TEST, name, "#999", 9, "work")
        item = card((1, TEST, 6), (2, TRIAGE, 7))
        assert (
            returns_of(
                intervals_of(item, NOW),
                columns,
                ReturnRules(),
                MISCLICK,
                item.assigned_before,
            )
            == []
        )


def test_ux_review_returns_directly_to_frontend() -> None:
    columns = {
        **COLUMNS,
        BUILD: Column(BUILD, "FRONTEND", "#999", 1, "work"),
        REVIEW: Column(REVIEW, "FRONTEND REVIEW", "#999", 2, "work"),
        TEST: Column(TEST, "UX REVIEW", "#999", 3, "work"),
    }
    item = card((1, REVIEW, 6), (2, TEST, 7), (3, BUILD, 8))
    found = returns_of(
        intervals_of(item, NOW),
        columns,
        ReturnRules(credit="author_reviewer"),
        MISCLICK,
        item.assigned_before,
    )
    assert [(event.from_status, event.to_status, event.credited) for event in found] == [
        (TEST, BUILD, frozenset({6, 7})),
    ]


def test_review_rejecting_work_credits_the_author_only() -> None:
    columns = {
        **COLUMNS,
        BUILD: Column(BUILD, "BACKEND", "#999", 1, "work"),
        REVIEW: Column(REVIEW, "BACKEND REVIEW", "#999", 2, "work"),
    }
    item = card((1, REVIEW, 6), (2, BUILD, 7))
    returns = returns_of(
        intervals_of(item, NOW),
        columns,
        ReturnRules(credit="author_reviewer"),
        MISCLICK,
        item.assigned_before,
    )
    assert [found.credited for found in returns] == [frozenset({6})]


def test_a_pause_is_seen_through() -> None:
    """A decision after waiting is not evidence that the prior work was defective."""
    paused = card((1, REVIEW, 6), (2, PAUSE, 7), (3, REVIEW, 8))
    assert found(paused, ReturnRules(pauses=frozenset({PAUSE}))) == []
    sent = card((1, REVIEW, 6), (2, PAUSE, 7), (3, BUILD, 8))
    assert found(sent, ReturnRules(pauses=frozenset({PAUSE}))) == []
    assert found(
        sent, ReturnRules(pauses=frozenset({PAUSE}), marked=frozenset({(REVIEW, BUILD)}))
    ) == [(REVIEW, BUILD, BUILD, frozenset({9}))]


def test_entering_a_decision_pause_does_not_complete_a_first_pass() -> None:
    rules = ReturnRules(pauses=frozenset({PAUSE}))
    waiting = card((1, REVIEW, 6), (2, PAUSE, 7))
    intervals = intervals_of(waiting, NOW)
    assert [entry.status_id for entry in first_passes(intervals, [], MISCLICK, rules.pauses)] == [
        BUILD
    ]
    back_to_review = card((1, REVIEW, 6), (2, PAUSE, 7), (3, REVIEW, 8), (4, TEST, 8))
    intervals = intervals_of(back_to_review, NOW)
    returns = returns_of(intervals, COLUMNS, rules, MISCLICK, back_to_review.assigned_before)
    passes = first_passes(intervals, returns, MISCLICK, rules.pauses)
    assert [(entry.status_id, entry.passed_at) for entry in passes] == [
        (BUILD, START + timedelta(days=1)),
        (REVIEW, START + timedelta(days=4)),
    ]


def test_a_triage_credits_where_the_card_goes_next() -> None:
    """Test back to Triage, then on to Review: Review's work did not pass."""
    triaged = card((1, REVIEW, 6), (2, TEST, 7), (3, TRIAGE, 8), (4, REVIEW, 5))
    assert found(triaged, ReturnRules(triage=frozenset({TRIAGE}), credit="author")) == [
        (TEST, TRIAGE, REVIEW, frozenset({7}))
    ]


def test_undoing_a_move_at_once_is_no_return() -> None:
    """Back from Test within a minute is a misclick."""
    quick = card((1, REVIEW, 6), (2, TEST, 7), (2 + 1 / 1440, REVIEW, 7))
    assert found(quick, ReturnRules()) == []


def test_a_first_pass_is_clean_until_work_comes_back() -> None:
    """Build's first pass came back, Review's did not; Test was left by a return and is
    still being worked on again, so it has no pass yet.
    """
    item = card((1, REVIEW, 6), (2, TEST, 7), (3, BUILD, 8), (4, REVIEW, 6), (5, TEST, 7))
    intervals = intervals_of(item, NOW)
    returns = returns_of(intervals, COLUMNS, ReturnRules(), MISCLICK, item.assigned_before)
    passes = {first.status_id: first.clean for first in first_passes(intervals, returns, MISCLICK)}
    assert passes == {BUILD: False, REVIEW: True}


def test_owners_set_the_return_rules(client: TestClient, member: TestClient) -> None:
    """The rules and the column modes are stored; members cannot change them."""
    rules = {"earlier": True, "out_of_done": False, "misclick_minutes": 10, "credit": "author"}
    assert (
        client.put(
            "/api/projects/alpha/returns/userstory", json=rules, headers=HEADERS
        ).status_code
        == 204
    )
    assert (
        client.put(
            "/api/projects/alpha/columns/userstory/1/return",
            json={"mode": "pause"},
            headers=HEADERS,
        ).status_code
        == 204
    )
    group = client.get("/api/projects/alpha/columns").json()[0]
    assert group["returns"] == rules
    assert group["columns"][0]["return_mode"] == "pause"
    assert (
        member.put(
            "/api/projects/alpha/returns/userstory", json=rules, headers=HEADERS
        ).status_code
        == 403
    )
    assert (
        client.put(
            "/api/projects/alpha/columns/userstory/99/return",
            json={"mode": "triage"},
            headers=HEADERS,
        ).status_code
        == 404
    )


def test_a_marked_move_overrides_the_rules() -> None:
    """Test to Build is no return when unmarked; Build to Review is one when marked."""
    assert found(BOUNCED, ReturnRules(unmarked=frozenset({(TEST, BUILD)}))) == []
    marked = found(BOUNCED, ReturnRules(earlier=False, marked=frozenset({(BUILD, REVIEW)})))
    assert [(each[0], each[1]) for each in marked] == [(BUILD, REVIEW)]


def test_owners_mark_moves(client: TestClient, member: TestClient) -> None:
    """The marked moves are stored per card type; members cannot change them."""
    pairs = {"pairs": [{"from_status": 2, "to_status": 1, "is_return": False}]}
    url = "/api/projects/alpha/returns/userstory/pairs"
    assert client.put(url, json=pairs, headers=HEADERS).status_code == 204
    group = client.get("/api/projects/alpha/columns").json()[0]
    assert group["return_pairs"] == pairs["pairs"]
    assert member.put(url, json=pairs, headers=HEADERS).status_code == 403
