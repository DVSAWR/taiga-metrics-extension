"""Tests for working-day durations, weeks, and percentiles."""

from __future__ import annotations

from datetime import UTC, datetime, time, timedelta

import pytest

from taiga_metrics.metrics.calendar import WorkCalendar, percentile

WEEKDAYS = WorkCalendar("UTC", frozenset({1, 2, 3, 4, 5}))


def test_calendar_days_ignore_the_working_week() -> None:
    """Calendar mode is plain elapsed time."""
    start = datetime(2026, 9, 25, 12, tzinfo=UTC)
    end = datetime(2026, 9, 28, 12, tzinfo=UTC)
    assert WEEKDAYS.days_between(start, end, working=False) == 3.0


def test_weekends_do_not_count_as_working_days() -> None:
    """Friday noon to Monday noon is one working day."""
    start = datetime(2026, 9, 25, 12, tzinfo=UTC)
    end = datetime(2026, 9, 28, 12, tzinfo=UTC)
    assert WEEKDAYS.days_between(start, end, working=True) == 1.0


def test_day_boundaries_follow_the_time_zone() -> None:
    """Friday 23:00 UTC is already Saturday in Moscow, so it does not count there."""
    moscow = WorkCalendar("Europe/Moscow", frozenset({1, 2, 3, 4, 5}))
    start = datetime(2026, 9, 25, 21, tzinfo=UTC)
    end = datetime(2026, 9, 25, 23, tzinfo=UTC)
    assert moscow.days_between(start, end, working=True) == 0.0
    assert WEEKDAYS.days_between(start, end, working=True) == 2 / 24


def test_weeks_start_on_monday_in_the_time_zone() -> None:
    """Sunday 22:00 UTC is Monday in Moscow."""
    moscow = WorkCalendar("Europe/Moscow", frozenset({1, 2, 3, 4, 5}))
    week = moscow.week_start(datetime(2026, 9, 27, 22, tzinfo=UTC))
    assert week.isoformat() == "2026-09-28T00:00:00+03:00"


def test_percentiles_use_the_nearest_rank() -> None:
    """A real value that the share of values does not exceed, nothing for no data."""
    assert percentile([1, 2, 3, 4], 0.5) == 2
    assert percentile([4, 1, 3, 2], 0.75) == 3
    assert percentile(list(range(1, 21)), 0.85) == 17
    assert percentile([10], 0.85) == 10
    assert percentile([1, 2, 3], 0) == 1
    assert percentile([], 0.5) is None


@pytest.mark.parametrize("zone", ["UTC", "Europe/Moscow", "Europe/Berlin", "America/New_York"])
@pytest.mark.parametrize(
    "weekdays", [frozenset(), frozenset({1, 3, 7}), frozenset({1, 2, 3, 4, 5})]
)
def test_working_day_arithmetic_preserves_day_boundary_semantics(
    zone: str, weekdays: frozenset[int]
) -> None:
    """Whole weeks, leap years, DST changes and partial days agree with daily integration."""
    calendar = WorkCalendar(zone, weekdays)
    start = datetime(2024, 2, 28, 17, 23, tzinfo=UTC)
    for duration in (0, 0.2, 1, 6, 7, 8, 40, 250, 400, 1000):
        end = start + timedelta(days=duration)
        local_start = start.astimezone(calendar.zone)
        local_end = end.astimezone(calendar.zone)
        day = local_start.date()
        seconds = 0.0
        while day <= local_end.date():
            if day.isoweekday() in weekdays:
                left = max(local_start, datetime.combine(day, time.min, calendar.zone))
                right = min(
                    local_end, datetime.combine(day + timedelta(days=1), time.min, calendar.zone)
                )
                seconds += max(0, (right - left).total_seconds())
            day += timedelta(days=1)
        assert calendar.days_between(start, end, working=True) == pytest.approx(seconds / 86400)
    assert calendar.days_between(start, start - timedelta(days=1), working=True) == 0
