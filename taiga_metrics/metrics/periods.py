"""Periods for comparing time in statuses: days, weeks, months, or sprints.

A stay belongs to the period in which it ended. Sprints are only their planned
dates; a stay that ended outside every sprint goes to the ``outside`` column, which
is shown apart and never compared. Weeks start on Monday and months on the first,
both at midnight in the project's time zone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING, Final, Literal

from taiga_metrics.metrics.calendar import percentile

if TYPE_CHECKING:
    from collections.abc import Sequence
    from zoneinfo import ZoneInfo

    from taiga_metrics.explore import Sprint

PeriodKind = Literal["day", "week", "month", "sprint"]
GROUP_OF: Final[dict[str | None, str]] = {
    "queue": "waiting",
    "work": "work",
    "rework": "work",
    "done": "done",
    "cancelled": "done",
}
NO_GROUP: Final = "none"
OUTSIDE: Final = "outside"
DAY: Final = timedelta(days=1)
WEEK_FORMAT: Final = "%d %b"
MONTH_FORMAT: Final = "%b %Y"


@dataclass(frozen=True)
class Span:
    """One period: a stable key, what to call it, and its bounds, end excluded."""

    key: str
    label: str
    start: datetime
    end: datetime


def sprint_spans(sprints: Sequence[Sprint], zone: ZoneInfo) -> list[Span]:
    """Sprints with both planned dates, oldest first, each to the end of its last day."""
    dated = sorted(
        (sprint for sprint in sprints if sprint.start and sprint.finish),
        key=lambda sprint: (sprint.start, sprint.id),
    )
    return [
        Span(
            key=f"sprint-{sprint.id}",
            label=sprint.name,
            start=datetime.combine(sprint.start, time(), zone),
            end=datetime.combine(sprint.finish + DAY, time(), zone),
        )
        for sprint in dated
        if sprint.start and sprint.finish
    ]


def day_spans(first: datetime, last: datetime, zone: ZoneInfo) -> list[Span]:
    """Every day from the one holding ``first`` to the one holding ``last``."""
    start = datetime.combine(first.astimezone(zone).date(), time(), zone)
    spans = []
    while start <= last:
        end = datetime.combine(start.date() + DAY, time(), zone)
        spans.append(Span(start.date().isoformat(), start.strftime(WEEK_FORMAT), start, end))
        start = end
    return spans


def week_spans(first: datetime, last: datetime, zone: ZoneInfo) -> list[Span]:
    """Every week from the one holding ``first`` to the one holding ``last``."""
    local = first.astimezone(zone).date()
    start = datetime.combine(local - timedelta(days=local.weekday()), time(), zone)
    spans = []
    while start <= last:
        end = datetime.combine(start.date() + timedelta(days=7), time(), zone)
        spans.append(Span(start.date().isoformat(), start.strftime(WEEK_FORMAT), start, end))
        start = end
    return spans


def month_spans(first: datetime, last: datetime, zone: ZoneInfo) -> list[Span]:
    """Every month from the one holding ``first`` to the one holding ``last``."""
    local = first.astimezone(zone).date()
    start = datetime.combine(local.replace(day=1), time(), zone)
    spans = []
    while start <= last:
        following = (start.date().replace(day=28) + timedelta(days=4)).replace(day=1)
        end = datetime.combine(following, time(), zone)
        spans.append(Span(start.strftime("%Y-%m"), start.strftime(MONTH_FORMAT), start, end))
        start = end
    return spans


def spans_for(
    kind: PeriodKind,
    sprints: Sequence[Sprint],
    zone: ZoneInfo,
    *,
    first: datetime | None,
    last: datetime,
    since: datetime | None,
    until: datetime | None,
) -> list[Span]:
    """The periods of a kind that overlap ``since`` to ``until``, oldest first."""
    if kind == "sprint":
        spans = sprint_spans(sprints, zone)
    else:
        begin = since or first
        if begin is None:
            return []
        end = min(last, until) if until else last
        builders = {"day": day_spans, "week": week_spans, "month": month_spans}
        spans = builders[kind](begin, end, zone)
    return [
        span
        for span in spans
        if (since is None or span.end > since) and (until is None or span.start < until)
    ]


def group_of(column_type: str | None) -> str:
    """The row group of a status type: waiting, work, done, or none when not set."""
    return GROUP_OF.get(column_type, NO_GROUP)


def span_of(moment: datetime, spans: Sequence[Span]) -> Span | None:
    """The first period holding ``moment``; sprints may overlap, weeks never do."""
    return next((span for span in spans if span.start <= moment < span.end), None)


def days_left(span: Span, now: datetime) -> int | None:
    """Whole days until a period that is still going ends, else ``None``."""
    if not span.start <= now < span.end:
        return None
    return math.ceil((span.end - now) / DAY)


@dataclass(frozen=True)
class Stats:
    """What a cell can show: how many stays, their spread, total and mean."""

    n: int
    p25: float
    p50: float
    p75: float
    p90: float
    max: float
    mean: float
    sum: float


def stats_of(values: Sequence[float]) -> Stats | None:
    """Nearest-rank percentiles, maximum, mean and total of the stays, if any."""
    if not values:
        return None

    def rank(share: float) -> float:
        value = percentile(values, share)
        return 0.0 if value is None else value

    total = sum(values)
    return Stats(
        n=len(values),
        p25=rank(0.25),
        p50=rank(0.5),
        p75=rank(0.75),
        p90=rank(0.9),
        max=max(values),
        mean=total / len(values),
        sum=total,
    )
