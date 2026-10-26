"""Tests for photos and logos served from Taiga's media folder."""

from __future__ import annotations

from typing import TYPE_CHECKING

from taiga_metrics.media import inside
from tests.fakes import FakeMedia

if TYPE_CHECKING:
    from pathlib import Path

    from fastapi.testclient import TestClient

    from taiga_metrics.api.app import Services


def media_of(services: Services) -> FakeMedia:
    """The fake media source of the test services."""
    media = services.media
    assert isinstance(media, FakeMedia)
    return media


def test_files_outside_the_media_folder_are_refused(tmp_path: Path) -> None:
    """A path from the database cannot climb out of the media folder."""
    (tmp_path / "media" / "user").mkdir(parents=True)
    (tmp_path / "media" / "user" / "a.png").write_bytes(b"png")
    (tmp_path / "secret.txt").write_text("secret")
    media = tmp_path / "media"
    assert inside(media, "user/a.png") == (media / "user" / "a.png").resolve()
    assert inside(media, "../secret.txt") is None
    assert inside(media, "user/missing.png") is None
    assert inside(media, None) is None


def test_photos_are_served_to_signed_in_viewers(
    client: TestClient, services: Services, tmp_path: Path
) -> None:
    """A stored photo comes back as a file; without one the answer is 404."""
    photo = tmp_path / "photo.png"
    photo.write_bytes(b"png")
    media_of(services).photos[6] = photo
    response = client.get("/api/avatars/users/6")
    assert response.status_code == 200
    assert response.content == b"png"
    assert "no-cache" in response.headers["cache-control"]
    assert response.headers["etag"]
    assert client.get("/api/avatars/users/7").status_code == 404


def test_photos_need_a_session(anonymous: TestClient) -> None:
    """Nobody gets a photo without signing in."""
    assert anonymous.get("/api/avatars/users/6").status_code == 401


def test_logos_follow_project_visibility(
    client: TestClient, member: TestClient, services: Services, tmp_path: Path
) -> None:
    """Only viewers who see the project get its logo; every member sees it."""
    logo = tmp_path / "logo.png"
    logo.write_bytes(b"logo")
    media_of(services).logos[2] = logo
    assert client.get("/api/avatars/projects/alpha").content == b"logo"
    assert member.get("/api/avatars/projects/alpha").content == b"logo"
    assert client.get("/api/avatars/projects/beta").status_code == 404
