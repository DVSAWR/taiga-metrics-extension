"""Tests for search query parsing."""

from __future__ import annotations

from taiga_metrics.explore import like_pattern, parse_query


def test_reference_queries_with_or_without_hash() -> None:
    """``#12`` and ``12`` both search by reference."""
    assert parse_query("#12") == (12, "")
    assert parse_query(" 12 ") == (12, "")


def test_text_queries_search_subjects() -> None:
    """Anything else is a subject search."""
    assert parse_query("login page") == (None, "login page")
    assert parse_query("#12 login") == (None, "#12 login")
    assert parse_query("") == (None, "")


def test_like_wildcards_are_escaped() -> None:
    """A literal percent or underscore does not act as a wildcard."""
    assert like_pattern("50%_done") == "%50\\%\\_done%"
