"""Drop the Board section: the status pages remain, reached from any status name."""

from __future__ import annotations

from alembic import op

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Take Board out of every role's sections."""
    op.execute("update role_permission set pages = array_remove(pages, 'board')")


def downgrade() -> None:
    """Give Board back to the roles that see Overview."""
    op.execute(
        "update role_permission set pages = pages || array['board'] where 'overview' = any(pages)"
    )
