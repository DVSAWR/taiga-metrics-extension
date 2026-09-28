"""Database engines for Taiga's database and the extension's own database."""

from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy.ext.asyncio import create_async_engine

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

    from taiga_metrics.settings import Settings

APPLICATION_NAME = "taiga-metrics"


def create_taiga_engine(settings: Settings) -> AsyncEngine:
    """Engine for Taiga's database with every session forced to read-only.

    ``default_transaction_read_only`` is set per connection, so PostgreSQL itself rejects
    any write even if a query tries one.
    """
    return create_async_engine(
        settings.taiga_db_url(),
        pool_pre_ping=True,
        pool_size=5,
        connect_args={
            "server_settings": {
                "default_transaction_read_only": "on",
                "application_name": APPLICATION_NAME,
            }
        },
    )


def create_metrics_engine(settings: Settings) -> AsyncEngine:
    """Engine for the extension's own read-write database."""
    return create_async_engine(
        settings.db_url(),
        pool_pre_ping=True,
        pool_size=5,
        connect_args={"server_settings": {"application_name": APPLICATION_NAME}},
    )
