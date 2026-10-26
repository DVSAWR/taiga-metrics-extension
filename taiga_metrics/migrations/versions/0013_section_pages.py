"""Access per section: a role allowed Flow metrics keeps every card type it covered."""

from __future__ import annotations

from alembic import op

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None

SECTIONS = "array['epics', 'userstories', 'tasks', 'issues']::text[]"


def upgrade() -> None:
    """Give roles allowed Flow metrics the card type sections."""
    op.execute(
        "update role_permission set pages = array(select distinct unnest(pages || "
        f"{SECTIONS}) order by 1) where 'flow' = any(pages)"
    )


def downgrade() -> None:
    """Drop the pages the old access settings did not know."""
    op.execute(
        "update role_permission set pages = array(select page from unnest(pages) as page "
        "where page in ('flow', 'search', 'team'))"
    )
