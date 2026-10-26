"""Who may see what.

Taiga superusers, the extension's own superusers named in its settings, project owners,
and project admins see everything in a project and configure it. Every other member sees
only the tabs those managers allowed their role, including their own person page.
People who are not members do not see the project
at all. Identity, ownership, and memberships are read live from Taiga's database on every
request, so a change in Taiga applies immediately.
"""

from __future__ import annotations

from collections.abc import Mapping
from dataclasses import dataclass, field
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Final, Literal, Protocol, get_args

from sqlalchemy import select, text
from sqlalchemy.dialects.postgresql import insert as pg_insert

from taiga_metrics import store

if TYPE_CHECKING:
    from collections.abc import Iterable

    from sqlalchemy.ext.asyncio import AsyncEngine

Page = Literal["overview", "directions", "people", "my_page", "trends", "activity", "cards"]
Scope = Literal["all", "own"]
PAGES: Final[tuple[Page, ...]] = get_args(Page)
SCOPES: Final[tuple[Scope, ...]] = get_args(Scope)


@dataclass(frozen=True)
class Viewer:
    """A signed-in Taiga user with everything needed to decide access."""

    user_id: int
    username: str
    full_name: str
    email: str
    is_superuser: bool
    owned_projects: frozenset[int] = frozenset()
    roles: Mapping[int, int] = field(default_factory=dict)
    admin_projects: frozenset[int] = frozenset()

    def manages(self, project_id: int) -> bool:
        """Whether the viewer is a superuser, the owner, or an admin of the project."""
        return (
            self.is_superuser
            or project_id in self.owned_projects
            or project_id in self.admin_projects
        )


@dataclass(frozen=True)
class RolePermission:
    """What the project's managers allowed one role."""

    pages: frozenset[Page]
    scope: Scope


@dataclass(frozen=True)
class ProjectAccess:
    """What a viewer may do in one project.

    ``member`` is whether the viewer belongs to the project.
    """

    pages: frozenset[Page]
    scope: Scope
    can_manage: bool
    member: bool = True

    @property
    def visible(self) -> bool:
        """Whether the project shows up for the viewer at all."""
        return self.can_manage or self.member or bool(self.pages)

    def allows(self, *pages: Page) -> bool:
        """Whether at least one of ``pages`` is allowed."""
        return any(page in self.pages for page in pages)


FULL_ACCESS: Final = ProjectAccess(frozenset(PAGES), "all", can_manage=True)
NO_ACCESS: Final = ProjectAccess(frozenset(), "all", can_manage=False, member=False)


def project_access(
    viewer: Viewer, project_id: int, permissions: Mapping[int, RolePermission]
) -> ProjectAccess:
    """Access of ``viewer`` to a project, given the project's role permissions."""
    if viewer.manages(project_id):
        return FULL_ACCESS
    role_id = viewer.roles.get(project_id)
    if role_id is None:
        return NO_ACCESS
    permission = permissions.get(role_id)
    if permission is None:
        return ProjectAccess(frozenset(), "all", can_manage=False)
    return ProjectAccess(permission.pages, permission.scope, can_manage=False)


class ViewerDirectory(Protocol):
    """Anything that can describe a Taiga user for access decisions."""

    async def viewer(self, user_id: int) -> Viewer | None:
        """The viewer, or ``None`` if the user cannot use the extension."""
        ...


def superuser_names(value: str) -> frozenset[str]:
    """Usernames from a comma separated list, ignoring case and blanks."""
    return frozenset(name.strip().lower() for name in value.split(",") if name.strip())


USER = text(
    "select id, username, full_name, email, is_superuser from users_user "
    "where id = :user_id and is_active and not is_system"
)
OWNED = text("select id from projects_project where owner_id = :user_id")
MEMBERSHIPS = text(
    "select project_id, role_id, is_admin from projects_membership where user_id = :user_id"
)


class TaigaViewerDirectory:
    """Reads identity, ownership, and memberships live from Taiga's database.

    ``superusers`` are usernames the extension treats as superusers on top of Taiga's own.
    """

    def __init__(self, engine: AsyncEngine, superusers: frozenset[str] = frozenset()) -> None:
        """Keep the read-only engine of Taiga's database and the extension's superusers."""
        self.engine = engine
        self.superusers = superusers

    async def viewer(self, user_id: int) -> Viewer | None:
        """Active, non-system users only."""
        params = {"user_id": user_id}
        async with self.engine.connect() as connection:
            user = (await connection.execute(USER, params)).first()
            if user is None:
                return None
            owned = frozenset(row.id for row in await connection.execute(OWNED, params))
            memberships = list(await connection.execute(MEMBERSHIPS, params))
            roles = {row.project_id: row.role_id for row in memberships}
            admin = frozenset(row.project_id for row in memberships if row.is_admin)
        return Viewer(
            user_id=user.id,
            username=user.username,
            full_name=user.full_name or "",
            email=user.email or "",
            is_superuser=user.is_superuser or user.username.lower() in self.superusers,
            owned_projects=owned,
            roles=roles,
            admin_projects=admin,
        )


class PermissionStore(Protocol):
    """Anything that stores what owners allowed each role."""

    async def for_projects(
        self, project_ids: Iterable[int]
    ) -> dict[int, dict[int, RolePermission]]:
        """Per project, per role, the stored permission."""
        ...

    async def save(
        self, project_id: int, role_id: int, permission: RolePermission, by_user: int
    ) -> None:
        """Store the permission of one role."""
        ...


class DatabasePermissionStore:
    """Role permissions in the extension's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the engine of the extension's database."""
        self.engine = engine

    async def for_projects(
        self, project_ids: Iterable[int]
    ) -> dict[int, dict[int, RolePermission]]:
        """Per project, per role, the stored permission."""
        ids = sorted(set(project_ids))
        result: dict[int, dict[int, RolePermission]] = {project_id: {} for project_id in ids}
        if not ids:
            return result
        table = store.role_permission
        async with self.engine.connect() as connection:
            rows = await connection.execute(select(table).where(table.c.project_id.in_(ids)))
            for row in rows:
                result[row.project_id][row.role_id] = RolePermission(
                    frozenset(page for page in row.pages if page in PAGES),
                    row.scope if row.scope in SCOPES else "all",
                )
        return result

    async def save(
        self, project_id: int, role_id: int, permission: RolePermission, by_user: int
    ) -> None:
        """Insert or replace the permission of one role."""
        values = {
            "project_id": project_id,
            "role_id": role_id,
            "pages": sorted(permission.pages),
            "scope": permission.scope,
            "updated_at": datetime.now(UTC),
            "updated_by": by_user,
        }
        statement = pg_insert(store.role_permission).values(values)
        async with self.engine.begin() as connection:
            await connection.execute(
                statement.on_conflict_do_update(
                    index_elements=["project_id", "role_id"],
                    set_={
                        key: statement.excluded[key]
                        for key in ("pages", "scope", "updated_at", "updated_by")
                    },
                )
            )
