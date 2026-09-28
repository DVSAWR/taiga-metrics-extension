"""Repository style checks run as a pre-commit hook.

Fails when a Python file contains any comment other than ``# TODO ...``, or when any
text file contains an em dash or an en dash instead of the ASCII hyphen.
"""

from __future__ import annotations

import io
import re
import sys
import tokenize
from pathlib import Path

EM_DASH = chr(0x2014)
EN_DASH = chr(0x2013)
FORBIDDEN_DASHES = (EM_DASH, EN_DASH)
ALLOWED_COMMENT = re.compile(r"#\s*TODO\b")


def comment_violations(path: Path, text: str) -> list[str]:
    """Return one message per comment in ``text`` that is not a ``# TODO`` line."""
    return [
        f"{path}:{token.start[0]}: only '# TODO' comments are allowed, use a docstring"
        for token in tokenize.generate_tokens(io.StringIO(text).readline)
        if token.type == tokenize.COMMENT and not ALLOWED_COMMENT.match(token.string)
    ]


def dash_violations(path: Path, text: str) -> list[str]:
    """Return one message per line of ``text`` that contains a long dash."""
    return [
        f"{path}:{number}: use '-' instead of a long dash"
        for number, line in enumerate(text.splitlines(), start=1)
        if any(dash in line for dash in FORBIDDEN_DASHES)
    ]


def main(argv: list[str]) -> int:
    """Check every file named in ``argv``, print all violations, return the exit code."""
    violations: list[str] = []
    for name in argv:
        path = Path(name)
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        violations.extend(dash_violations(path, text))
        if path.suffix == ".py":
            violations.extend(comment_violations(path, text))
    for violation in violations:
        print(violation)
    return 1 if violations else 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
