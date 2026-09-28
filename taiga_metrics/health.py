"""Connectivity and compatibility status of both databases."""

from __future__ import annotations

from typing import TYPE_CHECKING, Protocol

from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError

from taiga_metrics.taiga_schema import check_schema

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

CONNECTION_ERRORS = (OSError, SQLAlchemyError)


class SchemaStatus(BaseModel):
    """Result of checking Taiga's schema against what the extension expects."""

    compatible: bool
    missing_tables: list[str]
    missing_columns: list[str]


class TaigaCounts(BaseModel):
    """Basic volumes of Taiga's data."""

    projects: int
    users: int
    history_entries: int


class TaigaStatus(BaseModel):
    """Status of the connection to Taiga's database."""

    connected: bool
    read_only: bool = False
    server_version: str | None = None
    schema_status: SchemaStatus | None = None
    counts: TaigaCounts | None = None
    error: str | None = None


class MetricsDbStatus(BaseModel):
    """Status of the extension's own database."""

    connected: bool
    revision: str | None = None
    head_revision: str | None = None
    up_to_date: bool = False
    error: str | None = None


class HealthReport(BaseModel):
    """Everything the status page shows."""

    version: str
    taiga: TaigaStatus
    metrics_db: MetricsDbStatus

    @property
    def healthy(self) -> bool:
        """Whether both databases are usable."""
        schema = self.taiga.schema_status
        return (
            self.taiga.connected
            and self.taiga.read_only
            and schema is not None
            and schema.compatible
            and self.metrics_db.connected
            and self.metrics_db.up_to_date
        )


class HealthChecker(Protocol):
    """Anything that can produce a health report."""

    async def check(self) -> HealthReport:
        """Build a fresh report."""
        ...


def describe_error(error: BaseException) -> str:
    """Short, single-line description of a connection error."""
    message = str(getattr(error, "orig", None) or error).strip().splitlines()
    return f"{type(error).__name__}: {message[0] if message else ''}"


async def taiga_status(engine: AsyncEngine) -> TaigaStatus:
    """Connect to Taiga's database and report read-only mode, schema, and volumes."""
    try:
        async with engine.connect() as connection:
            read_only: str = (
                await connection.execute(text("show transaction_read_only"))
            ).scalar_one()
            server_version: str = (
                await connection.execute(text("show server_version"))
            ).scalar_one()
            report = await check_schema(connection)
            counts = None
            if report.compatible:
                row = (
                    await connection.execute(
                        text(
                            "select "
                            "(select count(*) from projects_project), "
                            "(select count(*) from users_user where not is_system), "
                            "(select count(*) from history_historyentry)"
                        )
                    )
                ).one()
                counts = TaigaCounts(projects=row[0], users=row[1], history_entries=row[2])
    except CONNECTION_ERRORS as error:
        return TaigaStatus(connected=False, error=describe_error(error))
    return TaigaStatus(
        connected=True,
        read_only=read_only == "on",
        server_version=server_version,
        schema_status=SchemaStatus(
            compatible=report.compatible,
            missing_tables=list(report.missing_tables),
            missing_columns=list(report.missing_columns),
        ),
        counts=counts,
    )


async def metrics_db_status(engine: AsyncEngine, head_revision: str | None) -> MetricsDbStatus:
    """Connect to the extension's database and compare its revision with the newest one."""
    try:
        async with engine.connect() as connection:
            revision = (
                await connection.execute(text("select version_num from alembic_version"))
            ).scalar_one_or_none()
    except CONNECTION_ERRORS as error:
        return MetricsDbStatus(
            connected=False, head_revision=head_revision, error=describe_error(error)
        )
    return MetricsDbStatus(
        connected=True,
        revision=revision,
        head_revision=head_revision,
        up_to_date=revision == head_revision,
    )


class DatabaseHealthChecker:
    """Health checker backed by real database engines."""

    def __init__(
        self,
        version: str,
        taiga_engine: AsyncEngine,
        metrics_engine: AsyncEngine,
        head_revision: str | None,
    ) -> None:
        """Keep the engines and the expected migration revision."""
        self.version = version
        self.taiga_engine = taiga_engine
        self.metrics_engine = metrics_engine
        self.head_revision = head_revision

    async def check(self) -> HealthReport:
        """Check both databases."""
        return HealthReport(
            version=self.version,
            taiga=await taiga_status(self.taiga_engine),
            metrics_db=await metrics_db_status(self.metrics_engine, self.head_revision),
        )
