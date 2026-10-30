"""Turning Taiga history entries into transition and assignment records.

Facts taken from history include activity timestamps, status changes (including the initial status
on creation and the last one on deletion), changes of the assignee set, and item
identity (reference and subject) for items that no longer exist in Taiga.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from typing import Any, Final

ITEM_TYPES: Final = {
    "userstories.userstory": "userstory",
    "tasks.task": "task",
    "issues.issue": "issue",
    "epics.epic": "epic",
}

CHANGE: Final = 1
CREATE: Final = 2
DELETE: Final = 3
ORDER_FIELDS: Final = frozenset(
    {"kanban_order", "sprint_order", "backlog_order", "us_order", "taskboard_order"}
)


@dataclass(frozen=True)
class HistoryEntry:
    """One row of Taiga's ``history_historyentry``, with JSON fields decoded."""

    id: str
    key: str
    type: int
    user: dict[str, Any]
    created_at: datetime
    project_id: int
    diff: dict[str, Any]
    snapshot: dict[str, Any] | None
    values: dict[str, Any]
    is_hidden: bool = False
    commented: bool = False
    comment_deleted: bool = False

    @property
    def is_activity(self) -> bool:
        """Whether the entry contains a visible change or a comment that still exists."""
        return not self.is_hidden and (
            self.type in (CREATE, DELETE)
            or bool(set(self.diff) - ORDER_FIELDS)
            or (self.commented and not self.comment_deleted)
        )


@dataclass(frozen=True)
class Transition:
    """An item entered a status: by creation, by a move, or left the board by deletion."""

    history_id: str
    item_type: str
    item_id: int
    project_id: int
    happened_at: datetime
    user_id: int | None
    user_name: str
    kind: str
    from_status_id: int | None
    to_status_id: int | None
    from_status_name: str | None
    to_status_name: str | None


@dataclass(frozen=True)
class Assignment:
    """The complete set of assignees of an item right after a change."""

    history_id: str
    item_type: str
    item_id: int
    project_id: int
    happened_at: datetime
    user_id: int | None
    user_name: str
    assignee_ids: tuple[int, ...]


@dataclass(frozen=True)
class DeletedItem:
    """Identity and deletion time of an item, from its deletion snapshot."""

    item_type: str
    item_id: int
    project_id: int
    ref: int | None
    subject: str
    deleted_at: datetime


@dataclass(frozen=True)
class Origin:
    """Which item an entry is about, when it happened, and who did it."""

    history_id: str
    item_type: str
    item_id: int
    project_id: int
    happened_at: datetime
    user_id: int | None
    user_name: str

    def transition(
        self,
        kind: str,
        from_status_id: int | None,
        to_status_id: int | None,
        values: dict[str, Any],
    ) -> Transition:
        """A transition from this origin, with status names resolved from ``values``."""
        return Transition(
            history_id=self.history_id,
            item_type=self.item_type,
            item_id=self.item_id,
            project_id=self.project_id,
            happened_at=self.happened_at,
            user_id=self.user_id,
            user_name=self.user_name,
            kind=kind,
            from_status_id=from_status_id,
            to_status_id=to_status_id,
            from_status_name=status_name(values, from_status_id),
            to_status_name=status_name(values, to_status_id),
        )

    def assignment(self, assignee_ids: tuple[int, ...]) -> Assignment:
        """An assignment from this origin."""
        return Assignment(
            history_id=self.history_id,
            item_type=self.item_type,
            item_id=self.item_id,
            project_id=self.project_id,
            happened_at=self.happened_at,
            user_id=self.user_id,
            user_name=self.user_name,
            assignee_ids=assignee_ids,
        )


@dataclass(frozen=True)
class ParsedEntry:
    """Everything extracted from one history entry."""

    transition: Transition | None = None
    assignment: Assignment | None = None
    deleted_item: DeletedItem | None = None


def decode_json(value: Any) -> Any:
    """JSON columns arrive either decoded or as text, depending on the driver setup."""
    if isinstance(value, str | bytes):
        return json.loads(value)
    return value


