"""Smoke tests for the package itself."""

from __future__ import annotations

import taiga_metrics


def test_version_is_defined() -> None:
    """The package exposes its version string."""
    assert taiga_metrics.__version__ == "0.2.1"
