"""In-memory stand-ins for the database-backed services."""

from __future__ import annotations

from datetime import UTC, date, datetime, time, timedelta
from typing import TYPE_CHECKING

from taiga_metrics.api.app import Services
from taiga_metrics.auth.access import Viewer
from taiga_metrics.auth.taiga_client import TaigaUnavailableError
from taiga_metrics.comments import CardComments
from taiga_metrics.explore import (
    CardEvent,
    CardRow,
    FilterCategory,
    FilterPanel,
    FilterValue,
    Member,
    Person,
    ProjectRef,
    RoleRef,
    Sprint,
    SwimlaneRef,
    Swimlanes,
)
from taiga_metrics.health import (
    HealthReport,
    MetricsDbStatus,
    SchemaStatus,
    TaigaCounts,
    TaigaStatus,
)
from taiga_metrics.metrics.calendar import WorkCalendar
from taiga_metrics.metrics.engine import (
    Calendars,
    Card,
    Column,
    FlowOptions,
    Step,
    card_report,
    compute_flow,
)
from taiga_metrics.metrics.loader import (
    CardFlow,
    CellStats,
    ColumnRef,
    FinishedRow,
    FlowResponse,
    Period,
    PeriodFinished,
    PeriodRef,
    PeriodStatusTimes,
    PeriodStays,
    StatusNow,
    StayRow,
    TransitionPage,
    TransitionRow,
)
from taiga_metrics.project_settings import (
    CalendarSettings,
    ColumnInfo,
    ItemTypeColumns,
    MemberCalendar,
    normalize_days,
)
from taiga_metrics.projects import ProjectSummary
from taiga_metrics.sync.queries import ProjectSyncSummary, SyncSummary
from taiga_metrics.team import EXTENSION_METRICS, TAIGA_METRICS, TeamStats

if TYPE_CHECKING:
    from collections.abc import Collection, Iterable, Sequence
    from pathlib import Path

    from taiga_metrics.auth.access import RolePermission
    from taiga_metrics.explore import CardKey
    from taiga_metrics.filters import AssignmentFilter, Selection
    from taiga_metrics.metrics.periods import PeriodKind
    from taiga_metrics.project_settings import ColumnType
    from taiga_metrics.sync.queries import SyncRun

REPORT = HealthReport(
    version="0.1.0",
    taiga=TaigaStatus(
        connected=True,
        read_only=True,
        server_version="12.3",
        schema_status=SchemaStatus(compatible=True, missing_tables=[], missing_columns=[]),
        counts=TaigaCounts(projects=2, users=3, history_entries=81),
    ),
    metrics_db=MetricsDbStatus(
        connected=True, revision="0002", head_revision="0002", up_to_date=True
    ),
)

PROJECTS = [
    ProjectSummary(id=2, name="Alpha", slug="alpha", description="First", is_blocked=False),
    ProjectSummary(id=1, name="beta", slug="beta", description="", is_blocked=True),
]

MOMENT = datetime(2026, 9, 25, 10, 0, tzinfo=UTC)

TRANSITIONS = [
    TransitionRow(
        history_id="h2",
        item_type="task",
        item_id=4,
        ref=10,
        subject="Write docs",
        is_deleted=False,
        kind="move",
        happened_at=MOMENT,
        user_name="asdf",
        from_status="New",
        to_status="Closed",
    ),
    TransitionRow(
        history_id="h1",
        item_type="userstory",
        item_id=3,
        ref=5,
        subject="Login",
        is_deleted=False,
        kind="create",
        happened_at=MOMENT,
        user_name="qwer",
        from_status=None,
        to_status="New",
    ),
]


class FakeHealth:
    """Returns ``REPORT``."""

    async def check(self) -> HealthReport:
        """Return ``REPORT``."""
        return REPORT


class FakeProjects:
    """Returns ``PROJECTS``."""

    async def list_projects(self) -> list[ProjectSummary]:
        """Return ``PROJECTS``."""
        return PROJECTS


class FakeSyncData:
    """Serves ``TRANSITIONS`` for project ``alpha`` and no runs."""

    async def runs(self, limit: int) -> list[SyncRun]:
        """No runs yet."""
        return []

    async def summary(self) -> SyncSummary:
        """Projects 2 and 3, with nothing stored in them yet."""
        return SyncSummary(
            watermark=None,
            projects=[
                ProjectSyncSummary(
                    id=project_id,
                    name=name,
                    slug=name,
                    userstories=0,
                    tasks=0,
                    issues=0,
                    epics=0,
                    deleted_items=0,
                    transitions=0,
                    assignments=0,
                    last_event_at=None,
                )
                for project_id, name in ((2, "alpha"), (3, "beta"))
            ],
        )


