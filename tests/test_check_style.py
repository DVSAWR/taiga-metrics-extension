"""Tests for the repository style checker."""

from __future__ import annotations

from pathlib import Path

from scripts.check_style import EM_DASH, EN_DASH, comment_violations, dash_violations

SAMPLE = Path("sample.py")


def test_todo_comment_is_allowed() -> None:
    """A ``# TODO`` comment passes."""
    assert comment_violations(SAMPLE, "x = 1  # TODO: rename\n") == []


def test_regular_comment_is_rejected() -> None:
    """Any other comment is reported with its line number."""
    assert comment_violations(SAMPLE, "x = 1\n# explain x\n") == [
        "sample.py:2: only '# TODO' comments are allowed, use a docstring"
    ]


def test_hash_inside_string_is_not_a_comment() -> None:
    """A hash character inside a string literal is ignored."""
    assert comment_violations(SAMPLE, "x = '# not a comment'\n") == []


def test_long_dashes_are_rejected() -> None:
    """Em and en dashes are reported, the ASCII hyphen is not."""
    text = f"a - b\na {EM_DASH} b\na {EN_DASH} b\n"
    assert dash_violations(SAMPLE, text) == [
        "sample.py:2: use '-' instead of a long dash",
        "sample.py:3: use '-' instead of a long dash",
    ]
