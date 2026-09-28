"""JSON API routes, all under ``/api``.

Every route except sign-in and the UI config requires a session. Project routes also
check what the viewer may see in that project, and narrow the data to the viewer's own
cards when the project's managers limited their role to those.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date
from typing import TYPE_CHECKING, Annotated, Literal

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import FileResponse
from pydantic import BaseModel, Field

from taiga_metrics.auth.access import (
    PAGES,
    Page,
    ProjectAccess,
    RolePermission,
    Scope,
    Viewer,
    project_access,
)
from taiga_metrics.auth.taiga_client import TaigaUnavailableError
from taiga_metrics.comments import CardComments
from taiga_metrics.explore import CardEvent, CardRow, FilterPanel, Member, Sprint, Swimlanes
from taiga_metrics.filters import Selection, assignment_filter, parse_selection
from taiga_metrics.health import HealthReport
from taiga_metrics.metrics.loader import (
    CardFlow,
    FlowResponse,
    Period,
    PeriodFinished,
    PeriodStatusTimes,
    PeriodStays,
    TransitionPage,
)
from taiga_metrics.project_settings import (
    CalendarSettings,
    ColumnType,
    ItemTypeColumns,
    normalize_days,
    valid_timezone,
)
from taiga_metrics.projects import ProjectSummary
from taiga_metrics.sync.queries import SyncRun, SyncSummary
from taiga_metrics.team import TeamStats

if TYPE_CHECKING:
    from collections.abc import Collection

    from taiga_metrics.api.app import Services
    from taiga_metrics.metrics.loader import CardKey
    from taiga_metrics.settings import Settings

ItemType = Literal["userstory", "task", "issue", "epic"]
SESSION_COOKIE = "taiga_metrics_session"
PAGE_TITLES: dict[Page, str] = {"flow": "Flow metrics", "search": "Search", "team": "Team"}


class UiConfig(BaseModel):
    """Settings the UI needs."""

    taiga_url: str
    community_url: str
    repository_url: str


class SyncStarted(BaseModel):
    """Answer to a manual sync request."""

    accepted: bool


class Credentials(BaseModel):
    """Taiga username or email, and password."""

    username: str = Field(min_length=1, max_length=255)
    password: str = Field(min_length=1, max_length=4096)


class Me(BaseModel):
    """The signed-in user."""

    id: int
    username: str
    full_name: str
    email: str
    is_superuser: bool


class AccessInfo(BaseModel):
    """What the viewer may do in a project."""

    pages: list[Page]
    scope: Scope
    can_manage: bool


class VisibleProject(ProjectSummary):
    """A project the viewer can open, with their access to it."""

    access: AccessInfo


class PageOption(BaseModel):
    """A page the project's managers can allow."""

    key: Page
    title: str


class RoleAccess(BaseModel):
    """What one role of a project is allowed."""

    role_id: int
    name: str
    pages: list[Page]
    scope: Scope


class AccessSettings(BaseModel):
    """The access settings page of a project."""

    pages: list[PageOption]
    roles: list[RoleAccess]


class ColumnTypeUpdate(BaseModel):
    """New type of one column, or ``None`` to clear it."""

    type: ColumnType | None


class RemovedColumnsUpdate(BaseModel):
    """Whether columns removed from Taiga appear in the reports of a card type."""

    show_removed: bool


class CalendarUpdate(BaseModel):
    """New project calendar."""

    timezone: str
    working_days: list[int]


class MemberDaysUpdate(BaseModel):
    """A member's own weekdays, or ``None`` for the project calendar."""

    working_days: list[int] | None


class RoleAccessUpdate(BaseModel):
    """New permissions of one role."""

    pages: list[Page]
    scope: Scope


def services_of(request: Request) -> Services:
    """The services the application was started with."""
    found: Services = request.app.state.services
    return found


def me_of(viewer: Viewer) -> Me:
    """The public description of a viewer."""
    return Me(
        id=viewer.user_id,
        username=viewer.username,
        full_name=viewer.full_name,
        email=viewer.email,
        is_superuser=viewer.is_superuser,
    )


def info_of(access: ProjectAccess) -> AccessInfo:
    """The public description of an access."""
    return AccessInfo(
        pages=[page for page in PAGES if page in access.pages],
        scope=access.scope,
        can_manage=access.can_manage,
    )


