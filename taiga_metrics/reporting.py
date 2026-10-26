"""Reporting periods: the equal stretches every sprint view of the extension cuts time into.

With Taiga's Scrum on, they are the project's sprints. With Scrum off, the project's
managers may set a regular cadence instead: every so many weeks from a first day. The
extension then cuts time into sprints of that length itself, from that day up to the
one running today, so the same views work without Taiga's sprints. Without either,
nothing offers sprints.
"""

from __future__ import annotations

from datetime import date, timedelta
from typing import Final

from pydantic import BaseModel, Field

from taiga_metrics.explore import Sprint

MAX_WEEKS: Final = 8
MAX_SPRINTS: Final = 520


class Cadence(BaseModel):
    """Every ``weeks`` weeks from ``start``; ``weeks`` is ``None`` while switched off."""

    weeks: int | None = Field(default=None, ge=1, le=MAX_WEEKS)
    start: date | None = None

    @property
    def active(self) -> bool:
        """Whether the cadence cuts time into sprints."""
        return self.weeks is not None and self.start is not None


def cadence_sprints(cadence: Cadence, today: date) -> list[Sprint]:
    """The sprints of the cadence from its first day to the one running today, newest first.

    They are numbered from 1; ids are negative so they never meet Taiga's sprint ids.
    """
    if cadence.weeks is None or cadence.start is None or cadence.start > today:
        return []
    length = timedelta(weeks=cadence.weeks)
    sprints: list[Sprint] = []
    start = cadence.start
    while start <= today and len(sprints) < MAX_SPRINTS:
        finish = start + length - timedelta(days=1)
        number = len(sprints) + 1
        sprints.append(
            Sprint(
                id=-number,
                name=f"Sprint {number}",
                start=start,
                finish=finish,
                closed=finish < today,
            )
        )
        start += length
    return sprints[::-1]
