"""Tests for the periods of the status matrix."""

from __future__ import annotations

from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo

from taiga_metrics.explore import Sprint
from taiga_metrics.metrics.periods import (
    day_spans,
    days_left,
    month_spans,
    span_of,
    spans_for,
    stats_of,
    week_spans,
)

MOSCOW = ZoneInfo("Europe/Moscow")


def test_weeks_start_on_monday_in_the_zone() -> None:
    """Weeks run Monday to Monday at local midnight."""
    spans = week_spans(
        datetime(2026, 9, 16, 12, tzinfo=UTC), datetime(2026, 9, 27, 12, tzinfo=UTC), MOSCOW
    )
    assert [span.key for span in spans] == ["2026-09-14", "2026-09-21"]
    assert spans[0].start == datetime(2026, 9, 14, tzinfo=MOSCOW)


def test_days_run_midnight_to_midnight_in_the_zone() -> None:
    """Days start at local midnight, so a late UTC evening is the next day in Moscow."""
    spans = day_spans(
        datetime(2026, 9, 20, 22, tzinfo=UTC), datetime(2026, 9, 22, 12, tzinfo=UTC), MOSCOW
    )
    assert [span.key for span in spans] == ["2026-09-21", "2026-09-22"]


def test_months_cover_the_span() -> None:
    """Months run from the first of one month to the first of the next."""
    spans = month_spans(
        datetime(2026, 1, 31, tzinfo=UTC), datetime(2026, 3, 2, tzinfo=UTC), MOSCOW
    )
    assert [span.key for span in spans] == ["2026-01", "2026-02", "2026-03"]
    assert spans[1].end == datetime(2026, 3, 1, tzinfo=MOSCOW)


def test_sprints_skip_undated_and_keep_the_range() -> None:
    """Only dated sprints become periods, and only those overlapping the range."""
    sprints = [
        Sprint(id=1, name="S1", start=date(2026, 9, 1), finish=date(2026, 9, 14), closed=True),
        Sprint(id=2, name="S2", start=date(2026, 9, 15), finish=date(2026, 9, 28), closed=False),
        Sprint(id=3, name="S3", start=None, finish=None, closed=False),
    ]
    now = datetime(2026, 9, 20, tzinfo=UTC)
    spans = spans_for(
        "sprint",
        sprints,
        MOSCOW,
        first=None,
        last=now,
        since=datetime(2026, 9, 15, tzinfo=MOSCOW),
        until=None,
    )
    assert [span.key for span in spans] == ["sprint-2"]
    assert span_of(datetime(2026, 9, 16, tzinfo=UTC), spans) == spans[0]
    assert span_of(datetime(2026, 9, 2, tzinfo=UTC), spans) is None
    assert days_left(spans[0], now) == 9


def test_stats_use_the_nearest_rank() -> None:
    """Cells hold nearest-rank percentiles, the maximum, the mean and the total."""
    found = stats_of([1.0, 2.0, 3.0, 4.0])
    assert found is not None
    assert (found.n, found.p25, found.p50, found.p75, found.p90) == (4, 1.0, 2.0, 3.0, 4.0)
    assert (found.max, found.mean, found.sum) == (4.0, 2.5, 10.0)
    assert stats_of([]) is None
