"""Starting a sync from the web process without blocking the request."""

from __future__ import annotations

import asyncio
import logging
from typing import TYPE_CHECKING, Protocol

from taiga_metrics.sync.service import SyncAlreadyRunningError

if TYPE_CHECKING:
    from taiga_metrics.sync.service import SyncService

logger = logging.getLogger(__name__)


class SyncTrigger(Protocol):
    """Anything that can start a sync in the background."""

    def start(self) -> bool:
        """Start a sync; ``False`` if this process is already running one."""
        ...


class BackgroundSyncTrigger:
    """Runs manual syncs as a background task of the web process."""

    def __init__(self, service: SyncService) -> None:
        """Keep the sync service."""
        self.service = service
        self.task: asyncio.Task[None] | None = None

    def start(self) -> bool:
        """Start a sync unless one started here is still running."""
        if self.task is not None and not self.task.done():
            return False
        self.task = asyncio.create_task(self.run())
        return True

    async def run(self) -> None:
        """Run one manual sync, logging instead of raising."""
        try:
            await self.service.run("manual")
        except SyncAlreadyRunningError:
            logger.info("Manual sync skipped: another sync is running")
        except Exception:
            logger.exception("Manual sync failed")
