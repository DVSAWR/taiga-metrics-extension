"""FastAPI application: JSON API under ``/api`` and the single-page UI everywhere else."""

from __future__ import annotations

from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, Response
from starlette.middleware.base import RequestResponseEndpoint

from taiga_metrics import __version__
from taiga_metrics.api.routes import api_router
from taiga_metrics.auth.access import (
    DatabasePermissionStore,
    PermissionStore,
    TaigaViewerDirectory,
    ViewerDirectory,
    superuser_names,
)
from taiga_metrics.auth.sessions import DatabaseSessionStore, SessionStore
from taiga_metrics.auth.taiga_client import PasswordChecker, TaigaPasswordChecker
from taiga_metrics.comments import CommentSource, TaigaComments
from taiga_metrics.db import create_metrics_engine, create_taiga_engine
from taiga_metrics.explore import ProjectData, StoredProjectData
from taiga_metrics.health import DatabaseHealthChecker, HealthChecker
from taiga_metrics.media import MediaSource, TaigaMedia
from taiga_metrics.metrics.loader import FlowData, StoredFlowData
from taiga_metrics.migrations import head_revision
from taiga_metrics.people import PeopleSource, StoredPeople
from taiga_metrics.project_settings import DatabaseProjectSettings, ProjectSettingsStore
from taiga_metrics.projects import ProjectSource, TaigaProjectSource
from taiga_metrics.settings import Settings
from taiga_metrics.sync.queries import StoredSyncData, SyncData
from taiga_metrics.sync.service import SyncService
from taiga_metrics.sync.trigger import BackgroundSyncTrigger, SyncTrigger
from taiga_metrics.team import DatabaseTeamStats, TeamSource


@dataclass(frozen=True)
class Services:
    """Everything the API talks to; tests replace it with fakes."""

    health: HealthChecker
    projects: ProjectSource
    sync_data: SyncData
    sync_trigger: SyncTrigger
    project_data: ProjectData
    password_checker: PasswordChecker
    sessions: SessionStore
    viewers: ViewerDirectory
    permissions: PermissionStore
    project_settings: ProjectSettingsStore
    flow_data: FlowData
    media: MediaSource
    team: TeamSource
    comments: CommentSource
    people: PeopleSource


def create_app(settings: Settings | None = None, services: Services | None = None) -> FastAPI:
    """Build the application; ``services`` replaces the database-backed ones."""
    settings = settings or Settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        if services is not None:
            app.state.services = services
            yield
            return
        taiga_engine = create_taiga_engine(settings)
        metrics_engine = create_metrics_engine(settings)
        sync_service = SyncService(
            taiga_engine, metrics_engine, timedelta(minutes=settings.sync_overlap_minutes)
        )
        app.state.services = Services(
            health=DatabaseHealthChecker(
                __version__, taiga_engine, metrics_engine, head_revision(settings)
            ),
            projects=TaigaProjectSource(taiga_engine),
            sync_data=StoredSyncData(metrics_engine),
            sync_trigger=BackgroundSyncTrigger(sync_service),
            project_data=StoredProjectData(metrics_engine),
            password_checker=TaigaPasswordChecker(settings.taiga_api_url),
            sessions=DatabaseSessionStore(metrics_engine, timedelta(days=settings.session_days)),
            viewers=TaigaViewerDirectory(taiga_engine, superuser_names(settings.superusers)),
            permissions=DatabasePermissionStore(metrics_engine),
            project_settings=DatabaseProjectSettings(metrics_engine),
            flow_data=StoredFlowData(metrics_engine),
            media=TaigaMedia(taiga_engine, settings.media_dir),
            team=DatabaseTeamStats(taiga_engine, metrics_engine),
            comments=TaigaComments(taiga_engine),
            people=StoredPeople(taiga_engine, metrics_engine),
        )
        try:
            yield
        finally:
            await taiga_engine.dispose()
            await metrics_engine.dispose()

    app = FastAPI(title="Taiga Metrics", version=__version__, lifespan=lifespan)

    app.middleware("http")(require_api_header)
    app.include_router(api_router(settings))

    if settings.static_dir is not None and settings.static_dir.is_dir():
        mount_ui(app, settings.static_dir)

    return app


API_HEADER = "X-Taiga-Metrics"
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})


async def require_api_header(request: Request, call_next: RequestResponseEndpoint) -> Response:
    """Reject state-changing API calls without the extension's own header.

    Browsers only send custom headers from other sites after a preflight this server
    never approves, so a forged form or script on another site cannot sign in, sign out,
    or change settings on behalf of a signed-in user.
    """
    if (
        request.url.path.startswith("/api/")
        and request.method not in SAFE_METHODS
        and request.headers.get(API_HEADER) != "1"
    ):
        return JSONResponse({"detail": f"Missing {API_HEADER} header"}, status_code=403)
    return await call_next(request)


def mount_ui(app: FastAPI, static_dir: Path) -> None:
    """Serve built UI files, and ``index.html`` for every other non-API path.

    The UI routes on the client, so a deep link such as ``/settings/status`` must load
    the same page as ``/``. A missing path that looks like a file, such as
    ``/favicon.ico``, gets a 404 instead, so browsers never mistake HTML for an asset.
    The entry page is never cached: it references content-hashed assets, so a fresh copy
    is what makes browsers pick up new styles, scripts, and icons.
    """
    root = static_dir.resolve()
    index = root / "index.html"

    @app.api_route("/{path:path}", methods=["GET", "HEAD"], include_in_schema=False)
    async def get_ui(path: str) -> FileResponse:
        """A built file if it exists, otherwise the UI entry page."""
        if path == "api" or path.startswith("api/"):
            raise HTTPException(status_code=404)
        candidate = (root / path).resolve()
        if path and candidate.is_file() and root in candidate.parents:
            return FileResponse(candidate)
        if Path(path).suffix:
            raise HTTPException(status_code=404)
        return FileResponse(index, headers={"Cache-Control": "no-cache"})
