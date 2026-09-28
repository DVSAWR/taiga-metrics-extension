"""Schema migrations of the extension's own database, managed with Alembic."""

from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory

if TYPE_CHECKING:
    from taiga_metrics.settings import Settings

MIGRATIONS_DIR = Path(__file__).resolve().parent


def alembic_config(settings: Settings) -> Config:
    """Alembic configuration built in code, without an ``alembic.ini`` file."""
    config = Config()
    config.set_main_option("script_location", str(MIGRATIONS_DIR))
    config.attributes["settings"] = settings
    return config


def upgrade(settings: Settings) -> None:
    """Apply all pending migrations."""
    command.upgrade(alembic_config(settings), "head")


def head_revision(settings: Settings) -> str | None:
    """Revision id of the newest migration shipped with this version."""
    return ScriptDirectory.from_config(alembic_config(settings)).get_current_head()
