"""Return counts within one subject and period, preserving repeated events per card."""

from __future__ import annotations

from collections import Counter
from typing import TYPE_CHECKING

from pydantic import BaseModel

if TYPE_CHECKING:
    from collections.abc import Iterable


class ReturnStats(BaseModel):
    """Events and distinct cards within the selected period and attribution scope.

    Repeat returns are all events after each card's first event in this scope.
    The repeat rate is the share of returned cards with at least two events.
    """

    returns: int = 0
    returned_cards: int = 0
    repeat_returns: int = 0
    repeated_cards: int = 0
    repeat_rate: float | None = None


def return_stats(item_ids: Iterable[int]) -> ReturnStats:
    """Summarize the card ids of return events after period and scope filtering."""
    counts = Counter(item_ids)
    total = sum(counts.values())
    repeated = sum(count > 1 for count in counts.values())
    return ReturnStats(
        returns=total,
        returned_cards=len(counts),
        repeat_returns=total - len(counts),
        repeated_cards=repeated,
        repeat_rate=repeated / len(counts) if counts else None,
    )
