"""User photos and project logos, read from Taiga's media folder.

Taiga's database holds only the path of each file, relative to its media folder, and
Taiga's own server hands the files out only through signed links. The extension
reads the folder itself, mounted read-only, and serves the small thumbnail Taiga has
already made when there is one, otherwise the original file.
"""

from __future__ import annotations

from typing import TYPE_CHECKING, Final, Protocol

from sqlalchemy import text

if TYPE_CHECKING:
    from pathlib import Path

    from sqlalchemy import TextClause
    from sqlalchemy.ext.asyncio import AsyncEngine

THUMBNAIL: Final = ".80x80_q85_crop"

USER_PHOTO = text(
    """
    select u.photo as original,
           (select t.name
              from easy_thumbnails_source s
              join easy_thumbnails_thumbnail t on t.source_id = s.id
             where s.name = u.photo
               and left(t.name, length(s.name) + length(:thumbnail)) = s.name || :thumbnail
             order by t.id desc
             limit 1) as thumbnail
      from users_user u
     where u.id = :id and coalesce(u.photo, '') <> ''
    """
)

PROJECT_LOGO = text(
    """
    select p.logo as original,
           (select t.name
              from easy_thumbnails_source s
              join easy_thumbnails_thumbnail t on t.source_id = s.id
             where s.name = p.logo
               and left(t.name, length(s.name) + length(:thumbnail)) = s.name || :thumbnail
             order by t.id desc
             limit 1) as thumbnail
      from projects_project p
     where p.id = :id and coalesce(p.logo, '') <> ''
    """
)


class MediaSource(Protocol):
    """Anything that can find a user's photo or a project's logo on disk."""

    async def user_photo(self, user_id: int) -> Path | None:
        """The photo file of a user, or ``None`` if there is none to show."""
        ...

    async def project_logo(self, project_id: int) -> Path | None:
        """The logo file of a project, or ``None`` if there is none to show."""
        ...


def inside(media_dir: Path, name: str | None) -> Path | None:
    """The file ``name`` in the media folder, if it exists and stays inside the folder."""
    if not name:
        return None
    root = media_dir.resolve()
    candidate = (root / name).resolve()
    if not candidate.is_relative_to(root) or not candidate.is_file():
        return None
    return candidate


class TaigaMedia:
    """Finds files through Taiga's database and reads them from its media folder."""

    def __init__(self, engine: AsyncEngine, media_dir: Path | None) -> None:
        """Keep the read-only engine of Taiga's database and the mounted folder."""
        self.engine = engine
        self.media_dir = media_dir

    async def user_photo(self, user_id: int) -> Path | None:
        """The user's photo thumbnail, or the photo itself."""
        return await self.find(USER_PHOTO, user_id)

    async def project_logo(self, project_id: int) -> Path | None:
        """The project's logo thumbnail, or the logo itself."""
        return await self.find(PROJECT_LOGO, project_id)

    async def find(self, query: TextClause, item_id: int) -> Path | None:
        """The thumbnail if it is on disk, otherwise the original, otherwise nothing."""
        if self.media_dir is None:
            return None
        async with self.engine.connect() as connection:
            params = {"id": item_id, "thumbnail": THUMBNAIL}
            row = (await connection.execute(query, params)).first()
        if row is None:
            return None
        return inside(self.media_dir, row.thumbnail) or inside(self.media_dir, row.original)
