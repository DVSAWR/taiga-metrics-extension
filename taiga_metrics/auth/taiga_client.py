"""Verifying a username and password against Taiga's own API.

This is the only call the extension makes to Taiga's API. It works for every sign-in
method Taiga accepts through its normal login, including LDAP plugins, and the Taiga
token it returns is thrown away.
"""

from __future__ import annotations

from typing import Final, Protocol

import httpx

REJECTED_STATUSES: Final = frozenset({400, 401, 403})


class TaigaUnavailableError(RuntimeError):
    """Taiga could not be asked, so the credentials are neither accepted nor rejected."""


class PasswordChecker(Protocol):
    """Anything that can check Taiga credentials."""

    async def verify(self, username: str, password: str) -> int | None:
        """The Taiga user id if the credentials are valid, ``None`` if they are not."""
        ...


class TaigaPasswordChecker:
    """Checks credentials with ``POST /auth`` on Taiga's API."""

    def __init__(self, api_url: str, timeout: float = 10.0) -> None:
        """Keep Taiga's API address as reachable from this container."""
        self.api_url = api_url.rstrip("/")
        self.timeout = timeout

    async def verify(self, username: str, password: str) -> int | None:
        """Ask Taiga whether the credentials are valid."""
        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                response = await client.post(
                    f"{self.api_url}/auth",
                    json={"type": "normal", "username": username, "password": password},
                )
        except httpx.HTTPError as error:
            raise TaigaUnavailableError(str(error)) from error
        if response.status_code in REJECTED_STATUSES:
            return None
        if response.status_code != httpx.codes.OK:
            raise TaigaUnavailableError(f"Taiga answered HTTP {response.status_code}")
        user_id = response.json().get("id")
        if not isinstance(user_id, int):
            raise TaigaUnavailableError("Taiga's answer has no user id")
        return user_id