async def current_viewer(request: Request) -> Viewer:
    """The signed-in viewer; 401 without a live session or for inactive users."""
    services = services_of(request)
    token = request.cookies.get(SESSION_COOKIE)
    user_id = await services.sessions.user_of(token) if token else None
    viewer = await services.viewers.viewer(user_id) if user_id is not None else None
    if viewer is None:
        raise HTTPException(status_code=401, detail="Sign in required")
    return viewer


@dataclass(frozen=True)
class ProjectContext:
    """A project and what the viewer may do in it."""

    project_id: int
    viewer: Viewer
    access: ProjectAccess

    @property
    def assignee(self) -> int | None:
        """The viewer's id when their data is limited to their own cards."""
        return self.viewer.user_id if self.access.scope == "own" else None

    def require(self, *pages: Page) -> None:
        """403 unless one of ``pages`` is allowed."""
        if not self.access.allows(*pages):
            raise HTTPException(status_code=403, detail="This page is not enabled for your role")

    def require_manage(self) -> None:
        """403 unless the viewer owns the project or is a superuser."""
        if not self.access.can_manage:
            raise HTTPException(
                status_code=403, detail="Only the project owner or admins can do this"
            )


async def project_context(
    request: Request, slug: str, viewer: Annotated[Viewer, Depends(current_viewer)]
) -> ProjectContext:
    """The project with this slug; 404 if it is unknown or invisible to the viewer."""
    services = services_of(request)
    project = await services.project_data.project(slug)
    if project is None:
        raise HTTPException(status_code=404, detail="Unknown project")
    permissions = (await services.permissions.for_projects([project.id]))[project.id]
    access = project_access(viewer, project.id, permissions)
    if not access.visible:
        raise HTTPException(status_code=404, detail="Unknown project")
    return ProjectContext(project_id=project.id, viewer=viewer, access=access)


Context = Annotated[ProjectContext, Depends(project_context)]
CurrentViewer = Annotated[Viewer, Depends(current_viewer)]


def selection_of(include: list[str], exclude: list[str]) -> Selection:
    """Filters from repeated ``include`` and ``exclude`` query parameters."""
    return parse_selection(include, exclude)


def add_auth_routes(router: APIRouter, settings: Settings) -> None:
    """UI config, sign-in, sign-out, and the current user."""
    secure_cookie = settings.taiga_url.lower().startswith("https://")

    @router.get("/config", response_model=UiConfig)
    async def get_config() -> UiConfig:
        """Taiga's public address, without a trailing slash."""
        return UiConfig(
            taiga_url=settings.taiga_url.rstrip("/"),
            community_url=settings.community_url,
            repository_url=settings.repository_url,
        )

    @router.post("/auth/login", response_model=Me)
    async def login(request: Request, response: Response, credentials: Credentials) -> Me:
        """Check the credentials with Taiga and start a session."""
        services = services_of(request)
        try:
            user_id = await services.password_checker.verify(
                credentials.username, credentials.password
            )
        except TaigaUnavailableError as error:
            raise HTTPException(status_code=503, detail="Taiga is not reachable") from error
        if user_id is None:
            raise HTTPException(status_code=401, detail="Wrong username or password")
        viewer = await services.viewers.viewer(user_id)
        if viewer is None:
            raise HTTPException(status_code=403, detail="This account cannot sign in")
        token = await services.sessions.create(user_id)
        response.set_cookie(
            SESSION_COOKIE,
            token,
            max_age=settings.session_days * 86400,
            httponly=True,
            secure=secure_cookie,
            samesite="lax",
            path="/",
        )
        return me_of(viewer)

    @router.post("/auth/logout", status_code=204)
    async def logout(request: Request, response: Response) -> None:
        """End the session, if any."""
        token = request.cookies.get(SESSION_COOKIE)
        if token:
            await services_of(request).sessions.end(token)
        response.delete_cookie(SESSION_COOKIE, path="/")

    @router.get("/auth/me", response_model=Me)
    async def get_me(viewer: CurrentViewer) -> Me:
        """The signed-in user."""
        return me_of(viewer)


DayKind = Literal["working", "calendar"]
Days = Annotated[DayKind, Query()]


