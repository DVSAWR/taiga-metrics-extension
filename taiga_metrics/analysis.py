"""One analysis for every subject: the project, a direction, or a person.

Every screen answers the same questions about its subject over a period: what is in
progress and stuck, what got done and how fast, how much passed the first time and how
much came back, and how it splits one level down: the project by directions, a direction
by people, a person by the columns they worked in.

- The project counts every card.
- A direction counts the cards in its columns: done means passed through them, and its
  time is the time spent there.
- A person counts the time they were assigned, as the people filter does.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal

from pydantic import BaseModel, Field

from taiga_metrics.metrics.loader import FlowResponse
from taiga_metrics.metrics.quality import ReturnStats, return_stats

if TYPE_CHECKING:
    from collections.abc import Collection, Sequence

    from taiga_metrics.directions import DirectionFlow, DirectionRef
    from taiga_metrics.metrics.engine import FlowReport
    from taiga_metrics.metrics.share import ColumnShare

SubjectKind = Literal["project", "role", "person"]


class Subject(BaseModel):
    """What an analysis is about: the project, one role, or one person."""

    kind: SubjectKind
    id: int | None = None

    @classmethod
    def parse(cls, value: str) -> Subject | None:
        """``project``, ``role:<id>`` or ``person:<id>``; ``None`` for anything else."""
        if value == "project":
            return cls(kind="project")
        kind, _, raw = value.partition(":")
        if not raw.isdigit():
            return None
        if kind == "role":
            return cls(kind="role", id=int(raw))
        if kind == "person":
            return cls(kind="person", id=int(raw))
        return None


class Tiles(ReturnStats):
    """The key numbers of a subject over the period.

    For a direction ``finished`` counts the cards that passed through its columns and
    ``lead`` its time per stay there; it has no cycle time of its own.
    """

    in_progress: int
    stuck: int
    finished: int
    lead_p50: float | None
    lead_p85: float | None
    cycle_p50: float | None
    cycle_p85: float | None
    passes: int
    clean_passes: int


class Row(ReturnStats):
    """One line of the breakdown, one level down from the subject.

    ``statuses`` are a direction's own columns, which its cards are counted in.
    """

    kind: Literal["role", "person", "status"]
    id: int
    name: str
    statuses: list[int] = Field(default_factory=list)
    color: str | None = None
    member: bool | None = None
    in_now: int
    stuck: int
    done: int
    p50: float | None
    share: float | None
    passes: int
    clean_passes: int


class Analysis(BaseModel):
    """Everything a screen shows about one subject.

    ``statuses`` limits the flow blocks to a direction's own columns; ``None`` shows all.
    ``compared`` are the columns a comparison looks at: a direction's own, or those of the
    role a person belongs to; ``None`` means every column.
    """

    subject: Subject
    name: str
    tiles: Tiles
    breakdown: list[Row]
    flow: FlowResponse
    statuses: list[int] | None = None
    compared: list[int] | None = None


def flow_tiles(report: FlowReport, returned: ReturnStats | None = None) -> Tiles:
    """The key numbers of the project or of a person from their flow report."""
    return Tiles(
        in_progress=report.in_progress,
        stuck=sum(1 for card in report.stuck if card.level),
        finished=report.finished,
        lead_p50=report.lead_time.p50,
        lead_p85=report.lead_time.p85,
        cycle_p50=report.cycle_time.p50,
        cycle_p85=report.cycle_time.p85,
        passes=sum(column.passes for column in report.columns),
        clean_passes=sum(column.clean_passes for column in report.columns),
        **(
            returned or return_stats(event.item_id for event in report.back_moves.events)
        ).model_dump(include=set(ReturnStats.model_fields)),
    )


def direction_tiles(direction: DirectionFlow) -> Tiles:
    """The key numbers of a direction from its own columns."""
    return Tiles(
        in_progress=direction.in_now,
        stuck=len(direction.stuck),
        finished=direction.passed,
        lead_p50=direction.p50,
        lead_p85=direction.p85,
        cycle_p50=None,
        cycle_p85=None,
        passes=sum(column.time.passes for column in direction.columns),
        clean_passes=sum(column.time.clean_passes for column in direction.columns),
        **direction.model_dump(include=set(ReturnStats.model_fields)),
    )


def direction_row(ref: DirectionRef, direction: DirectionFlow) -> Row:
    """A direction as one line of the project's breakdown."""
    tiles = direction_tiles(direction)
    return Row(
        kind="role",
        id=ref.role_id,
        name=ref.name,
        statuses=[column.time.status_id for column in direction.columns],
        in_now=tiles.in_progress,
        stuck=tiles.stuck,
        done=tiles.finished,
        p50=tiles.lead_p50,
        share=None,
        passes=tiles.passes,
        clean_passes=tiles.clean_passes,
        **tiles.model_dump(include=set(ReturnStats.model_fields)),
    )


def people_rows(
    direction: DirectionFlow, open_by: dict[int, int], stuck_by: dict[int, int]
) -> list[Row]:
    """A direction's people as lines: members first, then alphabetically.

    ``open_by`` and ``stuck_by`` count the cards in its columns each person holds now.
    """
    rows = [
        Row(
            kind="person",
            id=person.user_id,
            name=direction.names.get(person.user_id, f"#{person.user_id}"),
            member=person.member,
            in_now=open_by.get(person.user_id, 0),
            stuck=stuck_by.get(person.user_id, 0),
            done=person.stays,
            p50=person.p50,
            share=person.share,
            passes=person.passes,
            clean_passes=person.clean_passes,
            **person.model_dump(include=set(ReturnStats.model_fields)),
        )
        for person in direction.people
    ]
    return sorted(rows, key=lambda row: (not row.member, row.name.lower()))


def status_rows(columns: Sequence[ColumnShare]) -> list[Row]:
    """A person's columns as lines, in Taiga's order."""
    return [
        Row(
            kind="status",
            id=column.status_id,
            name=column.name,
            color=column.color,
            in_now=column.person_now,
            stuck=0,
            done=column.person_stays,
            p50=column.person_p50,
            share=column.share,
            passes=column.passes,
            clean_passes=column.clean_passes,
            **column.model_dump(include=set(ReturnStats.model_fields)),
        )
        for column in columns
    ]


def held_by_person(
    report: FlowReport, statuses: Collection[int], *, stuck_only: bool
) -> dict[int, int]:
    """How many unfinished cards in ``statuses`` each person is assigned to now."""
    counts: dict[int, int] = {}
    for card in report.stuck:
        if card.status_id in statuses and (card.level or not stuck_only):
            for user in card.assignees:
                counts[user] = counts.get(user, 0) + 1
    return counts
