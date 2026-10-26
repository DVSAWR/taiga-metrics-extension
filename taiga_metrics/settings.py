"""Runtime configuration, read from environment variables prefixed with ``TAIGA_METRICS_``."""

from __future__ import annotations

from pathlib import Path

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy import URL


class Settings(BaseSettings):
    """Connection settings for both databases and the web server.

    ``taiga_db_*`` point at Taiga's own PostgreSQL, which is only ever read.
    ``db_*`` point at the extension's own PostgreSQL.
    ``taiga_url`` is Taiga's public address, used to link cards back to Taiga.
    ``taiga_api_url`` is Taiga's API as reachable from this container, used only to
    verify a username and password at sign-in.
    ``community_url`` and ``repository_url`` are the links of the help menu.
    ``media_dir`` is Taiga's media folder mounted read-only, for photos and logos;
    without it everyone gets the placeholder.
    ``superusers`` is a comma separated list of Taiga usernames who see and configure
    every project in the extension, as Taiga's superusers do; Taiga itself is unchanged.
    """

    model_config = SettingsConfigDict(env_prefix="TAIGA_METRICS_")

    taiga_db_host: str = "taiga-db"
    taiga_db_port: int = 5432
    taiga_db_name: str = "taiga"
    taiga_db_user: str = "taiga"
    taiga_db_password: SecretStr = SecretStr("taiga")

    db_host: str = "taiga-metrics-db"
    db_port: int = 5432
    db_name: str = "taiga_metrics"
    db_user: str = "taiga_metrics"
    db_password: SecretStr = SecretStr("taiga_metrics")

    taiga_url: str = "http://localhost:9000"
    taiga_api_url: str = "http://taiga-back:8000/api/v1"
    community_url: str = "https://community.taiga.io/"
    repository_url: str = "https://github.com/DVSAWR/taiga-metrics-extension"
    session_days: int = 14
    superusers: str = ""

    sync_interval_seconds: int = 3600
    sync_overlap_minutes: int = 120

    host: str = "0.0.0.0"
    port: int = 8000
    static_dir: Path | None = None
    media_dir: Path | None = None

    def taiga_db_url(self) -> URL:
        """SQLAlchemy URL of Taiga's database."""
        return URL.create(
            "postgresql+asyncpg",
            username=self.taiga_db_user,
            password=self.taiga_db_password.get_secret_value(),
            host=self.taiga_db_host,
            port=self.taiga_db_port,
            database=self.taiga_db_name,
        )

    def db_url(self) -> URL:
        """SQLAlchemy URL of the extension's own database."""
        return URL.create(
            "postgresql+asyncpg",
            username=self.db_user,
            password=self.db_password.get_secret_value(),
            host=self.db_host,
            port=self.db_port,
            database=self.db_name,
        )