def counted(period: Period, days: DayKind) -> Period:
    """The period with durations in working days or in every day."""
    return period.model_copy(update={"working": days == "working"})


@dataclass
class ScrumQuery:
    """How the period matrix is cut: by what, over which days, which stays count."""

    by: Annotated[Literal["day", "week", "month", "sprint"], Query()] = "sprint"
    date_from: Annotated[date | None, Query(alias="from")] = None
    date_to: Annotated[date | None, Query(alias="to")] = None
    pass_minutes: Annotated[int, Query(ge=0, le=1440)] = 5
    days: Annotated[DayKind, Query()] = "working"
    include: Annotated[list[str] | None, Query()] = None
    exclude: Annotated[list[str] | None, Query()] = None


def one_card(
    keys: Collection[CardKey] | None, item_type: str | None, item_id: int | None
) -> Collection[CardKey] | None:
    """The keys narrowed to one card, or left as they are when no card is named."""
    if item_id is None or item_type is None:
        return keys
    card = (item_type, item_id)
    return [card] if keys is None or card in keys else []


def add_project_routes(router: APIRouter) -> None:
    """Project list and the pages inside a project."""

    @router.get("/projects", response_model=list[VisibleProject])
    async def get_projects(request: Request, viewer: CurrentViewer) -> list[VisibleProject]:
        """Projects the viewer can open."""
        services = services_of(request)
        projects = await services.projects.list_projects()
        permissions = await services.permissions.for_projects(p.id for p in projects)
        visible = []
        for project in projects:
            access = project_access(viewer, project.id, permissions.get(project.id, {}))
            if access.visible:
                visible.append(VisibleProject(**project.model_dump(), access=info_of(access)))
        return visible

    @router.get("/projects/{slug}/transitions", response_model=TransitionPage)
    async def get_transitions(
        request: Request,
        *,
        slug: str,
        context: Context,
        item_type: ItemType | None = None,
        offset: Annotated[int, Query(ge=0)] = 0,
        limit: Annotated[int, Query(ge=1, le=1000)] = 100,
        date_from: Annotated[date | None, Query(alias="from")] = None,
        date_to: Annotated[date | None, Query(alias="to")] = None,
        include: Annotated[list[str] | None, Query()] = None,
        exclude: Annotated[list[str] | None, Query()] = None,
        item_id: int | None = None,
        days: Days = "working",
    ) -> TransitionPage:
        """Transitions in the period, newest first, of the cards passing the filters.

        When the filters name people or roles, only moves made while they were
        assigned are listed. ``item_id`` with ``item_type`` narrows them to one card.
        """
        context.require("flow")
        services = services_of(request)
        selection = selection_of(include or [], exclude or [])
        keys: Collection[CardKey] | None = None
        if not selection.is_empty or context.assignee is not None:
            keys = await services.project_data.matching_keys(
                slug, item_type, selection, assignee=context.assignee
            )
        return await services.flow_data.transitions(
            context.project_id,
            item_type,
            period=counted(
                await services.flow_data.period(context.project_id, date_from, date_to), days
            ),
            keys=one_card(keys, item_type, item_id),
            people=assignment_filter(selection),
            offset=offset,
            limit=limit,
        )

    @router.get("/projects/{slug}/flow", response_model=FlowResponse)
    async def get_flow(
        request: Request,
        *,
        slug: str,
        context: Context,
        item_type: ItemType = "userstory",
        date_from: Annotated[date | None, Query(alias="from")] = None,
        date_to: Annotated[date | None, Query(alias="to")] = None,
        include: Annotated[list[str] | None, Query()] = None,
        exclude: Annotated[list[str] | None, Query()] = None,
        column: int | None = None,
        days: Days = "working",
    ) -> FlowResponse:
        """Flow metrics of one card type over the days ``from`` to ``to``, both included.

        When the filters name people or roles, only the time they were assigned counts.
        ``column`` also lists the cards standing in that column now.
        """
        context.require("flow")
        services = services_of(request)
        selection = selection_of(include or [], exclude or [])
        item_ids = None
        if not selection.is_empty or context.assignee is not None:
            keys = await services.project_data.matching_keys(
                slug, item_type, selection, assignee=context.assignee
            )
            item_ids = [item_id for key_type, item_id in keys or [] if key_type == item_type]
        return await services.flow_data.flow(
            context.project_id,
            item_type,
            period=counted(
                await services.flow_data.period(context.project_id, date_from, date_to), days
            ),
            item_ids=item_ids,
            people=assignment_filter(selection),
            column=column,
        )

    @router.get("/projects/{slug}/sprints", response_model=list[Sprint])
    async def get_sprints(request: Request, slug: str, context: Context) -> list[Sprint]:
        """Sprints of a project with their planned dates, newest first."""
        context.require("flow")
        return await services_of(request).project_data.sprints(slug) or []

    @router.get("/projects/{slug}/team-stats", response_model=TeamStats)
    async def get_team_stats(
        request: Request,
        *,
        slug: str,
        context: Context,
        date_from: Annotated[date | None, Query(alias="from")] = None,
        date_to: Annotated[date | None, Query(alias="to")] = None,
    ) -> TeamStats:
        """The numbers of the Team page per member, over the days ``from`` to ``to``."""
        context.require("team")
        services = services_of(request)
        period = await services.flow_data.period(context.project_id, date_from, date_to)
        return await services.team.stats(context.project_id, period.since, period.until)

    @router.get("/projects/{slug}/members", response_model=list[Member])
    async def get_members(request: Request, slug: str, context: Context) -> list[Member]:
        """Members of a project with their roles."""
        context.require("team")
        return await services_of(request).project_data.members(slug) or []

    @router.get("/projects/{slug}/cards", response_model=list[CardRow])
    async def search_cards(
        request: Request,
        *,
        slug: str,
        context: Context,
        q: str = "",
        item_type: ItemType | None = None,
        limit: Annotated[int, Query(ge=1, le=500)] = 50,
        include: Annotated[list[str] | None, Query()] = None,
        exclude: Annotated[list[str] | None, Query()] = None,
    ) -> list[CardRow]:
        """Cards by ``#reference`` or by text in the subject, passing the filters."""
        context.require("search")
        cards = await services_of(request).project_data.search(
            slug,
            q,
            item_type,
            limit,
            selection_of(include or [], exclude or []),
            assignee=context.assignee,
        )
        return cards or []

    @router.get("/projects/{slug}/filters", response_model=FilterPanel)
    async def get_filters(
        request: Request,
        *,
        slug: str,
        context: Context,
        item_type: ItemType | None = None,
        include: Annotated[list[str] | None, Query()] = None,
        exclude: Annotated[list[str] | None, Query()] = None,
    ) -> FilterPanel:
        """Filter categories with counters for the current selection."""
        context.require("flow", "search")
        panel = await services_of(request).project_data.filter_panel(
            slug, item_type, selection_of(include or [], exclude or []), assignee=context.assignee
        )
        if panel is None:
            raise HTTPException(status_code=404, detail="Unknown project")
        return panel


