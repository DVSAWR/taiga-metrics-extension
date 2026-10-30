"""Tests for turning Taiga history entries into transitions and assignments.

The entries mirror real rows observed in Taiga 6.9's ``history_historyentry``.
"""

from __future__ import annotations

from dataclasses import replace
from datetime import UTC, datetime
from typing import Any

import pytest

from taiga_metrics.sync.history import (
    CHANGE,
    CREATE,
    DELETE,
    HistoryEntry,
    decode_json,
    parse_entry,
    parse_key,
)

MOMENT = datetime(2026, 9, 25, 10, 48, tzinfo=UTC)


def entry(
    key: str,
    type_: int,
    *,
    diff: dict[str, Any] | None = None,
    snapshot: dict[str, Any] | None = None,
    values: dict[str, Any] | None = None,
    user: dict[str, Any] | None = None,
) -> HistoryEntry:
    """A history entry with sensible defaults."""
    return HistoryEntry(
        id="h1",
        key=key,
        type=type_,
        user=user if user is not None else {"pk": 6, "name": "asdf"},
        created_at=MOMENT,
        project_id=1,
        diff=diff or {},
        snapshot=snapshot,
        values=values or {"users": {}},
    )


def test_keys_of_work_items_are_parsed() -> None:
    """User stories, tasks, issues, and epics are work items."""
    assert parse_key("userstories.userstory:12") == ("userstory", 12)
    assert parse_key("tasks.task:3") == ("task", 3)
    assert parse_key("issues.issue:1") == ("issue", 1)
    assert parse_key("epics.epic:1") == ("epic", 1)
    assert parse_key("milestones.milestone:2") is None
    assert parse_key("userstories.userstory:abc") is None


def test_entries_about_other_objects_are_ignored() -> None:
    """A project change carries nothing for flow metrics."""
    parsed = parse_entry(entry("projects.project:1", CHANGE, diff={"name": ["a", "b"]}))
    assert parsed.transition is None
    assert parsed.assignment is None
    assert parsed.deleted_item is None


def test_creation_takes_status_and_assignees_from_snapshot() -> None:
    """Creation entries have an empty diff; the initial state is in the snapshot."""
    parsed = parse_entry(
        entry(
            "userstories.userstory:1",
            CREATE,
            snapshot={"status": 1, "assigned_to": 5, "assigned_users": [7, 5]},
        )
    )
    assert parsed.transition is not None
    assert parsed.transition.kind == "create"
    assert parsed.transition.from_status_id is None
    assert parsed.transition.to_status_id == 1
    assert parsed.assignment is not None
    assert parsed.assignment.assignee_ids == (5, 7)


def test_task_creation_uses_the_single_assignee() -> None:
    """Tasks and issues have no ``assigned_users``."""
    parsed = parse_entry(
        entry("tasks.task:4", CREATE, snapshot={"status": 2, "assigned_to": None})
    )
    assert parsed.assignment is not None
    assert parsed.assignment.assignee_ids == ()


def test_move_records_both_statuses_with_names() -> None:
    """Names are the ones Taiga recorded at the moment of the move."""
    parsed = parse_entry(
        entry(
            "userstories.userstory:3",
            CHANGE,
            diff={"status": [3, 2], "kanban_order": [1, 5]},
            values={"users": {}, "status": {"2": "Ready", "3": "In progress"}},
        )
    )
    transition = parsed.transition
    assert transition is not None
    assert (transition.kind, transition.from_status_id, transition.to_status_id) == ("move", 3, 2)
    assert (transition.from_status_name, transition.to_status_name) == ("In progress", "Ready")
    assert (transition.user_id, transition.user_name) == (6, "asdf")
    assert parsed.assignment is None


def test_move_to_the_same_status_is_not_a_transition() -> None:
    """A diff that does not change the status is ignored."""
    assert parse_entry(entry("tasks.task:1", CHANGE, diff={"status": [2, 2]})).transition is None


def test_user_story_assignees_come_from_assigned_users() -> None:
    """The full new set is kept, not only the main assignee."""
    parsed = parse_entry(
        entry("userstories.userstory:3", CHANGE, diff={"assigned_users": [[], [6, 5, 7]]})
    )
    assert parsed.assignment is not None
    assert parsed.assignment.assignee_ids == (5, 6, 7)
    assert parsed.transition is None


def test_task_unassignment_is_an_empty_set() -> None:
    """Removing the assignee of a task yields no assignees."""
    parsed = parse_entry(entry("tasks.task:5", CHANGE, diff={"assigned_to": [6, None]}))
    assert parsed.assignment is not None
    assert parsed.assignment.assignee_ids == ()


def test_legacy_user_story_assigned_to_is_used_when_alone() -> None:
    """Entries written before multiple assignees only have ``assigned_to``."""
    parsed = parse_entry(entry("userstories.userstory:9", CHANGE, diff={"assigned_to": [None, 4]}))
    assert parsed.assignment is not None
    assert parsed.assignment.assignee_ids == (4,)


def test_deletion_records_last_status_and_identity() -> None:
    """A deleted item keeps its reference and subject from the deletion snapshot."""
    parsed = parse_entry(
        entry("tasks.task:3", DELETE, snapshot={"status": 2, "ref": 8, "subject": "ewer"})
    )
    assert parsed.transition is not None
    assert parsed.transition.kind == "delete"
    assert (parsed.transition.from_status_id, parsed.transition.to_status_id) == (2, None)
    assert parsed.deleted_item is not None
    assert (parsed.deleted_item.ref, parsed.deleted_item.subject) == (8, "ewer")
    assert parsed.deleted_item.deleted_at == MOMENT


def test_entry_without_user_keeps_an_empty_name() -> None:
    """System changes have no user."""
    parsed = parse_entry(
        entry("tasks.task:1", CHANGE, diff={"status": [1, 2]}, user={"pk": None, "name": ""})
    )
    assert parsed.transition is not None
    assert (parsed.transition.user_id, parsed.transition.user_name) == (None, "")


def test_json_is_decoded_from_text_or_kept() -> None:
    """Drivers may return JSON columns as text."""
    assert decode_json('{"status": [1, 2]}') == {"status": [1, 2]}
    assert decode_json({"status": [1, 2]}) == {"status": [1, 2]}
    assert decode_json(None) is None


@pytest.mark.parametrize(
    "diff,commented,deleted,hidden,expected",
    [
        ({"subject": ["old", "new"]}, False, False, False, True),
        ({}, True, False, False, True),
        ({}, True, True, False, False),
        ({"subject": ["old", "new"]}, True, True, False, True),
        ({"kanban_order": [1, 2]}, False, False, False, False),
        ({"kanban_order": [1, 2]}, True, False, False, True),
        ({"status": [1, 2]}, False, False, True, False),
        ({}, False, False, False, False),
    ],
)
def test_activity_counts_comments_and_edits_but_ignores_hidden_order_changes(
    diff: dict[str, Any], commented: bool, deleted: bool, hidden: bool, expected: bool
) -> None:
    """Idle uses the same visible activity definition as the activity feed."""
    value = replace(
        entry("tasks.task:1", CHANGE, diff=diff),
        commented=commented,
        comment_deleted=deleted,
        is_hidden=hidden,
    )
    assert value.is_activity is expected
