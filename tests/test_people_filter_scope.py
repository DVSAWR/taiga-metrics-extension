"""The People list and a person's analysis cover the same assigned cards."""

from __future__ import annotations

import asyncio
from dataclasses import replace
from datetime import timedelta
from unittest.mock import AsyncMock, MagicMock

import pytest
from sqlalchemy.ext.asyncio import AsyncEngine

from taiga_metrics.explore import Person
from taiga_metrics.metrics.loader import Period, StoredFlowData
from taiga_metrics.metrics.returns import ReturnRules
from tests.test_directions import CALENDARS, COLUMNS, START, card


def test_person_summary_excludes_cards_never_assigned_to_that_person(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    """An author credit on somebody else's card cannot inflate the assigned-cards summary."""
    item = card(1, (1, 2, 6), (2, 3, 6), (3, 2, 7))
    mine = replace(item, assignees=frozenset({6}), assignments=((START, frozenset({6})),))
    other = replace(
        item, item_id=2, assignees=frozenset({7}), assignments=((START, frozenset({7})),)
    )
    engine = MagicMock(spec=AsyncEngine)
    data = StoredFlowData(engine)
    monkeypatch.setattr(data, "cards", AsyncMock(return_value=(COLUMNS, [mine, other])))
    monkeypatch.setattr(data, "calendars", AsyncMock(return_value=CALENDARS))
    monkeypatch.setattr(data, "member_roles", AsyncMock(return_value={6: 40, 7: 40}))
    monkeypatch.setattr(
        data,
        "return_options",
        AsyncMock(return_value=(ReturnRules(credit="author"), timedelta(minutes=5))),
    )
    monkeypatch.setattr(data, "people", AsyncMock(return_value={6: Person(id=6, name="Person")}))
    [summary] = asyncio.run(data.people_summary(2, "userstory", [6], period=Period()))
    assert (summary.returns, summary.returned_cards, summary.repeat_returns) == (1, 1, 0)


@pytest.mark.parametrize("item_ids,expected", [(None, 1), ([9], 1), ([], 0)])
def test_people_stuck_uses_the_project_baseline_before_filtering(
    monkeypatch: pytest.MonkeyPatch, item_ids: list[int] | None, expected: int
) -> None:
    """Filtering out finished cards must not erase the overdue-card threshold."""
    history = [card(item, (0, 2, 6), (1, 4, 6)) for item in range(1, 4)]
    mine = replace(
        card(9, (0, 2, 6)), assignees=frozenset({6}), assignments=((START, frozenset({6})),)
    )
    data = StoredFlowData(MagicMock(spec=AsyncEngine))
    load = AsyncMock(return_value=(COLUMNS, [*history, mine]))
    monkeypatch.setattr(data, "cards", load)
    monkeypatch.setattr(data, "calendars", AsyncMock(return_value=CALENDARS))
    monkeypatch.setattr(data, "member_roles", AsyncMock(return_value={6: 40}))
    monkeypatch.setattr(
        data, "return_options", AsyncMock(return_value=(ReturnRules(), timedelta(minutes=5)))
    )
    monkeypatch.setattr(data, "people", AsyncMock(return_value={6: Person(id=6, name="Person")}))
    [summary] = asyncio.run(
        data.people_summary(2, "userstory", [6], period=Period(), item_ids=item_ids)
    )
    assert summary.stuck == expected
    assert load.await_args is not None
    assert len(load.await_args.args) == 2
