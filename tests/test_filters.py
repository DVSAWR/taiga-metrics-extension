"""Tests for Taiga-style include and exclude filters."""

from __future__ import annotations

from taiga_metrics.filters import (
    NONE,
    AssignmentFilter,
    CardFacts,
    apply,
    assignment_filter,
    facet_counts,
    parse_selection,
    values_of,
)


def card(
    item_id: int,
    *,
    assignees: tuple[int, ...] = (),
    roles: tuple[int, ...] = (),
    owner_id: int | None = 1,
    epics: tuple[int, ...] = (),
    tags: tuple[str, ...] = (),
    is_deleted: bool = False,
) -> CardFacts:
    """A user story with the given facts."""
    return CardFacts(
        item_type="userstory",
        item_id=item_id,
        assignees=frozenset(assignees),
        roles=frozenset(roles),
        owner_id=owner_id,
        epics=frozenset(epics),
        tags=frozenset(tags),
        is_deleted=is_deleted,
    )


CARDS = [
    card(1, assignees=(5,), roles=(40,), epics=(9,), tags=("api",)),
    card(2, assignees=(5, 6), roles=(40, 30), tags=("api", "ui")),
    card(3, assignees=(6,), roles=(30,), owner_id=2),
    card(4),
]


def ids(cards: list[CardFacts]) -> list[int]:
    """Ids of cards, for compact assertions."""
    return [c.item_id for c in cards]


def test_empty_selection_keeps_everything() -> None:
    """No filters, no narrowing."""
    selection = parse_selection([], [])
    assert selection.is_empty
    assert ids(apply(CARDS, selection)) == [1, 2, 3, 4]


def test_included_values_of_one_category_are_alternatives() -> None:
    """Including two assignees keeps cards of either."""
    selection = parse_selection(["assigned:5", "assigned:6"], [])
    assert ids(apply(CARDS, selection)) == [1, 2, 3]


def test_categories_are_combined() -> None:
    """An assignee and a tag must both hold."""
    selection = parse_selection(["assigned:6", "tag:ui"], [])
    assert ids(apply(CARDS, selection)) == [2]


def test_any_excluded_value_removes_a_card() -> None:
    """Excluding an assignee removes shared cards too."""
    selection = parse_selection([], ["assigned:6"])
    assert ids(apply(CARDS, selection)) == [1, 4]


def test_swimlane_values_and_cards_without_one() -> None:
    """A card carries its swimlane; one outside any swimlane carries ``none``."""
    inside = CardFacts(
        item_type="task",
        item_id=8,
        assignees=frozenset(),
        roles=frozenset(),
        owner_id=None,
        epics=frozenset(),
        tags=frozenset(),
        swimlane_id=7,
    )
    outside = CardFacts(
        item_type="userstory",
        item_id=9,
        assignees=frozenset(),
        roles=frozenset(),
        owner_id=None,
        epics=frozenset(),
        tags=frozenset(),
    )
    assert values_of(inside, "swimlane") == {"7"}
    assert values_of(outside, "swimlane") == {NONE}
    assert ids(apply([inside, outside], parse_selection(["swimlane:7"], []))) == [8]
    assert ids(apply([inside, outside], parse_selection(["swimlane:none"], []))) == [9]


def test_none_value_selects_cards_without_any() -> None:
    """``Unassigned`` and ``Not in an epic`` are real values."""
    assert ids(apply(CARDS, parse_selection(["assigned:none"], []))) == [4]
    assert ids(apply(CARDS, parse_selection([], ["epic:none"]))) == [1]


def test_unknown_categories_and_malformed_values_are_ignored() -> None:
    """Garbage in the query string does not break filtering."""
    selection = parse_selection(["colour:red", "assigned", "assigned:"], ["tag"])
    assert selection.is_empty


def test_values_of_an_empty_card_are_none() -> None:
    """Every category has a value, ``none`` when the card has nothing."""
    empty = card(7, owner_id=None)
    assert {
        category: values_of(empty, category)
        for category in ("assigned", "role", "created_by", "epic", "tag")
    } == dict.fromkeys(("assigned", "role", "created_by", "epic", "tag"), frozenset({NONE}))


def test_counts_ignore_the_own_category_but_respect_others() -> None:
    """Counters show what each value would add given the other filters."""
    selection = parse_selection(["tag:api", "assigned:5"], [])
    counts = facet_counts(CARDS, selection)
    assert counts["assigned"] == {"5": 2, "6": 1}
    assert counts["tag"]["api"] == 2
    assert counts["tag"]["ui"] == 1


def test_deleted_cards_are_not_counted() -> None:
    """Deleted cards no longer exist on the board."""
    counts = facet_counts(
        [*CARDS, card(8, assignees=(5,), is_deleted=True)], parse_selection([], [])
    )
    assert counts["assigned"]["5"] == 2


def test_people_filter_looks_at_everyone_ever_assigned() -> None:
    """A card handed over stays findable by the person who had it."""
    handed = CardFacts(
        item_type="task",
        item_id=1,
        assignees=frozenset({6}),
        roles=frozenset(),
        owner_id=None,
        epics=frozenset(),
        tags=frozenset(),
        ever_assigned=frozenset({5, 6}),
    )
    assert values_of(handed, "assigned") == {"5", "6"}
    assert apply([handed], parse_selection(["assigned:5"], [])) == [handed]


def test_assignment_filter_follows_included_people_and_roles() -> None:
    """Included people and roles become a filter on assignees; excludes do not."""
    assert assignment_filter(parse_selection([], ["assigned:5"])) is None
    people = assignment_filter(parse_selection(["assigned:5", f"assigned:{NONE}"], []))
    assert people == AssignmentFilter(people=frozenset({5}), unassigned=True)
    assert people.matches(frozenset({5, 7}), {})
    assert people.matches(frozenset(), {})
    assert not people.matches(frozenset({7}), {})
    roles = assignment_filter(parse_selection(["role:40"], []))
    assert roles is not None
    assert roles.matches(frozenset({7}), {7: 40})
    assert not roles.matches(frozenset({7}), {7: 30})


def test_status_values_carry_the_card_type() -> None:
    """Status ids repeat across card types, so the value names the type too."""
    facts = CardFacts(
        item_type="task",
        item_id=1,
        assignees=frozenset(),
        roles=frozenset(),
        owner_id=None,
        epics=frozenset(),
        tags=frozenset(),
        status_id=12,
    )
    assert values_of(facts, "status") == frozenset({"task.12"})
    assert apply([facts], parse_selection(["status:task.12"], [])) == [facts]
    assert apply([facts], parse_selection(["status:userstory.12"], [])) == []


def test_created_by_role_is_the_role_of_the_author() -> None:
    """Cards are matched by the project role of whoever created them."""
    facts = CardFacts(
        item_type="issue",
        item_id=1,
        assignees=frozenset(),
        roles=frozenset(),
        owner_id=7,
        epics=frozenset(),
        tags=frozenset(),
        owner_role=30,
    )
    assert values_of(facts, "created_by_role") == frozenset({"30"})
    assert apply([facts], parse_selection(["created_by_role:30"], [])) == [facts]
    assert apply([facts], parse_selection(["created_by_role:40"], [])) == []
