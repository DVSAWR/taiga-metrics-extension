"""Tests for the Taiga schema compatibility check."""

from __future__ import annotations

from taiga_metrics.taiga_schema import EXPECTED_SCHEMA, compare_schema


def test_identical_schema_is_compatible() -> None:
    """Nothing missing means compatible."""
    actual = {table: set(columns) for table, columns in EXPECTED_SCHEMA.items()}
    report = compare_schema(EXPECTED_SCHEMA, actual)
    assert report.compatible
    assert report.missing_tables == ()
    assert report.missing_columns == ()


def test_extra_tables_and_columns_are_ignored() -> None:
    """Taiga may have more than the extension needs."""
    actual = {"a": {"x", "y", "z"}, "b": {"x"}}
    assert compare_schema({"a": {"x"}}, actual).compatible


def test_missing_table_is_reported_without_its_columns() -> None:
    """A missing table is reported once, not column by column."""
    report = compare_schema({"a": {"x"}, "b": {"x", "y"}}, {"a": {"x"}})
    assert not report.compatible
    assert report.missing_tables == ("b",)
    assert report.missing_columns == ()


def test_missing_columns_are_reported_sorted() -> None:
    """Missing columns are reported as ``table.column``, sorted."""
    report = compare_schema({"a": {"x", "y", "z"}}, {"a": {"y"}})
    assert report.missing_columns == ("a.x", "a.z")
