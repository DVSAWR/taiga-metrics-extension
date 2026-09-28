"""Shared fixtures: an app backed by fakes and clients signed in as different users."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from taiga_metrics.api.app import create_app
from taiga_metrics.settings import Settings
from tests.fakes import PASSWORD, fake_services

if TYPE_CHECKING:
    from collections.abc import Iterator

    from taiga_metrics.api.app import Services

HEADERS = {"X-Taiga-Metrics": "1"}


def sign_in(client: TestClient, username: str) -> None:
    """Sign in through the API; the session cookie stays on the client."""
    response = client.post(
        "/api/auth/login", json={"username": username, "password": PASSWORD}, headers=HEADERS
    )
    assert response.status_code == 200, response.text


@pytest.fixture
def services() -> Services:
    """A fresh set of fakes per test."""
    return fake_services()


@pytest.fixture
def anonymous(services: Services) -> Iterator[TestClient]:
    """A client without a session."""
    with TestClient(create_app(Settings(), services)) as client:
        yield client


@pytest.fixture
def client(anonymous: TestClient) -> TestClient:
    """A client signed in as the owner of ``alpha``."""
    sign_in(anonymous, "owner")
    return anonymous


@pytest.fixture
def admin(services: Services) -> Iterator[TestClient]:
    """A client signed in as a Taiga superuser."""
    with TestClient(create_app(Settings(), services)) as test_client:
        sign_in(test_client, "admin")
        yield test_client


@pytest.fixture
def member(services: Services) -> Iterator[TestClient]:
    """A client signed in as a member of ``alpha`` with the Back role."""
    with TestClient(create_app(Settings(), services)) as test_client:
        sign_in(test_client, "member")
        yield test_client