def add_scrum_routes(router: APIRouter) -> None:
    """Metrics compared sprint by sprint, and the swimlanes of the board."""

    @router.get("/projects/{slug}/swimlanes", response_model=Swimlanes)
    async def get_swimlanes(
        request: Request, *, slug: str, context: Context, item_type: ItemType = "userstory"
    ) -> Swimlanes:
        """Swimlanes with their limits, and the swimlane each card of the type is in now."""
        context.require("flow")
        found = await services_of(request).project_data.swimlanes(slug, item_type)
        return found or Swimlanes(lanes=[], cards={})

    async def scrum_scope(
        request: Request, slug: str, context: Context, item_type: str, scope: ScrumQuery
    ) -> tuple[list[Sprint], Period, list[int] | None]:
        """The sprints, the period, and the cards passing the filters, for the matrix."""
        context.require("flow")
        services = services_of(request)
        selection = selection_of(scope.include or [], scope.exclude or [])
        item_ids = None
        if not selection.is_empty or context.assignee is not None:
            keys = await services.project_data.matching_keys(
                slug, item_type, selection, assignee=context.assignee
            )
            item_ids = [item_id for key_type, item_id in keys or [] if key_type == item_type]
        period = await services.flow_data.period(
            context.project_id, scope.date_from, scope.date_to
        )
        return (
            await services.project_data.sprints(slug) or [],
            counted(period, scope.days),
            item_ids,
        )

    @router.get("/projects/{slug}/scrum/status-times", response_model=PeriodStatusTimes)
    async def get_period_status_times(
        request: Request,
        *,
        slug: str,
        context: Context,
        item_type: ItemType = "userstory",
        scope: Annotated[ScrumQuery, Depends()],
    ) -> PeriodStatusTimes:
        """Time in each status, period by period, of the cards passing the filters."""
        sprints, period, item_ids = await scrum_scope(request, slug, context, item_type, scope)
        return await services_of(request).flow_data.period_status_times(
            context.project_id,
            item_type,
            sprints,
            kind=scope.by,
            period=period,
            pass_minutes=scope.pass_minutes,
            item_ids=item_ids,
        )

    @router.get("/projects/{slug}/scrum/stays", response_model=PeriodStays)
    async def get_period_stays(
        request: Request,
        *,
        slug: str,
        context: Context,
        key: str,
        status_id: int,
        item_type: ItemType = "userstory",
        scope: Annotated[ScrumQuery, Depends()],
    ) -> PeriodStays:
        """The stays behind one cell of the matrix, longest first."""
        sprints, period, item_ids = await scrum_scope(request, slug, context, item_type, scope)
        return await services_of(request).flow_data.period_stays(
            context.project_id,
            item_type,
            sprints,
            kind=scope.by,
            period=period,
            pass_minutes=scope.pass_minutes,
            key=key,
            status_id=status_id,
            item_ids=item_ids,
        )

    @router.get("/projects/{slug}/scrum/finished", response_model=PeriodFinished)
    async def get_period_finished(
        request: Request,
        *,
        slug: str,
        context: Context,
        key: str,
        item_type: ItemType = "userstory",
        scope: Annotated[ScrumQuery, Depends()],
    ) -> PeriodFinished:
        """The cards finished in one period of the Total chart, slowest first."""
        sprints, period, item_ids = await scrum_scope(request, slug, context, item_type, scope)
        return await services_of(request).flow_data.period_finished(
            context.project_id,
            item_type,
            sprints,
            kind=scope.by,
            period=period,
            key=key,
            item_ids=item_ids,
        )


