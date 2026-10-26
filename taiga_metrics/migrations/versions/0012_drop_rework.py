"""Drop the Rework column type: going back is read from moves to earlier columns."""

from __future__ import annotations

from alembic import op

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade() -> None:
    """Make every Rework column a Work column."""
    op.execute("update column_type set type = 'work' where type = 'rework'")


def downgrade() -> None:
    """Nothing to restore: which Work columns were Rework is not kept."""
