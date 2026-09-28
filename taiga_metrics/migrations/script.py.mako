"""${message}"""

from __future__ import annotations

revision = ${repr(up_revision)}
down_revision = ${repr(down_revision)}
branch_labels = ${repr(branch_labels)}
depends_on = ${repr(depends_on)}


def upgrade() -> None:
    """Apply this migration."""
    ${upgrades if upgrades else "pass"}


def downgrade() -> None:
    """Revert this migration."""
    ${downgrades if downgrades else "pass"}
