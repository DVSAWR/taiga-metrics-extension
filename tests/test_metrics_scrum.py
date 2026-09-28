"""Tests for the row groups and the totals of the period matrix."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.metrics.engine import stays_of
from taiga_metrics.metrics.loader import (
    Period,
    PeriodScan,
    finished_rows,
    group_cells,
    spread,
    total_cells,
)
from taiga_metrics.metrics.periods import Span
from tests.test_metrics_engine import (
    CALENDARS,
    COLUMNS,
    DOING,
    DONE,
    READY,
    TYPES,
    at,
    card,
    options,
)

if TYPE_CHECKING:
    from taiga_metrics.metrics.engine import Card


def scan_of(cards: list[Card], days: float = 30) -> PeriodScan:
    """One period from day -1 to day 8, every finished stay placed in it."""
    flow = options(days)
    span = Span("w", "Week", at(-1), at(8))
    placed = [
        (item, stay, span.key)
        for item in cards
        for stay in stays_of(item, CALENDARS, flow)
        if stay.end is not None
    ]
    return PeriodScan(
        columns=COLUMNS,
        spans=[span],
        placed=placed,
        open_stays=[],
        now=at(days),
        cards=cards,
        calendars=CALENDARS,
        options=flow,
    )


CARDS = [
    card(1, (1, READY, 5), (2, DOING, 5), (4, DONE, 5)),
    card(2, (3, DOING, 5), (5, DONE, 5)),
]


def test_groups_add_up_each_card_before_the_median() -> None:
    """A group row is the median over cards of each card's time in the group."""
    cells = {cell.group: cell for cell in group_cells(scan_of(CARDS), TYPES)}
    assert cells["waiting"].stats.n == 2
    assert cells["waiting"].stats.p50 == 2.0
    assert cells["waiting"].stays == 3
    assert cells["work"].stats.p50 == 2.0


def test_totals_measure_the_cards_finished_in_each_period() -> None:
    """Lead and cycle time of finished cards, with their waiting and work time."""
    [total] = total_cells(scan_of(CARDS), TYPES, Period())
    assert total.cards == 2
    assert total.lead is not None
    assert (total.lead.p25, total.lead.p75) == (4.0, 5.0)
    assert total.cycle is not None
    assert total.cycle.p50 == 2.0
    assert (total.waiting_days, total.work_days) == (5.0, 4.0)


def test_finished_rows_list_the_cards_of_a_period_slowest_first() -> None:
    """The cards finished in the period come longest lead time first, with who finished."""
    rows = finished_rows(scan_of(CARDS), TYPES, Period(), "w")
    assert [(row.item_id, row.lead_days, row.finished_by) for row in rows] == [
        (2, 5.0, 5),
        (1, 4.0, 5),
    ]
    assert finished_rows(scan_of(CARDS), TYPES, Period(), "other") == []


def test_spread_counts_the_cards_on_each_side_of_the_middle_half() -> None:
    found = spread([1.0, 2.0, 2.0, 3.0, 4.0, 8.0, 8.0, 9.0])
    assert found is not None
    assert (found.p25, found.p75) == (2.0, 8.0)
    assert (found.slow, found.fast) == (3, 3)
