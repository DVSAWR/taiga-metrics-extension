"""Tests for turning raw Taiga values into what the sync stores."""

from __future__ import annotations

from taiga_metrics.sync.reader import tag_colors


def test_tag_colors_become_a_mapping() -> None:
    """Taiga keeps ``[[name, color], ...]``; tags without a color are left out."""
    assert tag_colors([["test", ""], ["test2", "#5551D3"], ["api", None]]) == {"test2": "#5551D3"}


def test_missing_or_malformed_colors_are_empty() -> None:
    """Nothing to show rather than a crash."""
    assert tag_colors(None) == {}
    assert tag_colors([["lonely"]]) == {}
