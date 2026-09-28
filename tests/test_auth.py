"""Tests for sign-in, sign-out, and the API header check."""

from __future__ import annotations

from typing import TYPE_CHECKING

from tests.conftest import HEADERS
from tests.fakes import PASSWORD

if TYPE_CHECKING:
    from fastapi.testclient import TestClient


def test_sign_in_starts_a_session(anonymous: TestClient) -> None:
    """Valid Taiga credentials give a session cookie and the user."""
    response = anonymous.post(
        "/api/auth/login", json={"username": "owner", "password": PASSWORD}, headers=HEADERS
    )
    assert response.status_code == 200
    assert response.json()["username"] == "owner"
    cookie = response.headers["set-cookie"]
    assert "HttpOnly" in cookie
    assert "SameSite=lax" in cookie
    assert anonymous.get("/api/auth/me").json()["id"] == 5


def test_wrong_password_is_rejected(anonymous: TestClient) -> None:
    """Taiga's rejection becomes a 401 without a session."""
    response = anonymous.post(
        "/api/auth/login", json={"username": "owner", "password": "nope"}, headers=HEADERS
    )
    assert response.status_code == 401
    assert anonymous.get("/api/auth/me").status_code == 401


def test_unreachable_taiga_is_reported(anonymous: TestClient) -> None:
    """If Taiga cannot be asked, sign-in is unavailable rather than rejected."""
    response = anonymous.post(
        "/api/auth/login", json={"username": "down", "password": PASSWORD}, headers=HEADERS
    )
    assert response.status_code == 503


def test_state_changing_calls_need_the_api_header(anonymous: TestClient) -> None:
    """A forged cross-site form post cannot sign anybody in."""
    response = anonymous.post("/api/auth/login", json={"username": "owner", "password": PASSWORD})
    assert response.status_code == 403


def test_sign_out_ends_the_session(client: TestClient) -> None:
    """After signing out the same cookie no longer works."""
    assert client.get("/api/auth/me").status_code == 200
    assert client.post("/api/auth/logout", headers=HEADERS).status_code == 204
    assert client.get("/api/auth/me").status_code == 401


def test_api_needs_a_session(anonymous: TestClient) -> None:
    """Data endpoints are closed without signing in."""
    assert anonymous.get("/api/projects").status_code == 401
    assert anonymous.get("/api/projects/alpha/transitions").status_code == 401
