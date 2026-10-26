"""A direction: one Taiga role and the columns the project's managers made it answer for.

The direction's part of the flow is the time cards spend in its columns. Who did that
work follows the attribution rule of the whole extension: a stay belongs to whoever
moved the card out of the column. People are listed alphabetically, members of the role
first, with what share of the direction's time they closed; nobody is ranked.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace
from typing import TYPE_CHECKING

from pydantic import BaseModel

from taiga_metrics.metrics.calendar import percentile
from taiga_metrics.metrics.engine import (
    BackMove,
    ColumnTime,
    StuckCard,
    intervals_of,
    stays_of,
)
from taiga_metrics.metrics.returns import first_passes, returns_of

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence
    from datetime import datetime

    from taiga_metrics.metrics.engine import Calendars, Card, Column, FlowOptions, FlowReport


class DirectionColumn(BaseModel):
    """A column of the direction across cards, with its work in progress limit."""

    time: ColumnTime
    wip_limit: int | None


class DirectionPerson(BaseModel):
    """What one person closed of the direction's stays that ended in the period.

    ``passes`` are the first passes of its columns they authored in the period and
    ``clean_passes`` those that never came back; ``returns`` are the returns to its
    columns credited to them by the project's rules.
    """

    user_id: int
    member: bool
    stays: int
    days: float
    share: float | None
    p50: float | None
    passes: int = 0
    clean_passes: int = 0
    returns: int = 0


class DirectionFlow(BaseModel):
    """The direction's columns of one card type: load now, flow through, and people.

    ``passed`` counts the cards that left one of its columns in the period, each once;
    ``stays`` and ``days`` add up every stay that ended there in the period. ``returned``
    includes returns into and within its columns: its work did not pass. ``sent_back``
    counts returns out of them credited elsewhere: work it did not accept.
    """

    columns: list[DirectionColumn]
    in_now: int
    stuck: list[StuckCard]
    passed: int
    returned: list[BackMove]
    sent_back: list[BackMove]
    stays: int
    days: float
    p50: float | None = None
    p85: float | None = None
    people: list[DirectionPerson]
    names: dict[int, str]
    usernames: dict[int, str] = {}


class DirectionRef(BaseModel):
    """A role that answers for at least one column, with its columns and members."""

    role_id: int
    name: str
    columns: dict[str, list[int]]
    members: list[int]


def ended_in(moment: datetime, options: FlowOptions) -> bool:
    """Whether a stay that ended at ``moment`` belongs to the period."""
    return (options.since is None or moment >= options.since) and (
        options.until is None or moment < options.until
    )


def closed_stays(
    cards: Sequence[Card],
    calendars: Calendars,
    options: FlowOptions,
    statuses: Collection[int],
) -> dict[int | None, list[float]]:
    """Per person who moved the card on, the stays in ``statuses`` that ended in the period."""
    whole = replace(options, since=None, until=None)
    closed: dict[int | None, list[float]] = defaultdict(list)
    for card in cards:
        for stay in stays_of(card, calendars, whole):
            if (
                stay.status_id in statuses
                and stay.end is not None
                and stay.end - stay.start >= options.misclick
                and ended_in(stay.end, options)
            ):
                closed[stay.exited_by].append(stay.days)
    return closed


def people_quality(
    cards: Sequence[Card],
    columns: Sequence[Column],
    options: FlowOptions,
    statuses: Collection[int],
) -> tuple[Counter[int | None], Counter[int | None], Counter[int]]:
    """Per person, first passes of ``statuses`` authored, clean ones, and returns credited."""
    by_id = {column.status_id: column for column in columns}
    rework = {
        column.status_id
        for column in columns
        if not column.is_deleted and column.name.strip().upper() == "REWORK"
    }
    passes: Counter[int | None] = Counter()
    clean: Counter[int | None] = Counter()
    returns: Counter[int] = Counter()
    for card in cards:
        intervals = intervals_of(card, options.now)
        found = returns_of(
            intervals, by_id, options.returns, options.misclick, card.assigned_before
        )
        for item in found:
            if (
                item.credited_status in statuses
                and item.to_status not in rework
                and ended_in(item.happened_at, options)
            ):
                returns.update(item.credited)
        for first in first_passes(intervals, found, options.misclick, options.returns.pauses):
            if first.status_id in statuses and ended_in(first.passed_at, options):
                passes[first.author] += 1
                clean[first.author] += first.clean
    return passes, clean, returns


def direction_flow(
    report: FlowReport,
    cards: Sequence[Card],
    calendars: Calendars,
    options: FlowOptions,
    *,
    columns: Sequence[Column],
    statuses: Collection[int],
    members: Collection[int],
    wip_limits: Mapping[int, int | None],
) -> DirectionFlow:
    """The direction's part of a flow report computed over every card of the type."""
    wanted = set(statuses)
    rework = {
        column.status_id
        for column in columns
        if not column.is_deleted and column.name.strip().upper() == "REWORK"
    }
    passes, clean, credited = people_quality(cards, columns, options, wanted)
    shown = [
        DirectionColumn(time=column, wip_limit=wip_limits.get(column.status_id))
        for column in report.columns
        if column.status_id in wanted and (column.used or not column.is_deleted)
    ]
    closed = closed_stays(cards, calendars, options, wanted)
    every_stay = [days for values in closed.values() for days in values]
    stays = len(every_stay)
    days = sum(sum(values) for values in closed.values())
    people_ids = (
        {user for user in closed if user is not None}
        | set(members)
        | {user for user in passes if user is not None}
        | set(credited)
    )
    people = [
        DirectionPerson(
            user_id=user,
            member=user in members,
            stays=len(closed.get(user, [])),
            days=sum(closed.get(user, [])),
            share=sum(closed.get(user, [])) / days if days > 0 else None,
            p50=percentile(closed.get(user, []), 0.5),
            passes=passes[user],
            clean_passes=clean[user],
            returns=credited[user],
        )
        for user in people_ids
    ]
    return DirectionFlow(
        columns=shown,
        in_now=sum(column.time.in_column_now for column in shown),
        stuck=[card for card in report.stuck if card.status_id in wanted and card.level],
        passed=len(
            {
                card.item_id
                for card in report.column_cards
                if card.status_id in wanted and not card.now
            }
        ),
        returned=[
            move
            for move in report.back_moves.moves
            if move.credited_status in wanted and move.to_status not in rework
        ],
        sent_back=[
            move
            for move in report.back_moves.moves
            if move.from_status in wanted and move.credited_status not in wanted
        ],
        stays=stays,
        days=days,
        p50=percentile(every_stay, 0.5),
        p85=percentile(every_stay, 0.85),
        people=people,
        names={},
    )
