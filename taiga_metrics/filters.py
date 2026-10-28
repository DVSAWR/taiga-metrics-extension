"""Card filters in the format of Taiga's board filters.

A selection holds, per category, values to include and values to exclude. Included
values of one category are alternatives, except tags, which must all match;
categories are combined; any excluded value
removes a card. Each category reports how many cards carry each of its values among
the cards matching every other category, which is what the counters in the panel show.

People and roles look at everyone who has ever been assigned to a card, so a card
someone worked on stays theirs after it is handed over. Metrics then narrow further:
``AssignmentFilter`` tells, for any moment of a card's life, whether the people
assigned at that moment are the ones the selection asks for.
"""

from __future__ import annotations

from collections import Counter
from collections.abc import Mapping
from dataclasses import dataclass, field, replace
from typing import TYPE_CHECKING, Final, Literal

if TYPE_CHECKING:
    from collections.abc import Iterable

Category = Literal[
    "status", "swimlane", "assigned", "role", "created_by", "created_by_role", "epic", "tag"
]
CATEGORIES: Final[tuple[Category, ...]] = (
    "status",
    "swimlane",
    "assigned",
    "role",
    "created_by",
    "created_by_role",
    "epic",
    "tag",
)
NONE: Final = "none"


@dataclass(frozen=True)
class CardFacts:
    """What filters can look at on one card.

    ``assignees`` are the current ones; ``ever_assigned`` everyone who has been
    assigned at some point, and ``roles`` their roles. ``status_id`` is the current
    status, which only means something together with the card type; ``owner_role`` is
    the role in the project of whoever created the card. ``swimlane_id`` is the
    swimlane a user story is in now; a task takes the one of its user story.
    """

    item_type: str
    item_id: int
    assignees: frozenset[int]
    roles: frozenset[int]
    owner_id: int | None
    epics: frozenset[int]
    tags: frozenset[str]
    is_deleted: bool = False
    ever_assigned: frozenset[int] | None = None
    status_id: int | None = None
    owner_role: int | None = None
    swimlane_id: int | None = None


def status_value(item_type: str, status_id: int) -> str:
    """The filter value of a status; status ids repeat across card types."""
    return f"{item_type}.{status_id}"


@dataclass(frozen=True)
class CategorySelection:
    """Included and excluded values of one category."""

    include: frozenset[str] = frozenset()
    exclude: frozenset[str] = frozenset()


@dataclass(frozen=True)
class Selection:
    """The whole filter state."""

    categories: Mapping[Category, CategorySelection] = field(default_factory=dict)

    @property
    def is_empty(self) -> bool:
        """Whether no value is selected at all."""
        return not any(part.include or part.exclude for part in self.categories.values())


def parse_selection(include: Iterable[str], exclude: Iterable[str]) -> Selection:
    """Build a selection from ``category:value`` strings; unknown categories are ignored."""
    included: dict[Category, set[str]] = {}
    excluded: dict[Category, set[str]] = {}
    for target, raw_values in ((included, include), (excluded, exclude)):
        for raw in raw_values:
            category, separator, value = raw.partition(":")
            if separator and value and category in CATEGORIES:
                target.setdefault(category, set()).add(value)
    return Selection(
        {
            category: CategorySelection(
                frozenset(included.get(category, ())), frozenset(excluded.get(category, ()))
            )
            for category in CATEGORIES
            if category in included or category in excluded
        }
    )


def values_of(card: CardFacts, category: Category) -> frozenset[str]:
    """The values a card carries in a category; ``none`` when it carries nothing."""
    raw: frozenset[str]
    if category == "status":
        raw = (
            frozenset()
            if card.status_id is None
            else frozenset({status_value(card.item_type, card.status_id)})
        )
    elif category == "assigned":
        people = card.assignees if card.ever_assigned is None else card.ever_assigned
        raw = frozenset(str(user) for user in people)
    elif category == "role":
        raw = frozenset(str(role) for role in card.roles)
    elif category == "created_by":
        raw = frozenset() if card.owner_id is None else frozenset({str(card.owner_id)})
    elif category == "created_by_role":
        raw = frozenset() if card.owner_role is None else frozenset({str(card.owner_role)})
    elif category == "swimlane":
        raw = frozenset() if card.swimlane_id is None else frozenset({str(card.swimlane_id)})
    elif category == "epic":
        raw = frozenset(str(epic) for epic in card.epics)
    else:
        raw = card.tags
    return raw or frozenset({NONE})


