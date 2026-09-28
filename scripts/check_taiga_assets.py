"""Check that no SVG path of the frontend is copied from Taiga's frontend.

Taiga's frontend is licensed under AGPL-3.0, this project under MIT, so none of its
icons or logos may be reused here. The script downloads Taiga's SVG files at run time
(they are never stored in this repository), collects every path they draw, and fails
when any path in ``frontend/src`` is the same, whitespace aside.
"""

from __future__ import annotations

import json
import re
import urllib.request
from pathlib import Path

REPOSITORY = "taigaio/taiga-front"
BRANCH = "main"
TREE_URL = f"https://api.github.com/repos/{REPOSITORY}/git/trees/{BRANCH}?recursive=1"
RAW_URL = f"https://raw.githubusercontent.com/{REPOSITORY}/{BRANCH}/"
SOURCES = Path(__file__).resolve().parent.parent / "frontend" / "src"
SOURCE_SUFFIXES = (".ts", ".tsx", ".svg", ".css", ".html")
PATH_ATTRIBUTE = re.compile(r"""\bd\s*=\s*\\?["']([^"'\\]+)\\?["']""")
QUOTED_PATH = re.compile(r"""["'`](M[\d\s.,+\-A-Za-z]{15,})["'`]""")
MIN_LENGTH = 20
TIMEOUT_SECONDS = 60


def normalized(path: str) -> str:
    """The path with whitespace collapsed, so formatting does not hide a copy."""
    return " ".join(path.replace(",", " ").split())


def fetch(url: str) -> str:
    """The body of ``url`` as text."""
    with urllib.request.urlopen(url, timeout=TIMEOUT_SECONDS) as response:
        body: bytes = response.read()
    return body.decode("utf-8", errors="replace")


def taiga_paths() -> set[str]:
    """Every path drawn by an SVG file of Taiga's frontend."""
    tree = json.loads(fetch(TREE_URL))["tree"]
    files = [item["path"] for item in tree if item["path"].endswith(".svg")]
    paths: set[str] = set()
    for name in files:
        for found in PATH_ATTRIBUTE.findall(fetch(RAW_URL + name)):
            if len(found) >= MIN_LENGTH:
                paths.add(normalized(found))
    return paths


def our_paths() -> list[tuple[Path, str]]:
    """Every SVG path written in the frontend sources, with the file it is in."""
    found: list[tuple[Path, str]] = []
    for source in sorted(SOURCES.rglob("*")):
        if source.suffix not in SOURCE_SUFFIXES or not source.is_file():
            continue
        text = source.read_text(encoding="utf-8")
        for match in [*PATH_ATTRIBUTE.findall(text), *QUOTED_PATH.findall(text)]:
            if len(match) >= MIN_LENGTH:
                found.append((source, normalized(match)))
    return found


def main() -> int:
    """Print every copied path and return 1 if there is any."""
    theirs = taiga_paths()
    ours = our_paths()
    copied = [(source, path) for source, path in ours if path in theirs]
    for source, path in copied:
        print(f"{source.relative_to(SOURCES.parent.parent)}: path copied from Taiga: {path[:60]}")
    print(f"Checked {len(ours)} paths against {len(theirs)} of Taiga's; {len(copied)} copied.")
    return 1 if copied else 0


if __name__ == "__main__":
    raise SystemExit(main())
