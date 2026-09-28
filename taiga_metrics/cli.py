"""Command line entry point: ``python -m taiga_metrics <command>``."""

from __future__ import annotations

import argparse
import asyncio
import logging
import sys
from datetime import timedelta
from typing import TYPE_CHECKING

import uvicorn

from taiga_metrics import __version__, migrations
from taiga_metrics.api.app import create_app
from taiga_metrics.db import create_metrics_engine, create_taiga_engine
from taiga_metrics.health import DatabaseHealthChecker
from taiga_metrics.settings import Settings
from taiga_metrics.sync.service import SyncAlreadyRunningError, SyncService

if TYPE_CHECKING:
    from collections.abc import Sequence


def serve(settings: Settings) -> int:
    """Apply migrations, then run the web server."""
    migrations.upgrade(settings)
    uvicorn.run(create_app(settings), host=settings.host, port=settings.port)
    return 0


def migrate(settings: Settings) -> int:
    """Apply pending migrations of the extension's database."""
    migrations.upgrade(settings)
    return 0


async def check_async(settings: Settings) -> int:
    """Print the health report as JSON; exit code 0 only if everything is healthy."""
    taiga_engine = create_taiga_engine(settings)
    metrics_engine = create_metrics_engine(settings)
    try:
        report = await DatabaseHealthChecker(
            __version__, taiga_engine, metrics_engine, migrations.head_revision(settings)
        ).check()
    finally:
        await taiga_engine.dispose()
        await metrics_engine.dispose()
    print(report.model_dump_json(indent=2))
    return 0 if report.healthy else 1


def sync_service(settings: Settings) -> SyncService:
    """A sync service with fresh engines for both databases."""
    return SyncService(
        create_taiga_engine(settings),
        create_metrics_engine(settings),
        timedelta(minutes=settings.sync_overlap_minutes),
    )


async def sync_async(settings: Settings) -> int:
    """Run one sync now."""
    service = sync_service(settings)
    try:
        run_id = await service.run("cli")
    except SyncAlreadyRunningError:
        print("Another sync is running", file=sys.stderr)
        return 1
    finally:
        await service.taiga_engine.dispose()
        await service.metrics_engine.dispose()
    print(f"Sync {run_id} succeeded")
    return 0


async def worker_async(settings: Settings) -> int:
    """Sync on start and then every ``sync_interval_seconds``, forever."""
    service = sync_service(settings)
    while True:
        try:
            await service.run("schedule")
        except SyncAlreadyRunningError:
            logging.getLogger(__name__).info("Skipped: another sync is running")
        except Exception:
            logging.getLogger(__name__).exception("Scheduled sync failed")
        await asyncio.sleep(settings.sync_interval_seconds)


def main(argv: Sequence[str] | None = None) -> int:
    """Parse the command and run it."""
    parser = argparse.ArgumentParser(prog="taiga_metrics")
    parser.add_argument("command", choices=["serve", "migrate", "check", "sync", "worker"])
    args = parser.parse_args(argv)
    logging.basicConfig(
        level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s"
    )
    settings = Settings()
    if args.command == "serve":
        return serve(settings)
    if args.command == "migrate":
        return migrate(settings)
    if args.command in ("sync", "worker"):
        migrations.upgrade(settings)
        runner = sync_async if args.command == "sync" else worker_async
        return asyncio.run(runner(settings))
    return asyncio.run(check_async(settings))


if __name__ == "__main__":
    sys.exit(main())
