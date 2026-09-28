"""Tests for the projects endpoint and serving of the single-page UI."""

from __future__ import annotations

from typing import TYPE_CHECKING

import pytest
from fastapi.testclient import TestClient

from taiga_metrics.api.app import create_app
from taiga_metrics.settings import Settings
from tests.conftest import sign_in
from tests.fakes import fake_services

if TYPE_CHECKING:
    from collections.abc import Iterator
    from pathlib import Path


@pytest.fixture
def client(tmp_path: Path) -> Iterator[TestClient]:
    """A client for an app serving a fake built UI from ``tmp_path``."""
    (tmp_path / "index.html").write_text("<html>index</html>")
    (tmp_path / "favicon.svg").write_text("<svg/>")
    (tmp_path.parent / "secret.txt").write_text("secret")
    app = create_app(Settings(static_dir=tmp_path), fake_services())
    with TestClient(app) as test_client:
        sign_in(test_client, "owner")
        yield test_client


def test_projects_are_listed_with_access(client: TestClient) -> None:
    """The owner of ``alpha`` sees only ``alpha``, with full access."""
    response = client.get("/api/projects")
    assert response.status_code == 200
    projects = response.json()
    assert [project["slug"] for project in projects] == ["alpha"]
    assert projects[0]["access"] == {
        "pages": ["flow", "search", "team"],
        "scope": "all",
        "can_manage": True,
    }


def test_existing_file_is_served(client: TestClient) -> None:
    """Built files are served directly."""
    assert client.get("/favicon.svg").text == "<svg/>"


@pytest.mark.parametrize("path", ["/", "/settings/status", "/projects/alpha"])
def test_client_routes_get_the_entry_page(client: TestClient, path: str) -> None:
    """Every UI route loads ``index.html``."""
    assert client.get(path).text == "<html>index</html>"


def test_unknown_api_path_is_not_the_entry_page(client: TestClient) -> None:
    """A mistyped API call gets a 404, not HTML."""
    assert client.get("/api/unknown").status_code == 404


def test_files_outside_the_ui_directory_are_not_served(client: TestClient) -> None:
    """Path traversal falls back to the entry page."""
    assert "secret" not in client.get("/..%2Fsecret.txt").text


def test_missing_file_is_not_found(client: TestClient) -> None:
    """A missing asset is a 404, not the entry page."""
    assert client.get("/favicon.ico").status_code == 404


def test_head_is_answered(client: TestClient) -> None:
    """Browsers and proxies may probe files with HEAD."""
    assert client.head("/favicon.svg").status_code == 200


def test_entry_page_is_not_cached(client: TestClient) -> None:
    """The entry page is revalidated on every load."""
    assert client.get("/projects/alpha").headers["cache-control"] == "no-cache"
