"""Alembic environment: runs migrations against the extension's own database."""

from __future__ import annotations

import asyncio
from typing import TYPE_CHECKING

from alembic import context
from sqlalchemy import func, select

from taiga_metrics.db import create_metrics_engine
from taiga_metrics.settings import Settings

if TYPE_CHECKING:
    from sqlalchemy.engine import Connection


MIGRATION_LOCK_KEY = 7_236_451_000


def run_migrations(connection: Connection) -> None:
    """Run migrations inside one transaction, one process at a time.

    The web server and the worker both migrate on start; a transaction-scoped advisory
    lock makes the second one wait and then find nothing left to do.
    """
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        connection.execute(select(func.pg_advisory_xact_lock(MIGRATION_LOCK_KEY)))
        context.run_migrations()


async def run_async() -> None:
    """Open a connection to the extension's database and migrate it."""
    settings = context.config.attributes.get("settings") or Settings()
    engine = create_metrics_engine(settings)
    try:
        async with engine.connect() as connection:
            await connection.run_sync(run_migrations)
    finally:
        await engine.dispose()


asyncio.run(run_async())