def matches(card: CardFacts, selection: Selection, skip: Category | None = None) -> bool:
    """Whether a card passes every category of the selection except ``skip``."""
    for category, part in selection.categories.items():
        if category == skip:
            continue
        values = values_of(card, category)
        if part.include and not (
            part.include <= values if category == "tag" else values & part.include
        ):
            return False
        if values & part.exclude:
            return False
    return True


def apply(cards: Iterable[CardFacts], selection: Selection) -> list[CardFacts]:
    """Cards passing the selection."""
    return [card for card in cards if matches(card, selection)]


def facet_counts(cards: Iterable[CardFacts], selection: Selection) -> dict[Category, Counter[str]]:
    """Per category, how many cards carry each value among cards matching the others.

    Deleted cards are left out of the counters; they no longer exist on Taiga's board.
    """
    listed = [card for card in cards if not card.is_deleted]
    tags = selection.categories.get("tag", CategorySelection()).include
    return {
        category: Counter(
            value
            for card in listed
            if matches(card, selection, skip=category)
            if category != "tag" or tags <= values_of(card, "tag")
            for value in values_of(card, category)
        )
        for category in CATEGORIES
    }


@dataclass(frozen=True)
class AssignmentFilter:
    """Which assignee sets count, from the people and roles the selection includes.

    Included people and included roles each have to be satisfied by the assignees of
    the moment; ``none`` stands for nobody assigned, or nobody with a role. ``negated``
    turns the filter into everyone else: the moments and events the filter does not
    take, so that the two together are the whole flow.
    """

    people: frozenset[int] | None = None
    unassigned: bool = False
    roles: frozenset[int] | None = None
    no_role: bool = False
    negated: bool = False

    def rest(self) -> AssignmentFilter:
        """Everyone else: what this filter leaves out."""
        return replace(self, negated=not self.negated)

    def takes(self, assignees: frozenset[int], roles_of: Mapping[int, int | None]) -> bool:
        """Whether a moment with these assignees belongs to the filter, negation applied."""
        return self.matches(assignees, roles_of) != self.negated

    def takes_event(
        self, before: frozenset[int], after: frozenset[int], roles_of: Mapping[int, int | None]
    ) -> bool:
        """Whether an event belongs to the filter: its people were assigned right before
        or right after it; negated, neither was the case.
        """
        hit = self.matches(before, roles_of) or self.matches(after, roles_of)
        return hit != self.negated

    def matches(self, assignees: frozenset[int], roles_of: Mapping[int, int | None]) -> bool:
        """Whether the given assignees satisfy the filter, negation left aside."""
        if self.people is not None and not (
            assignees & self.people or (self.unassigned and not assignees)
        ):
            return False
        if self.roles is not None:
            roles = {roles_of.get(user) for user in assignees} - {None}
            if not (roles & self.roles or (self.no_role and not roles)):
                return False
        return True


def ids_of(values: Iterable[str]) -> frozenset[int]:
    """The numeric values of a category, skipping ``none`` and anything unparsable."""
    return frozenset(int(value) for value in values if value.isdigit())


def assignment_filter(selection: Selection) -> AssignmentFilter | None:
    """The filter on assignees implied by included people and roles, if any."""
    people = selection.categories.get("assigned")
    roles = selection.categories.get("role")
    if not (people and people.include) and not (roles and roles.include):
        return None
    return AssignmentFilter(
        people=ids_of(people.include) if people and people.include else None,
        unassigned=bool(people and NONE in people.include),
        roles=ids_of(roles.include) if roles and roles.include else None,
        no_role=bool(roles and NONE in roles.include),
    )


def card_part(selection: Selection) -> Selection:
    """The selection without its included people and roles: what it asks of the cards.

    Excluded people and roles stay, since they drop whole cards.
    """
    kept = {
        category: (
            CategorySelection(frozenset(), values.exclude)
            if category in ("assigned", "role")
            else values
        )
        for category, values in selection.categories.items()
    }
    return Selection(
        {category: values for category, values in kept.items() if values.include or values.exclude}
    )


def selection_include(selection: Selection) -> list[str]:
    """The included values as ``category:value`` strings."""
    return [
        f"{category}:{value}"
        for category, values in selection.categories.items()
        for value in sorted(values.include)
    ]


def selection_exclude(selection: Selection) -> list[str]:
    """The excluded values as ``category:value`` strings."""
    return [
        f"{category}:{value}"
        for category, values in selection.categories.items()
        for value in sorted(values.exclude)
    ]