def parse_key(key: str) -> tuple[str, int] | None:
    """``'userstories.userstory:12'`` to ``('userstory', 12)``; ``None`` for other objects."""
    model, _, raw_id = key.partition(":")
    item_type = ITEM_TYPES.get(model)
    if item_type is None or not raw_id.isdigit():
        return None
    return item_type, int(raw_id)


def as_int(value: Any) -> int | None:
    """An id from a diff or snapshot, tolerating strings and empty values."""
    if isinstance(value, bool) or value is None or value == "":
        return None
    if isinstance(value, int):
        return value
    if isinstance(value, str) and value.lstrip("-").isdigit():
        return int(value)
    return None


def as_ids(value: Any) -> tuple[int, ...]:
    """A list of user ids, sorted and without duplicates or empty values."""
    if not isinstance(value, list):
        single = as_int(value)
        return () if single is None else (single,)
    return tuple(sorted({item for item in (as_int(raw) for raw in value) if item is not None}))


def status_name(values: dict[str, Any], status_id: int | None) -> str | None:
    """Status name as Taiga recorded it at the moment of the change."""
    if status_id is None:
        return None
    names = values.get("status")
    if isinstance(names, dict):
        name = names.get(str(status_id))
        return name if isinstance(name, str) else None
    return None


def snapshot_assignees(item_type: str, snapshot: dict[str, Any]) -> tuple[int, ...]:
    """Assignees in a full snapshot.

    User stories keep every assignee in ``assigned_users``; very old snapshots only have
    the single ``assigned_to``. Tasks and issues only ever have ``assigned_to``.
    """
    if item_type == "userstory" and "assigned_users" in snapshot:
        return as_ids(snapshot["assigned_users"])
    return as_ids(snapshot.get("assigned_to"))


def diff_assignees(item_type: str, diff: dict[str, Any]) -> tuple[int, ...] | None:
    """The new assignee set if this diff changed it, otherwise ``None``.

    A user story's ``assigned_to`` is a legacy field that Taiga no longer records; it is
    used only when an old entry has no ``assigned_users`` at all.
    """
    if item_type == "userstory" and "assigned_users" in diff:
        change = diff["assigned_users"]
    elif "assigned_to" in diff:
        change = diff["assigned_to"]
    else:
        return None
    if not isinstance(change, list) or len(change) != 2:
        return None
    return as_ids(change[1])


def parse_entry(entry: HistoryEntry) -> ParsedEntry:
    """Extract the transition, assignment, and deleted item carried by ``entry``."""
    parsed_key = parse_key(entry.key)
    if parsed_key is None:
        return ParsedEntry()
    item_type, item_id = parsed_key
    origin = Origin(
        history_id=entry.id,
        item_type=item_type,
        item_id=item_id,
        project_id=entry.project_id,
        happened_at=entry.created_at,
        user_id=as_int(entry.user.get("pk")),
        user_name=str(entry.user.get("name") or ""),
    )
    snapshot = entry.snapshot or {}

    if entry.type == CREATE:
        return ParsedEntry(
            transition=origin.transition(
                "create", None, as_int(snapshot.get("status")), entry.values
            ),
            assignment=origin.assignment(snapshot_assignees(item_type, snapshot)),
        )

    if entry.type == DELETE:
        return ParsedEntry(
            transition=origin.transition(
                "delete", as_int(snapshot.get("status")), None, entry.values
            ),
            deleted_item=DeletedItem(
                item_type=item_type,
                item_id=item_id,
                project_id=entry.project_id,
                ref=as_int(snapshot.get("ref")),
                subject=str(snapshot.get("subject") or ""),
                deleted_at=entry.created_at,
            ),
        )

    transition = None
    status_change = entry.diff.get("status")
    if isinstance(status_change, list) and len(status_change) == 2:
        from_status, to_status = as_int(status_change[0]), as_int(status_change[1])
        if from_status != to_status:
            transition = origin.transition("move", from_status, to_status, entry.values)
    assignees = diff_assignees(item_type, entry.diff)
    assignment = None if assignees is None else origin.assignment(assignees)
    return ParsedEntry(transition=transition, assignment=assignment)
