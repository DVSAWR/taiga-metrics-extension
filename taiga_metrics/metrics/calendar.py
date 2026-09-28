"""Durations in calendar or working days, and percentiles.

A working day counts in full, all 24 hours of it; weekends and other non-working
weekdays count as zero. Day boundaries follow the project's time zone.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from datetime import datetime, time, timedelta
from typing import TYPE_CHECKING, Final
from zoneinfo import ZoneInfo

if TYPE_CHECKING:
    from collections.abc import Sequence

SECONDS_PER_DAY: Final = 86400.0
ALL_DAYS: Final = frozenset(range(1, 8))


@dataclass(frozen=True)
class WorkCalendar:
    """Working ISO weekdays in a time zone."""

    timezone: str
    working_days: frozenset[int]

    @property
    def zone(self) -> ZoneInfo:
        """The time zone object."""
        return ZoneInfo(self.timezone)

    def with_days(self, working_days: frozenset[int]) -> WorkCalendar:
        """The same time zone with other working days."""
        return WorkCalendar(self.timezone, working_days)

    def days_between(self, start: datetime, end: datetime, *, working: bool) -> float:
        """Length of ``[start, end)`` in days, counting only working days if asked."""
        if end <= start:
            return 0.0
        if not working or self.working_days >= ALL_DAYS:
            return (end - start).total_seconds() / SECONDS_PER_DAY
        zone = self.zone
        local_start = start.astimezone(zone)
        local_end = end.astimezone(zone)
        seconds = 0.0
        day = local_start.date()
        while day <= local_end.date():
            day_start = datetime.combine(day, time.min, zone)
            day_end = datetime.combine(day + timedelta(days=1), time.min, zone)
            if day.isoweekday() in self.working_days:
                overlap_start = max(local_start, day_start)
                overlap_end = min(local_end, day_end)
                if overlap_end > overlap_start:
                    seconds += (overlap_end - overlap_start).total_seconds()
            day += timedelta(days=1)
        return seconds / SECONDS_PER_DAY

    def week_start(self, moment: datetime) -> datetime:
        """Monday 00:00 of the week containing ``moment``, in this time zone."""
        local = moment.astimezone(self.zone)
        monday = local.date() - timedelta(days=local.isoweekday() - 1)
        return datetime.combine(monday, time.min, self.zone)


def percentile(values: Sequence[float], share: float) -> float | None:
    """The smallest value that ``share`` of the values do not exceed; ``None`` without values.

    Nearest rank, never between two values: "85% within 66 days" then means that 85% of
    the cards really took 66 days or less, the same point a cumulative chart reaches 85%.
    """
    if not values:
        return None
    ordered = sorted(values)
    rank = max(1, math.ceil(share * len(ordered) - 1e-9))
    return ordered[min(rank, len(ordered)) - 1]