class FakeTrigger:
    """Counts start requests and accepts only the first."""

    def __init__(self) -> None:
        """Nothing started yet."""
        self.starts = 0

    def start(self) -> bool:
        """Accept the first start only."""
        self.starts += 1
        return self.starts == 1


MEMBERS = [
    Member(
        user_id=5,
        username="qwer",
        full_name="",
        role="Product Owner",
        is_owner=True,
        is_admin=True,
        is_active=True,
    )
]

CARDS = [
    CardRow(
        item_type="userstory",
        item_id=3,
        ref=5,
        subject="Login",
        status="In progress",
        is_deleted=False,
        created_at=MOMENT,
        assignees=[Person(id=5, name="qwer"), Person(id=6, name="asdf")],
    ),
    CardRow(
        item_type="task",
        item_id=4,
        ref=10,
        subject="Write docs",
        status="Closed",
        is_deleted=False,
        created_at=MOMENT,
        assignees=[],
    ),
]

EVENTS = [
    CardEvent(
        history_id="h1",
        happened_at=MOMENT,
        user_name="qwer",
        kind="create",
        from_status=None,
        to_status="New",
        assignees=None,
    ),
    CardEvent(
        history_id="h1",
        happened_at=MOMENT,
        user_name="qwer",
        kind="assign",
        from_status=None,
        to_status=None,
        assignees=[Person(id=5, name="qwer")],
    ),
]


PROJECT_REFS = {"alpha": ProjectRef(id=2, name="Alpha"), "beta": ProjectRef(id=1, name="beta")}
ROLES = [RoleRef(id=40, name="Back"), RoleRef(id=30, name="Front")]