async def require_own_card(
    services: Services, context: ProjectContext, slug: str, item_type: ItemType, item_id: int
) -> None:
    """Refuse a card outside the viewer's data scope as if it did not exist."""
    if context.assignee is None:
        return
    own = await services.project_data.matching_keys(
        slug, item_type, Selection(), assignee=context.assignee
    )
    if (item_type, item_id) not in set(own or []):
        raise HTTPException(status_code=404, detail="Unknown card")


def add_card_routes(router: APIRouter) -> None:
    """One card: where its time went, and its full history."""

    @router.get("/projects/{slug}/cards/{item_type}/{item_id}/flow", response_model=CardFlow)
    async def get_card_flow(
        request: Request,
        *,
        slug: str,
        item_type: ItemType,
        item_id: int,
        context: Context,
        days: Days = "working",
    ) -> CardFlow:
        """Where one card's time went, column by column and stay by stay."""
        context.require("flow")
        services = services_of(request)
        await require_own_card(services, context, slug, item_type, item_id)
        card = await services.flow_data.card(
            context.project_id, item_type, item_id, working=days == "working"
        )
        if card is None:
            raise HTTPException(status_code=404, detail="Unknown card")
        return card

    @router.get(
        "/projects/{slug}/cards/{item_type}/{item_id}/comments", response_model=CardComments
    )
    async def get_card_comments(
        request: Request,
        *,
        slug: str,
        item_type: ItemType,
        item_id: int,
        context: Context,
    ) -> CardComments:
        """The card's comments in Taiga, oldest first; deleted ones are left out."""
        context.require("flow")
        services = services_of(request)
        await require_own_card(services, context, slug, item_type, item_id)
        return await services.comments.card_comments(context.project_id, item_type, item_id)

    @router.get(
        "/projects/{slug}/cards/{item_type}/{item_id}/events", response_model=list[CardEvent]
    )
    async def get_card_events(
        request: Request, *, slug: str, item_type: ItemType, item_id: int, context: Context
    ) -> list[CardEvent]:
        """Column and assignee changes of one card, oldest first."""
        context.require("flow", "search")
        events = await services_of(request).project_data.card_events(
            slug, item_type, item_id, assignee=context.assignee
        )
        if events is None:
            raise HTTPException(status_code=404, detail="Unknown card")
        return events


