"""Comments on one card, read from Taiga's history when the card page asks for them.

Taiga keeps a comment as a history entry of the card with a non-empty ``comment``.
A deleted comment keeps its entry with ``delete_comment_date`` set and is left out;
an edited one keeps its latest text and ``edit_comment_date``. The text is Taiga's
Markdown source, shown as plain text.
"""

from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING, Final, Protocol

from pydantic import BaseModel
from sqlalchemy import text

from taiga_metrics.sync.history import ITEM_TYPES

if TYPE_CHECKING:
    from sqlalchemy.ext.asyncio import AsyncEngine

HISTORY_PREFIX: Final = {item_type: prefix for prefix, item_type in ITEM_TYPES.items()}

CARD_COMMENTS = text(
    """
    select h.id,
           h.created_at,
           h.edit_comment_date as edited_at,
           cast(h."user"->>'pk' as integer) as author_id,
           coalesce(nullif(u.full_name, ''), u.username, h."user"->>'name', '') as author_name,
           u.username,
           h.comment as body
      from history_historyentry h
      left join users_user u on u.id = cast(h."user"->>'pk' as integer)
     where h.project_id = :project_id
       and h.key = :key
       and coalesce(h.comment, '') <> ''
       and h.delete_comment_date is null
     order by h.created_at, h.id
    """
)


class CardComment(BaseModel):
    """One comment: who wrote it, when, and its text."""

    id: str
    created_at: datetime
    edited_at: datetime | None
    author_id: int | None
    author_name: str
    text: str


class CardComments(BaseModel):
    """A card's comments, oldest first, with the usernames of their authors."""

    comments: list[CardComment]
    usernames: dict[int, str] = {}


class CommentSource(Protocol):
    """Anything that can list the comments of one card."""

    async def card_comments(self, project_id: int, item_type: str, item_id: int) -> CardComments:
        """The card's comments that are not deleted, oldest first."""
        ...


def history_key(item_type: str, item_id: int) -> str:
    """The ``key`` Taiga's history gives the card, such as ``tasks.task:42``."""
    return f"{HISTORY_PREFIX[item_type]}:{item_id}"


class TaigaComments:
    """Reads comments straight from Taiga's database."""

    def __init__(self, engine: AsyncEngine) -> None:
        """Keep the read-only engine of Taiga's database."""
        self.engine = engine

    async def card_comments(self, project_id: int, item_type: str, item_id: int) -> CardComments:
        """The card's comments that are not deleted, oldest first."""
        async with self.engine.connect() as connection:
            rows = await connection.execute(
                CARD_COMMENTS,
                {"project_id": project_id, "key": history_key(item_type, item_id)},
            )
            comments: list[CardComment] = []
            usernames: dict[int, str] = {}
            for row in rows:
                comments.append(
                    CardComment(
                        id=str(row.id),
                        created_at=row.created_at,
                        edited_at=row.edited_at,
                        author_id=row.author_id,
                        author_name=row.author_name,
                        text=row.body,
                    )
                )
                if row.author_id is not None and row.username:
                    usernames[row.author_id] = row.username
            return CardComments(comments=comments, usernames=usernames)