class FakeProjectData:
    """Serves members, cards, and events of project ``alpha``."""

    async def project(self, slug: str) -> ProjectRef | None:
        """``alpha`` and ``beta`` exist."""
        return PROJECT_REFS.get(slug)

    async def roles(self, slug: str) -> list[RoleRef] | None:
        """Roles of ``alpha``."""
        return ROLES if slug == "alpha" else None

    async def swimlanes(self, slug: str, item_type: str) -> Swimlanes | None:
        """One swimlane of ``alpha`` holding user story 3, with a limit on status 1."""
        if slug != "alpha":
            return None
        if item_type not in {"userstory", "task"}:
            return Swimlanes(lanes=[], cards={})
        return Swimlanes(lanes=[SwimlaneRef(id=7, name="Team A", wip={1: 5})], cards={3: 7})

    async def sprints(self, slug: str) -> list[Sprint] | None:
        """One sprint of ``alpha``."""
        if slug != "alpha":
            return None
        return [
            Sprint(
                id=1,
                name="Sprint 1",
                start=date(2026, 9, 21),
                finish=date(2026, 10, 2),
                closed=False,
            )
        ]

    async def members(self, slug: str) -> list[Member] | None:
        """``MEMBERS`` for ``alpha``."""
        return MEMBERS if slug == "alpha" else None

    async def search(
        self,
        slug: str,
        query: str,
        item_type: str | None,
        limit: int,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardRow] | None:
        """``CARDS`` for ``alpha``, filtered by type, text, and assignee filters."""
        if slug != "alpha":
            return None
        keys = await self.matching_keys(slug, item_type, selection, assignee=assignee)
        return [
            card
            for card in CARDS
            if (item_type is None or card.item_type == item_type)
            and query.lower() in card.subject.lower()
            and (keys is None or (card.item_type, card.item_id) in keys)
        ][:limit]

    async def matching_keys(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> list[CardKey] | None:
        """Cards of ``alpha`` passing the ``assigned`` filter and the assignee limit."""
        if slug != "alpha":
            return None
        part = selection.categories.get("assigned")
        keys = []
        for card in CARDS:
            ids = {str(person.id) for person in card.assignees}
            if part is not None and part.include and not ids & part.include:
                continue
            if part is not None and ids & part.exclude:
                continue
            if assignee is not None and str(assignee) not in ids:
                continue
            keys.append((card.item_type, card.item_id))
        return keys

    async def filter_panel(
        self,
        slug: str,
        item_type: str | None,
        selection: Selection,
        *,
        assignee: int | None = None,
    ) -> FilterPanel | None:
        """A single category for ``alpha``."""
        if slug != "alpha":
            return None
        keys = await self.matching_keys(slug, item_type, selection, assignee=assignee) or []
        return FilterPanel(
            categories=[
                FilterCategory(
                    key="assigned",
                    title="Assigned to",
                    values=[FilterValue(value="5", label="qwer", count=1)],
                )
            ],
            total=len(CARDS),
            matching=len(keys),
        )

    async def card_events(
        self, slug: str, item_type: str, item_id: int, *, assignee: int | None = None
    ) -> list[CardEvent] | None:
        """``EVENTS`` for user story 3 of ``alpha``."""
        if (slug, item_type, item_id) != ("alpha", "userstory", 3):
            return None
        if assignee is not None and assignee not in {5, 6}:
            return None
        return EVENTS


VIEWERS = {
    1: Viewer(user_id=1, username="admin", full_name="Admin", email="a@x", is_superuser=True),
    5: Viewer(
        user_id=5,
        username="owner",
        full_name="Owner",
        email="o@x",
        is_superuser=False,
        owned_projects=frozenset({2}),
        roles={2: 30},
    ),
    6: Viewer(
        user_id=6,
        username="member",
        full_name="Member",
        email="m@x",
        is_superuser=False,
        roles={2: 40},
    ),
    7: Viewer(user_id=7, username="stranger", full_name="", email="s@x", is_superuser=False),
}

PASSWORDS = {"admin": 1, "owner": 5, "member": 6, "stranger": 7}
PASSWORD = "secret"


class FakePasswordChecker:
    """Accepts ``secret`` for known usernames; ``down`` simulates Taiga being offline."""

    async def verify(self, username: str, password: str) -> int | None:
        """The user id for the right password."""
        if username == "down":
            raise TaigaUnavailableError("offline")
        if password != PASSWORD:
            return None
        return PASSWORDS.get(username)


class FakeSessions:
    """Sessions in a dictionary."""

    def __init__(self) -> None:
        """No sessions yet."""
        self.users: dict[str, int] = {}

    async def create(self, user_id: int) -> str:
        """A predictable token per session."""
        token = f"token-{len(self.users)}-{user_id}"
        self.users[token] = user_id
        return token

    async def user_of(self, token: str) -> int | None:
        """The user of a live session."""
        return self.users.get(token)

    async def end(self, token: str) -> None:
        """Forget the session."""
        self.users.pop(token, None)


class FakeViewers:
    """Serves ``VIEWERS``."""

    async def viewer(self, user_id: int) -> Viewer | None:
        """The viewer, if known."""
        return VIEWERS.get(user_id)


class FakePermissions:
    """Role permissions in a dictionary."""

    def __init__(self) -> None:
        """Nothing allowed yet."""
        self.stored: dict[int, dict[int, RolePermission]] = {}

    async def for_projects(
        self, project_ids: Iterable[int]
    ) -> dict[int, dict[int, RolePermission]]:
        """Stored permissions per project."""
        return {project_id: dict(self.stored.get(project_id, {})) for project_id in project_ids}

    async def save(
        self, project_id: int, role_id: int, permission: RolePermission, by_user: int
    ) -> None:
        """Store one role's permission."""
        self.stored.setdefault(project_id, {})[role_id] = permission


class FakeProjectSettings:
    """Column types and calendars of project 2 in memory."""

    def __init__(self) -> None:
        """Two user story columns, nothing configured, default calendar."""
        self.types: dict[tuple[str, int], ColumnType] = {}
        self.show_removed: dict[str, bool] = {}
        self.timezone = "UTC"
        self.days = [1, 2, 3, 4, 5]
        self.member_days: dict[int, list[int]] = {}

    async def columns(self, project_id: int) -> list[ItemTypeColumns]:
        """``New`` and ``Done`` of user stories."""
        return [
            ItemTypeColumns(
                item_type="userstory",
                columns=[
                    ColumnInfo(
                        status_id=status_id,
                        name=name,
                        color="#999999",
                        position=position,
                        is_closed=closed,
                        is_archived=False,
                        is_deleted=False,
                        cards=1,
                        type=self.types.get(("userstory", status_id)),
                    )
                    for status_id, name, position, closed in (
                        (1, "New", 1, False),
                        (2, "Done", 2, True),
                    )
                ],
                show_removed=self.show_removed.get("userstory", False),
            )
        ]

    async def set_show_removed(
        self, project_id: int, item_type: str, show_removed: bool, by_user: int
    ) -> None:
        """Remember the choice per card type."""
        self.show_removed[item_type] = show_removed

    async def set_column_type(
        self,
        project_id: int,
        item_type: str,
        status_id: int,
        column_type: ColumnType | None,
        by_user: int,
    ) -> bool:
        """Only user story columns 1 and 2 exist."""
        if item_type != "userstory" or status_id not in {1, 2}:
            return False
        if column_type is None:
            self.types.pop((item_type, status_id), None)
        else:
            self.types[(item_type, status_id)] = column_type
        return True

    async def calendar(self, project_id: int) -> CalendarSettings:
        """The stored calendar with member 6."""
        return CalendarSettings(
            timezone=self.timezone,
            working_days=self.days,
            members=[
                MemberCalendar(
                    user_id=6, name="member", role="Back", working_days=self.member_days.get(6)
                )
            ],
        )

    async def set_calendar(
        self, project_id: int, timezone: str, working_days: list[int], by_user: int
    ) -> None:
        """Store the calendar."""
        self.timezone = timezone
        self.days = normalize_days(working_days)

    async def set_member_days(
        self, project_id: int, user_id: int, working_days: list[int] | None, by_user: int
    ) -> bool:
        """Only user 6 is a member."""
        if user_id != 6:
            return False
        if working_days is None:
            self.member_days.pop(user_id, None)
        else:
            self.member_days[user_id] = normalize_days(working_days)
        return True


class FakeFlowData:
    """Computes flow metrics over a fixed set of user story cards."""

    def __init__(self) -> None:
        """Remember the last request."""
        self.requests: list[dict[str, object]] = []

    async def period(
        self, project_id: int, date_from: date | None, date_to: date | None
    ) -> Period:
        """The days as UTC moments."""
        return Period(
            since=datetime.combine(date_from, time(), UTC) if date_from else None,
            until=datetime.combine(date_to + timedelta(days=1), time(), UTC) if date_to else None,
        )

    async def flow(
        self,
        project_id: int,
        item_type: str,
        *,
        period: Period,
        item_ids: Collection[int] | None = None,
        people: AssignmentFilter | None = None,
        column: int | None = None,
    ) -> FlowResponse:
        """An empty report, recording what was asked."""
        self.requests.append(
            {
                "column": column,
                "project_id": project_id,
                "item_type": item_type,
                "since": period.since,
                "until": period.until,
                "item_ids": None if item_ids is None else sorted(item_ids),
                "people": people,
                "working": period.working,
            }
        )
        report = compute_flow(
            [],
            [],
            Calendars(WorkCalendar("UTC", frozenset({1, 2, 3, 4, 5}))),
            FlowOptions(now=MOMENT, since=None, working_days=True),
        )
        return FlowResponse(
            report=report,
            people={},
            period_start=period.since,
            period_end=period.until,
            generated_at=MOMENT,
            timezone="UTC",
        )

    async def period_status_times(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStatusTimes:
        """One New column; every dated sprint had two stays of a day in it."""
        self.requests.append(
            {
                "item_type": item_type,
                "sprints": [sprint.id for sprint in sprints],
                "kind": kind,
                "pass_minutes": pass_minutes,
                "item_ids": item_ids,
            }
        )
        dated = [sprint for sprint in sprints if sprint.start and sprint.finish]
        return PeriodStatusTimes(
            kind=kind,
            periods=[
                PeriodRef(
                    key=f"sprint-{sprint.id}",
                    label=sprint.name,
                    start=MOMENT,
                    end=MOMENT,
                )
                for sprint in dated
            ],
            outside=False,
            columns=[
                ColumnRef(status_id=1, name="New", color="#999999", type="queue", is_deleted=False)
            ],
            cells=[
                CellStats(
                    period=f"sprint-{sprint.id}",
                    status_id=1,
                    n=2,
                    p25=1.0,
                    p50=1.0,
                    p75=1.0,
                    p90=1.0,
                    max=1.0,
                    mean=1.0,
                    sum=2.0,
                )
                for sprint in dated
            ],
            now=[StatusNow(status_id=1, cards=1, oldest_days=3.0)],
        )

    async def period_stays(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        pass_minutes: int,
        key: str,
        status_id: int,
        item_ids: Collection[int] | None = None,
    ) -> PeriodStays:
        """One stay of user story 3 in New, finished by user 5 while 5 was assigned."""
        self.requests.append({"key": key, "status_id": status_id, "kind": kind})
        return PeriodStays(
            rows=[
                StayRow(
                    item_id=3,
                    ref=5,
                    subject="Login",
                    is_deleted=False,
                    start=MOMENT,
                    end=MOMENT,
                    days=1.0,
                    assignees=[5],
                    exited_by=5,
                )
            ],
            people={5: "qwer"},
            roles={40: "Back"},
            role_of={5: 40},
        )

    async def period_finished(
        self,
        project_id: int,
        item_type: str,
        sprints: Sequence[Sprint],
        *,
        kind: PeriodKind,
        period: Period,
        key: str,
        item_ids: Collection[int] | None = None,
    ) -> PeriodFinished:
        """User story 3 finished in the period, in two days, by user 5."""
        self.requests.append({"key": key, "kind": kind, "finished": True})
        return PeriodFinished(
            rows=[
                FinishedRow(
                    item_id=3,
                    ref=5,
                    subject="Login",
                    is_deleted=False,
                    finished_at=MOMENT,
                    lead_days=2.0,
                    cycle_days=1.0,
                    assignees=[5],
                    finished_by=5,
                )
            ],
            people={5: "qwer"},
        )

    async def card(
        self, project_id: int, item_type: str, item_id: int, *, working: bool = True
    ) -> CardFlow | None:
        """User story 3 of ``alpha``, created and never moved."""
        self.requests.append({"card": item_id, "working": working})
        if project_id != 2 or item_type != "userstory" or item_id != 3:
            return None
        report = card_report(
            Card(
                item_id=3,
                ref=5,
                subject="Login",
                created_at=MOMENT,
                status_id=1,
                is_deleted=False,
                steps=(Step(MOMENT, "create", None, 1, 5),),
            ),
            [Column(1, "New", "#999999", 1, "queue")],
            Calendars(WorkCalendar("UTC", frozenset({1, 2, 3, 4, 5}))),
            FlowOptions(now=MOMENT + timedelta(days=1), since=None, working_days=False),
        )
        return CardFlow(
            item_type="userstory",
            item_id=3,
            ref=5,
            subject="Login",
            status_id=1,
            created_at=MOMENT,
            is_deleted=False,
            report=report,
            columns=[
                ColumnRef(status_id=1, name="New", color="#999999", type="queue", is_deleted=False)
            ],
            people={},
        )

    async def transitions(
        self,
        project_id: int,
        item_type: str | None,
        *,
        period: Period,
        keys: Collection[CardKey] | None = None,
        people: AssignmentFilter | None = None,
        offset: int = 0,
        limit: int = 100,
    ) -> TransitionPage:
        """Transitions of ``alpha``, filtered and paged like the real query."""
        rows = [
            row
            for row in TRANSITIONS
            if project_id == 2
            and (item_type is None or row.item_type == item_type)
            and (keys is None or (row.item_type, row.item_id) in keys)
            and (period.since is None or row.happened_at >= period.since)
            and (period.until is None or row.happened_at < period.until)
        ]
        return TransitionPage(
            rows=rows[offset : offset + limit], has_more=len(rows) > offset + limit
        )


class FakeMedia:
    """Photos and logos kept by id, as files the tests create."""

    def __init__(self) -> None:
        """Nothing to show yet."""
        self.photos: dict[int, Path] = {}
        self.logos: dict[int, Path] = {}

    async def user_photo(self, user_id: int) -> Path | None:
        """The stored photo of the user."""
        return self.photos.get(user_id)

    async def project_logo(self, project_id: int) -> Path | None:
        """The stored logo of the project."""
        return self.logos.get(project_id)


class FakeTeam:
    """Two members with a few closed issues and tasks."""

    def __init__(self) -> None:
        """Remember the periods asked for."""
        self.periods: list[tuple[datetime | None, datetime | None]] = []

    async def stats(
        self, project_id: int, since: datetime | None = None, until: datetime | None = None
    ) -> TeamStats:
        """Counts of ``alpha``."""
        self.periods.append((since, until))
        return TeamStats(
            metrics=[*TAIGA_METRICS, *EXTENSION_METRICS],
            values={"closed_bugs": {5: 2, 6: 1}, "closed_tasks": {6: 4}, "moves": {6: 9}},
            modules=["issues", "tasks"],
        )


class FakeComments:
    """Comments kept per card, as the tests add them."""

    def __init__(self) -> None:
        """No comments yet."""
        self.by_card: dict[tuple[int, str, int], CardComments] = {}

    async def card_comments(self, project_id: int, item_type: str, item_id: int) -> CardComments:
        """The stored comments of the card, or none."""
        return self.by_card.get((project_id, item_type, item_id), CardComments(comments=[]))


def fake_services() -> Services:
    """A full set of fakes."""
    return Services(
        health=FakeHealth(),
        projects=FakeProjects(),
        sync_data=FakeSyncData(),
        sync_trigger=FakeTrigger(),
        project_data=FakeProjectData(),
        password_checker=FakePasswordChecker(),
        sessions=FakeSessions(),
        viewers=FakeViewers(),
        permissions=FakePermissions(),
        project_settings=FakeProjectSettings(),
        flow_data=FakeFlowData(),
        media=FakeMedia(),
        team=FakeTeam(),
        comments=FakeComments(),
    )