AVATAR_CACHE = "private, no-cache"


def add_media_routes(router: APIRouter) -> None:
    """User photos and project logos from Taiga's media folder."""

    @router.get("/avatars/users/{user_id}", response_class=FileResponse)
    async def get_user_photo(
        request: Request, user_id: int, viewer: CurrentViewer
    ) -> FileResponse:
        """A user's photo; 404 when there is none, so the page shows the placeholder."""
        path = await services_of(request).media.user_photo(user_id)
        if path is None:
            raise HTTPException(status_code=404, detail="No photo")
        return FileResponse(path, headers={"Cache-Control": AVATAR_CACHE})

    @router.get("/avatars/projects/{slug}", response_class=FileResponse)
    async def get_project_logo(request: Request, slug: str, context: Context) -> FileResponse:
        """The logo of a project the viewer can see; 404 when it has none."""
        path = await services_of(request).media.project_logo(context.project_id)
        if path is None:
            raise HTTPException(status_code=404, detail="No logo")
        return FileResponse(path, headers={"Cache-Control": AVATAR_CACHE})


def add_access_routes(router: APIRouter) -> None:
    """Per-role access settings of a project."""

    @router.get("/projects/{slug}/access", response_model=AccessSettings)
    async def get_access_settings(request: Request, slug: str, context: Context) -> AccessSettings:
        """What each role of the project is allowed; owners, admins, and superusers only."""
        context.require_manage()
        services = services_of(request)
        roles = await services.project_data.roles(slug) or []
        stored = (await services.permissions.for_projects([context.project_id]))[
            context.project_id
        ]
        return AccessSettings(
            pages=[PageOption(key=page, title=PAGE_TITLES[page]) for page in PAGES],
            roles=[
                RoleAccess(
                    role_id=role.id,
                    name=role.name,
                    pages=[
                        page
                        for page in PAGES
                        if role.id in stored and page in stored[role.id].pages
                    ],
                    scope=stored[role.id].scope if role.id in stored else "all",
                )
                for role in roles
            ],
        )

    @router.put("/projects/{slug}/access/{role_id}", response_model=RoleAccess)
    async def update_role_access(
        request: Request, *, slug: str, role_id: int, update: RoleAccessUpdate, context: Context
    ) -> RoleAccess:
        """Change what one role is allowed; owners, admins, and superusers only."""
        context.require_manage()
        services = services_of(request)
        roles = {role.id: role for role in await services.project_data.roles(slug) or []}
        if role_id not in roles:
            raise HTTPException(status_code=404, detail="Unknown role")
        permission = RolePermission(frozenset(update.pages), update.scope)
        await services.permissions.save(
            context.project_id, role_id, permission, context.viewer.user_id
        )
        return RoleAccess(
            role_id=role_id,
            name=roles[role_id].name,
            pages=[page for page in PAGES if page in permission.pages],
            scope=permission.scope,
        )


def add_admin_routes(router: APIRouter) -> None:
    """System status and data sync of a project; owners, admins, and superusers only."""

    @router.get("/projects/{slug}/status", response_model=HealthReport)
    async def get_health(request: Request, context: Context) -> HealthReport:
        """Status of both databases, without counts of the whole Taiga instance."""
        context.require_manage()
        report = await services_of(request).health.check()
        return report.model_copy(
            update={"taiga": report.taiga.model_copy(update={"counts": None})}
        )

    @router.get("/projects/{slug}/sync/runs", response_model=list[SyncRun])
    async def get_sync_runs(
        request: Request,
        *,
        context: Context,
        limit: Annotated[int, Query(ge=1, le=200)] = 20,
    ) -> list[SyncRun]:
        """Newest sync runs, their check narrowed to this project's cards.

        A run reads new history for every project at once; the mismatched cards and
        the number of cards checked are those of this project only.
        """
        context.require_manage()
        services = services_of(request)
        runs = await services.sync_data.runs(limit)
        summary = await services.sync_data.summary()
        own = next((item for item in summary.projects if item.id == context.project_id), None)
        cards = (own.userstories + own.tasks + own.issues + own.epics) if own else 0
        narrowed = []
        for run in runs:
            sample = [
                row for row in run.mismatch_sample if row.get("project_id") == context.project_id
            ]
            narrowed.append(
                run.model_copy(
                    update={
                        "mismatch_sample": sample,
                        "mismatches": len(sample),
                        "items_checked": cards,
                    }
                )
            )
        return narrowed

    @router.get("/projects/{slug}/sync/summary", response_model=SyncSummary)
    async def get_sync_summary(request: Request, context: Context) -> SyncSummary:
        """What the extension stores for this project."""
        context.require_manage()
        summary = await services_of(request).sync_data.summary()
        return summary.model_copy(
            update={
                "projects": [item for item in summary.projects if item.id == context.project_id]
            }
        )

    @router.post("/projects/{slug}/sync", response_model=SyncStarted, status_code=202)
    async def start_sync(request: Request, context: Context) -> SyncStarted:
        """Start a sync in the background; it reads new history for every project."""
        context.require_manage()
        return SyncStarted(accepted=services_of(request).sync_trigger.start())


