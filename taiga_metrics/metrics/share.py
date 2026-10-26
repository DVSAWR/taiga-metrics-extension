"""A person's part in the flow: how much of the time in each column was theirs.

A finished stay belongs to whoever moved the card out of the column, the attribution
rule of the whole extension. Only stays that ended in the period count; stays shorter
than the misclick threshold only passed through and are left out. Cards standing in a
column now are counted apart, for their current assignees. The project's managers name
the roles responsible for each column; only the columns of the person's own role count.
"""

from __future__ import annotations

from collections import Counter, defaultdict
from dataclasses import replace
from typing import TYPE_CHECKING

from pydantic import BaseModel

from taiga_metrics.metrics.calendar import percentile
from taiga_metrics.metrics.engine import intervals_of, stays_of
from taiga_metrics.metrics.returns import first_passes, returns_of
from taiga_metrics.project_settings import ColumnType

if TYPE_CHECKING:
    from collections.abc import Collection, Mapping, Sequence
    from datetime import datetime

    from taiga_metrics.metrics.engine import Calendars, Card, Column, FlowOptions


class ColumnShare(BaseModel):
    """One column: everyone's finished stays in it and the person's part of them.

    ``share`` is the person's part of the time, ``None`` without any time there.
    ``passes`` are the person's first passes of the column in the period and
    ``clean_passes`` those that never came back; ``returns`` are the returns to the
    column credited to the person by the project's rules.
    """

    status_id: int
    name: str
    color: str
    type: ColumnType | None
    roles: list[int]
    stays: int
    days: float
    person_stays: int
    person_days: float
    share: float | None
    p50: float | None
    person_p50: float | None
    now: int
    person_now: int
    passes: int = 0
    clean_passes: int = 0
    returns: int = 0


class PersonShare(BaseModel):
    """The person's part in every column of one card type, in Taiga's order.

    ``role_id`` is the person's role in the project and ``roles`` the names of every
    role that is responsible for a column.
    """

    role_id: int | None
    columns: list[ColumnShare]
    roles: dict[int, str]


def person_share(
    cards: Sequence[Card],
    columns: Sequence[Column],
    calendars: Calendars,
    options: FlowOptions,
    *,
    user_id: int,
    role_id: int | None,
    column_roles: Mapping[int, Collection[int]],
    every: bool = False,
) -> list[ColumnShare]:
    """Per column of the person's role, everyone's stays that ended in the period and
    the person's part of them; nothing for a person without a role.

    With ``every``, the columns the person had any part in instead, whatever their role.
    """
    team: dict[int, list[float]] = defaultdict(list)
    mine: dict[int, list[float]] = defaultdict(list)
    now: dict[int, int] = defaultdict(int)
    mine_now: dict[int, int] = defaultdict(int)
    whole = replace(options, since=None, until=None)
    for card in cards:
        for stay in stays_of(card, calendars, whole):
            if stay.end is None:
                if not card.is_deleted:
                    now[stay.status_id] += 1
                    mine_now[stay.status_id] += user_id in card.assignees
                continue
            if stay.end - stay.start < options.misclick or not ended_in(stay.end, options):
                continue
            team[stay.status_id].append(stay.days)
            if stay.exited_by == user_id:
                mine[stay.status_id].append(stay.days)
    passes, clean, returns = person_quality(cards, columns, options, user_id)
    result = []
    for column in sorted(columns, key=lambda found: (found.position, found.status_id)):
        roles = sorted(column_roles.get(column.status_id, ()))
        involved = bool(
            mine.get(column.status_id)
            or mine_now.get(column.status_id)
            or passes[column.status_id]
            or returns[column.status_id]
        )
        if (every and not involved) or (not every and (role_id is None or role_id not in roles)):
            continue
        stays = team.get(column.status_id, [])
        own = mine.get(column.status_id, [])
        days = sum(stays)
        result.append(
            ColumnShare(
                status_id=column.status_id,
                name=column.name,
                color=column.color,
                type=column.type,
                roles=roles,
                stays=len(stays),
                days=days,
                person_stays=len(own),
                person_days=sum(own),
                share=sum(own) / days if days > 0 else None,
                p50=percentile(stays, 0.5),
                person_p50=percentile(own, 0.5),
                now=now.get(column.status_id, 0),
                person_now=mine_now.get(column.status_id, 0),
                passes=passes[column.status_id],
                clean_passes=clean[column.status_id],
                returns=returns[column.status_id],
            )
        )
    return result


def person_quality(
    cards: Sequence[Card], columns: Sequence[Column], options: FlowOptions, user_id: int
) -> tuple[Counter[int], Counter[int], Counter[int]]:
    """Per column, the person's first passes in the period, clean ones, and returns credited."""
    by_id = {column.status_id: column for column in columns}
    passes: Counter[int] = Counter()
    clean: Counter[int] = Counter()
    returns: Counter[int] = Counter()
    for card in cards:
        intervals = intervals_of(card, options.now)
        found = returns_of(
            intervals, by_id, options.returns, options.misclick, card.assigned_before
        )
        for item in found:
            if user_id in item.credited and ended_in(item.happened_at, options):
                returns[item.credited_status] += 1
        for first in first_passes(intervals, found, options.misclick, options.returns.pauses):
            if first.author == user_id and ended_in(first.passed_at, options):
                passes[first.status_id] += 1
                clean[first.status_id] += first.clean
    return passes, clean, returns


def ended_in(moment: datetime, options: FlowOptions) -> bool:
    """Whether a stay that ended at ``moment`` belongs to the period."""
    return (options.since is None or moment >= options.since) and (
        options.until is None or moment < options.until
    )
