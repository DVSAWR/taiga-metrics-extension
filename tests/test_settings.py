"""Tests for runtime settings."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.settings import Settings

if TYPE_CHECKING:
    import pytest


def test_defaults_match_taiga_docker() -> None:
    """Defaults point at the service names of the official taiga-docker setup."""
    url = Settings().taiga_db_url()
    assert url.host == "taiga-db"
    assert url.database == "taiga"
    assert url.drivername == "postgresql+asyncpg"


def test_environment_overrides_with_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    """Every setting is read from ``TAIGA_METRICS_``-prefixed variables."""
    monkeypatch.setenv("TAIGA_METRICS_TAIGA_DB_USER", "reader")
    monkeypatch.setenv("TAIGA_METRICS_TAIGA_DB_PASSWORD", "p@ss:word/1")
    monkeypatch.setenv("TAIGA_METRICS_DB_HOST", "localhost")
    settings = Settings()
    assert settings.taiga_db_url().username == "reader"
    assert settings.taiga_db_url().password == "p@ss:word/1"
    assert settings.db_url().host == "localhost"


def test_password_is_hidden_in_repr() -> None:
    """Passwords never appear in the settings representation."""
    assert "taiga_metrics'" not in repr(Settings().db_password)