def add_settings_routes(router: APIRouter) -> None:
    """Column types and calendars of a project; owners, admins, and superusers only."""

    @router.get("/projects/{slug}/columns", response_model=list[ItemTypeColumns])
    async def get_columns(request: Request, *, context: Context) -> list[ItemTypeColumns]:
        """Columns of every card type with their configured types."""
        context.require_manage()
        return await services_of(request).project_settings.columns(context.project_id)

    @router.put("/projects/{slug}/columns/{item_type}/{status_id}", status_code=204)
    async def set_column_type(
        request: Request,
        *,
        item_type: ItemType,
        status_id: int,
        update: ColumnTypeUpdate,
        context: Context,
    ) -> None:
        """Set or clear the type of one column."""
        context.require_manage()
        found = await services_of(request).project_settings.set_column_type(
            context.project_id, item_type, status_id, update.type, context.viewer.user_id
        )
        if not found:
            raise HTTPException(status_code=404, detail="Unknown column")

    @router.put("/projects/{slug}/removed-columns/{item_type}", status_code=204)
    async def set_show_removed(
        request: Request, *, item_type: ItemType, update: RemovedColumnsUpdate, context: Context
    ) -> None:
        """Show or hide the columns removed from Taiga in one card type's reports."""
        context.require_manage()
        await services_of(request).project_settings.set_show_removed(
            context.project_id, item_type, update.show_removed, context.viewer.user_id
        )

    @router.get("/projects/{slug}/calendar", response_model=CalendarSettings)
    async def get_calendar(request: Request, *, context: Context) -> CalendarSettings:
        """The project calendar and members' own weekdays."""
        context.require_manage()
        return await services_of(request).project_settings.calendar(context.project_id)

    @router.put("/projects/{slug}/calendar", status_code=204)
    async def set_calendar(request: Request, *, update: CalendarUpdate, context: Context) -> None:
        """Change the project time zone and working weekdays."""
        context.require_manage()
        if not valid_timezone(update.timezone):
            raise HTTPException(status_code=422, detail="Unknown time zone")
        if not normalize_days(update.working_days):
            raise HTTPException(status_code=422, detail="Pick at least one working day")
        await services_of(request).project_settings.set_calendar(
            context.project_id, update.timezone, update.working_days, context.viewer.user_id
        )

    @router.put("/projects/{slug}/calendar/members/{user_id}", status_code=204)
    async def set_member_days(
        request: Request, *, user_id: int, update: MemberDaysUpdate, context: Context
    ) -> None:
        """Give a member their own weekdays, or return them to the project calendar."""
        context.require_manage()
        if update.working_days is not None and not normalize_days(update.working_days):
            raise HTTPException(status_code=422, detail="Pick at least one working day")
        found = await services_of(request).project_settings.set_member_days(
            context.project_id, user_id, update.working_days, context.viewer.user_id
        )
        if not found:
            raise HTTPException(status_code=404, detail="Not a member of this project")


def api_router(settings: Settings) -> APIRouter:
    """All API routes."""
    router = APIRouter(prefix="/api")
    add_auth_routes(router, settings)
    add_project_routes(router)
    add_card_routes(router)
    add_scrum_routes(router)
    add_media_routes(router)
    add_access_routes(router)
    add_settings_routes(router)
    add_admin_routes(router)
    return router
