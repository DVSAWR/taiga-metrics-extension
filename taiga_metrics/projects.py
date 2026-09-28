"""Projects as they exist in Taiga."""

from __future__ import annotations

from typing import TYPE_CHECKING, Literal, Protocol

from pydantic import BaseModel
from sqlalchemy import text

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine


Module = Literal["epics", "userstories", "tasks", "issues"]

MODULE_CONDITIONS: dict[Module, str] = {
    "epics": "p.is_epics_activated",
    "userstories": "p.is_kanban_activated or p.is_backlog_activated",
    "tasks": "p.is_kanban_activated or p.is_backlog_activated",
    "issues": "p.is_issues_activated",
}


class ProjectSummary(BaseModel):
    """A Taiga project, enough to list and switch between projects.

    ``modules`` are the kinds of cards whose Taiga module is switched on in the
    project's settings: user stories and tasks with Scrum or Kanban. ``has_scrum`` and
    ``has_kanban`` mirror Taiga's Scrum and Kanban switches; ``has_sprints`` tells
    whether the project has any sprint at all.
    """

    id: int
    name: str
    slug: str
    description: str
    is_blocked: bool
    modules: list[Module] = []
    has_scrum: bool = False
    has_kanban: bool = False
    has_sprints: bool = False


class ProjectSource(Protocol):
    """Anything that can list Taiga projects."""

    async def list_projects(self) -> list[ProjectSummary]:
        """All projects, sorted by name."""
        ...


class TaigaProjectSource:
    """Reads projects straight from Taiga's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the read-only engine of Taiga's database."""
        self.engine = engine

    async def list_projects(self) -> list[ProjectSummary]:
        """All projects, sorted by name, case-insensitively."""
        async with self.engine.connect() as connection:
            rows = await connection.execute(
                text(
                    "select p.id, p.name, p.slug, p.description, "
                    "p.blocked_code is not null as is_blocked, "
                    + ", ".join(
                        f"({condition}) as {module}"
                        for module, condition in MODULE_CONDITIONS.items()
                    )
                    + ", p.is_backlog_activated as has_scrum, p.is_kanban_activated as has_kanban"
                    ", exists (select 1 from milestones_milestone m"
                    " where m.project_id = p.id) as has_sprints"
                    " from projects_project p order by lower(p.name), p.id"
                )
            )
            return [
                ProjectSummary(
                    id=row.id,
                    name=row.name,
                    slug=row.slug,
                    description=row.description,
                    is_blocked=row.is_blocked,
                    modules=[module for module in MODULE_CONDITIONS if row._mapping[module]],
                    has_scrum=row.has_scrum,
                    has_kanban=row.has_kanban,
                    has_sprints=row.has_sprints,
                )
                for row in rows
            ]
