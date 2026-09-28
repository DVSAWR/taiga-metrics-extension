"""Sessions of signed-in users, stored as hashes of random tokens."""

from __future__ import annotations

import hashlib
import secrets
from datetime import UTC, datetime
from typing import TYPE_CHECKING, Protocol

from sqlalchemy import delete, insert, select, update

from taiga_metrics import store

if TYPE_CHECKING:
    from datetime import timedelta

    from sqlalchemy.ext.asyncio import AsyncEngine


def hash_token(token: str) -> str:
    """The stored form of a token; the token itself never reaches the database."""
    return hashlib.sha256(token.encode()).hexdigest()


class SessionStore(Protocol):
    """Anything that can create, resolve, and end sessions."""

    async def create(self, user_id: int) -> str:
        """Start a session and return its token."""
        ...

    async def user_of(self, token: str) -> int | None:
        """The user of a live session, or ``None``."""
        ...

    async def end(self, token: str) -> None:
        """End a session."""
        ...


class DatabaseSessionStore:
    """Sessions in the extension's database, extended while they are used."""

    def __init__(self, engine: AsyncEngine, lifetime: timedelta) -> None:
        """Keep the engine and how long an unused session lives."""
        self.engine = engine
        self.lifetime = lifetime

    async def create(self, user_id: int) -> str:
        """Start a session; expired sessions are cleaned up on the way."""
        token = secrets.token_urlsafe(32)
        now = datetime.now(UTC)
        async with self.engine.begin() as connection:
            await connection.execute(
                delete(store.app_session).where(store.app_session.c.expires_at < now)
            )
            await connection.execute(
                insert(store.app_session).values(
                    token_hash=hash_token(token),
                    user_id=user_id,
                    created_at=now,
                    expires_at=now + self.lifetime,
                )
            )
        return token

    async def user_of(self, token: str) -> int | None:
        """The user of a live session; using a session pushes its expiry forward."""
        now = datetime.now(UTC)
        token_hash = hash_token(token)
        async with self.engine.begin() as connection:
            row = (
                await connection.execute(
                    select(store.app_session.c.user_id, store.app_session.c.expires_at).where(
                        store.app_session.c.token_hash == token_hash,
                        store.app_session.c.expires_at > now,
                    )
                )
            ).first()
            if row is None:
                return None
            if row.expires_at - now < self.lifetime / 2:
                await connection.execute(
                    update(store.app_session)
                    .where(store.app_session.c.token_hash == token_hash)
                    .values(expires_at=now + self.lifetime)
                )
            user_id: int = row.user_id
            return user_id

    async def end(self, token: str) -> None:
        """End a session."""
        async with self.engine.begin() as connection:
            await connection.execute(
                delete(store.app_session).where(
                    store.app_session.c.token_hash == hash_token(token)
                )
            )
